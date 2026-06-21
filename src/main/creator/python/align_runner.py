#!/usr/bin/env python3
"""
Forced-alignment runner — fixes line/word timing drift.

Whisper's native segment timestamps are derived from the decoder and can be off
by seconds (worst on singing). This re-derives timing FROM THE AUDIO using a
wav2vec2 CTC forced-alignment pass (the same technique WhisperX uses), then
rewrites each line's start/end and per-word timings from the alignment.

Architecture note (verified on AMD ROCm): the wav2vec2 acoustic forward runs on
the GPU, but torchaudio.functional.forced_align has NO CUDA/ROCm kernel — so we
run the forward on-device and the alignment trellis on CPU (it's cheap).

Usage: python align_runner.py '{"input":"vocals.wav","lines":[...],"device":"auto"}'
Input lines: [{"text","start","end","words":[{"word","start","end"}]}]
Output (stdout JSON): {"success":true,"lines":[...realigned...],"words":[...],"aligned":true}
Falls back gracefully: on any failure it returns the input lines unchanged with
"aligned": false, so the pipeline never breaks.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from device_utils import resolve_device


def progress(percent, message):
    print(f"PROGRESS:{percent}:{message}", file=sys.stderr, flush=True)


def _tokenize(text):
    # Words reduced to the alignment dictionary's alphabet (lowercase a-z + apostrophe).
    return [w for w in re.findall(r"[a-z']+", text.lower()) if w]


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)
    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON arguments: {e}"}))
        sys.exit(1)

    input_path = args.get("input")
    lines = args.get("lines") or []
    requested_device = args.get("device", "auto")

    # Graceful no-op if nothing to do.
    if not input_path or not lines:
        print(json.dumps({"success": True, "lines": lines, "aligned": False,
                          "reason": "no input or lines"}))
        return

    try:
        import torch
        import torchaudio

        device, device_name = resolve_device(requested_device)
        progress(0, f"Loading alignment model on {device_name}")

        bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
        model = bundle.get_model().to(device).eval()
        labels = bundle.get_labels()
        dictionary = {c: i for i, c in enumerate(labels)}
        sr = bundle.sample_rate

        progress(10, "Loading audio")
        # Load via soundfile (avoids the torchcodec requirement of torchaudio.load,
        # matching demucs_runner). Shape -> [1, samples], mono, model sample rate.
        import soundfile as sf
        audio_np, in_sr = sf.read(input_path, always_2d=True)
        waveform = torch.from_numpy(audio_np.T).float()
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)  # mono
        if in_sr != sr:
            waveform = torchaudio.functional.resample(waveform, in_sr, sr)
        duration = waveform.shape[1] / sr

        # Build the full transcript token sequence + remember which line each token
        # belongs to, so we can map alignment spans back to lines.
        transcript_words = []
        word_line_idx = []
        for li, line in enumerate(lines):
            for w in _tokenize(line.get("text", "")):
                transcript_words.append(w)
                word_line_idx.append(li)

        if not transcript_words:
            print(json.dumps({"success": True, "lines": lines, "aligned": False,
                              "reason": "no alignable words"}))
            return

        # Emissions on-device (the expensive part); chunk long audio to avoid the
        # single-long-pass GPU hang seen on consumer RDNA hardware.
        progress(25, f"Computing emissions ({duration:.0f}s)")
        chunk_samples = sr * 25
        emission_chunks = []
        with torch.inference_mode():
            for start in range(0, waveform.shape[1], chunk_samples):
                seg = waveform[:, start:start + chunk_samples].to(device)
                em, _ = model(seg)
                emission_chunks.append(em.cpu())
        emissions = torch.cat(emission_chunks, dim=1)
        emission = torch.log_softmax(emissions, dim=-1)[0]
        num_frames = emission.shape[0]
        ratio = duration / num_frames  # seconds per frame

        # Build token id sequence (separate words by the word-delimiter '|').
        tokens = []
        for wi, word in enumerate(transcript_words):
            if wi > 0:
                tokens.append(dictionary.get("|", 0))
            for ch in word:
                if ch == "'":
                    # apostrophe not in dict; skip char (rare, negligible)
                    continue
                tokens.append(dictionary.get(ch.upper(), dictionary.get(ch, 0)))

        progress(70, "Forced alignment")
        targets = torch.tensor([tokens], dtype=torch.int32)  # CPU
        # forced_align has no GPU kernel — run on CPU.
        aligned_tokens, scores = torchaudio.functional.forced_align(
            emission.unsqueeze(0), targets, blank=0
        )
        aligned_tokens = aligned_tokens[0].tolist()

        # Walk the alignment to find each word's frame span. Words are delimited by
        # the '|' token; map token positions back to words via the same order.
        blank_id = 0
        sep_id = dictionary.get("|", -1)
        # Reconstruct per-word frame spans by tracking token index progression.
        word_spans = []  # (start_frame, end_frame) per transcript word
        cur_word = 0
        cur_start = None
        ti = 0  # index into `tokens`
        for frame, tok in enumerate(aligned_tokens):
            if tok == blank_id:
                continue
            # advance ti to the matching emitted token
            if tok == sep_id:
                if cur_start is not None:
                    word_spans.append((cur_start, frame))
                    cur_start = None
                    cur_word += 1
                continue
            if cur_start is None:
                cur_start = frame
        if cur_start is not None:
            word_spans.append((cur_start, len(aligned_tokens)))

        # If span count mismatches (alignment imperfect), bail to safe fallback.
        if len(word_spans) != len(transcript_words):
            print(json.dumps({"success": True, "lines": lines, "aligned": False,
                              "reason": f"span mismatch {len(word_spans)}/{len(transcript_words)}"}))
            return

        # Assemble realigned lines: line.start = first word start, end = last word end.
        new_lines = [dict(l) for l in lines]
        per_line_words = {}
        all_words = []
        for wi, (sf, ef) in enumerate(word_spans):
            li = word_line_idx[wi]
            ws = round(sf * ratio, 3)
            we = round(ef * ratio, 3)
            per_line_words.setdefault(li, []).append(
                {"word": transcript_words[wi], "start": ws, "end": we}
            )
            all_words.append({"word": transcript_words[wi], "start": ws, "end": we, "probability": 0.95})

        for li, line in enumerate(new_lines):
            lw = per_line_words.get(li)
            if lw:
                line["start"] = lw[0]["start"]
                line["end"] = lw[-1]["end"]
                line["words"] = lw

        progress(100, f"Aligned {len(all_words)} words")
        print(json.dumps({
            "success": True,
            "lines": new_lines,
            "words": all_words,
            "aligned": True,
            "device": device,
            "duration": duration,
        }))

    except Exception as e:
        import traceback
        # NEVER break the pipeline — fall back to the original (estimated) timing.
        print(f"DEVICE: alignment failed ({e}); keeping original timing", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": True, "lines": lines, "aligned": False,
                          "error": str(e)[:200]}))


if __name__ == "__main__":
    main()
