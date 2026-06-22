#!/usr/bin/env python3
"""
Whisper Runner - Lyrics transcription for Loukai Creator

Usage: python whisper_runner.py '{"input": "path/to/audio.wav", "model": "large-v3-turbo", "initial_prompt": "Song title. vocabulary hints"}'

Outputs transcription with word timestamps as JSON to stdout.
Progress updates are sent to stderr in format: PROGRESS:percent:message
"""

import json
import sys
import os

# Allow importing device_utils from this script's own directory regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from device_utils import resolve_device

def progress(percent, message):
    """Send progress update to stderr"""
    print(f"PROGRESS:{percent}:{message}", file=sys.stderr, flush=True)

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
    model_name = args.get("model", "large-v3-turbo")
    initial_prompt = args.get("initial_prompt")
    language = args.get("language", "en")
    requested_device = args.get("device", "auto")

    if not input_path:
        print(json.dumps({"error": "Missing input path"}))
        sys.exit(1)

    try:
        import torch
        import whisper
        import numpy as np

        # Resolve requested backend with safe fallback. openai-whisper's load_model
        # only accepts 'cuda'/'cpu' (and is unreliable on mps for DTW), and ROCm
        # presents as 'cuda' — so collapse anything that isn't cuda to cpu here.
        device, device_name = resolve_device(requested_device)
        if device != "cuda":
            if device != "cpu":
                device_name = f"{device_name} -> CPU (Whisper backend limitation)"
            device = "cpu"

        progress(0, f"Loading Whisper {model_name} on {device_name}")

        # Load model
        model = whisper.load_model(model_name, device=device)

        progress(15, "Loading audio for transcription")

        # Load audio to get duration
        audio = whisper.load_audio(input_path)
        duration = len(audio) / whisper.audio.SAMPLE_RATE

        # --- Hallucination-cleanup helpers (parity with the WebGPU creator) ---
        # The audio we transcribe IS the separated vocals stem, so its energy is an
        # honest "is anyone singing here?" signal. Whisper invents text over
        # instrumental sections (solos/intros) — often sound-effect annotations like
        # "*Music*"/"[Applause]". We (1) strip any token containing * [ ], and
        # (2) cull words landing where the vocals stem is RMS-silent.
        SR = whisper.audio.SAMPLE_RATE
        _win = int(0.20 * SR)  # 200ms RMS windows
        _nwin = max(1, (len(audio) + _win - 1) // _win)
        _rms = np.zeros(_nwin, dtype=np.float32)
        for _w in range(_nwin):
            _seg = audio[_w * _win:(_w + 1) * _win]
            if len(_seg):
                _rms[_w] = float(np.sqrt(np.mean(_seg.astype(np.float32) ** 2)))
        _peak = float(_rms.max()) if _nwin else 0.0
        _silent_thresh = _peak * 0.08  # 8% of peak vocal level (relative, adapts to master)

        import re as _re
        _annot = _re.compile(r"[*\[\]]")

        def _is_annotation(tok):
            return bool(_annot.search(tok or ""))

        def _vocals_audible_at(t_sec):
            if _peak <= 0:
                return True  # no profile → don't cull
            w = min(_nwin - 1, max(0, int((t_sec * SR) // _win)))
            return _rms[w] > _silent_thresh

        # Final alignment pass: snap a line's start/end to the nearest vocal onset/offset
        # (Whisper timestamps drift on singing). Same logic as the WebGPU creator's
        # snapToVocalEnergy. Searches +/- search_sec, clamped to not cross neighbors.
        _hop = _win / SR

        def _voiced(i):
            return 0 <= i < _nwin and _rms[i] > _silent_thresh

        def _nearest_onset(t, span):
            c = min(_nwin - 1, max(0, int(round(t / _hop))))
            for d in range(span + 1):
                if _voiced(c - d) and not _voiced(c - d - 1):
                    return (c - d) * _hop
                if _voiced(c + d) and not _voiced(c + d - 1):
                    return (c + d) * _hop
            return t

        def _nearest_offset(t, span):
            c = min(_nwin - 1, max(0, int(round(t / _hop))))
            for d in range(span + 1):
                if _voiced(c - d) and not _voiced(c - d + 1):
                    return (c - d + 1) * _hop
                if _voiced(c + d) and not _voiced(c + d + 1):
                    return (c + d + 1) * _hop
            return t

        def _snap_lines(line_list, search_sec=0.5):
            if _peak <= 0 or not line_list:
                return line_list
            span = max(1, int(round(search_sec / _hop)))
            for i, ln in enumerate(line_list):
                prev_end = line_list[i - 1]["end"] if i > 0 else 0.0
                next_start = line_list[i + 1]["start"] if i < len(line_list) - 1 else float("inf")
                s = _nearest_onset(ln["start"], span)
                e = _nearest_offset(ln["end"], span)
                s = max(prev_end, min(s, ln["end"] - 0.1))
                e = min(next_start, max(e, s + 0.1))
                ln["start"] = round(s, 3)
                ln["end"] = round(e, 3)
            return line_list

        progress(20, f"Transcribing {duration:.1f}s of audio...")

        # Build transcription parameters
        # Note: We don't use word_timestamps because:
        # 1. MPS doesn't support the DTW algorithm (requires float64)
        # 2. Singing has different timing than speech (stretching/compression)
        # 3. LLM corrections break word alignment anyway
        # We use line-level timing and estimate word positions
        transcribe_params = {
            "word_timestamps": False,
            "language": language,
            "task": "transcribe",
            "verbose": True,  # Show transcription progress and lyrics in console
            "condition_on_previous_text": False,  # Reduces repetition in singing
            "no_speech_threshold": 0.3,  # More permissive for singing
        }

        if initial_prompt:
            transcribe_params["initial_prompt"] = initial_prompt
            progress(22, f"Using vocabulary hints ({len(initial_prompt.split())} words)")

        # Transcribe - this is the long operation
        # Whisper processes in 30-second chunks internally
        num_chunks = max(1, int(duration / 30))
        if num_chunks > 1:
            progress(25, f"Processing ~{num_chunks} segments...")

        # Redirect stdout to stderr during transcription so verbose output doesn't interfere with JSON
        old_stdout = sys.stdout
        sys.stdout = sys.stderr

        result = model.transcribe(audio, **transcribe_params)

        # Restore stdout
        sys.stdout = old_stdout

        # RAW DUMP (debug): write Whisper's verbatim segment output BEFORE any of our
        # processing, so the two creators can be compared at the source. Includes the
        # fields openai-whisper exposes (no_speech_prob, avg_logprob, compression_ratio).
        # Enabled by setting LOUKAI_DUMP_RAW=/path/to/file.json (or a dir).
        dump_path = os.environ.get("LOUKAI_DUMP_RAW")
        if dump_path:
            try:
                if os.path.isdir(dump_path):
                    dump_path = os.path.join(dump_path, "whisper_raw_python.json")
                raw_segs = [{
                    "id": s.get("id"),
                    "start": round(s.get("start", 0), 3),
                    "end": round(s.get("end", 0), 3),
                    "text": s.get("text", ""),
                    "no_speech_prob": s.get("no_speech_prob"),
                    "avg_logprob": s.get("avg_logprob"),
                    "compression_ratio": s.get("compression_ratio"),
                    "temperature": s.get("temperature"),
                } for s in result.get("segments", [])]
                with open(dump_path, "w") as fh:
                    json.dump({"engine": "python-openai-whisper", "model": model_name,
                               "text": result.get("text", ""), "segments": raw_segs}, fh, indent=2)
                print(f"PROGRESS:84:Raw Whisper dump → {dump_path}", file=sys.stderr, flush=True)
            except Exception as _e:
                print(f"(raw dump failed: {_e})", file=sys.stderr, flush=True)

        progress(85, "Extracting line timestamps")

        # Extract line-level timestamps and estimate word positions
        words = []
        lines = []
        culled = []  # {word, t, why} — for logging

        for segment in result.get("segments", []):
            segment_text = segment["text"].strip()
            segment_start = segment["start"]
            segment_end = segment["end"]
            segment_duration = segment_end - segment_start

            # Estimate word timings by evenly distributing across segment, then KEEP
            # only words that survive cleanup. A bad word at a line edge shrinks the
            # line (start/end recomputed from survivors); a bad word in the middle is
            # removed and the gap closes. An all-bad segment is dropped entirely.
            text_words = segment_text.split()
            segment_words = []

            if text_words:
                word_duration = segment_duration / len(text_words)
                for i, word_text in enumerate(text_words):
                    word_start = segment_start + (i * word_duration)
                    word_end = word_start + word_duration
                    mid = (word_start + word_end) / 2.0
                    # (1) annotation token (*Music*, split *Country/music*, [Applause])
                    # — applied EVERYWHERE; this removes mid-song instrumental garbage.
                    if _is_annotation(word_text):
                        culled.append({"word": word_text, "t": round(mid, 2), "why": "annotation"})
                        continue
                    # (2) vocals-RMS cull, ONLY in the first 1% / last 1% of the song —
                    # garbage up front (count-ins/noise) or an outro "thank you"/"♪" over
                    # the fade. Restricted to edges so a quiet real word mid-song is never
                    # culled by energy alone.
                    if (mid <= duration * 0.01 or mid >= duration * 0.99) and not _vocals_audible_at(mid):
                        culled.append({"word": word_text, "t": round(mid, 2), "why": "edge vocals silent"})
                        continue
                    word_data = {
                        "word": word_text,
                        "start": round(word_start, 3),
                        "end": round(word_end, 3)
                    }
                    segment_words.append(word_data)
                    words.append({
                        **word_data,
                        "probability": 0.9  # Good confidence in text, estimated timing
                    })

            if segment_words:
                # Rebuild line text + bounds from the SURVIVING words (edge-shrink).
                line_text = " ".join(w["word"] for w in segment_words).strip()
                lines.append({
                    "text": line_text,
                    "start": round(segment_words[0]["start"], 3),
                    "end": round(segment_words[-1]["end"], 3),
                    "words": segment_words
                })

        if culled:
            progress(90, f"Trimmed {len(culled)} hallucinated word(s) (annotation/vocals-silent)")
            for c in culled[:40]:
                print(f"  ✂ {c['word']!r} @ {c['t']}s ({c['why']})", file=sys.stderr, flush=True)

        # Final alignment pass: snap line bounds to the actual vocal onset/offset
        # (corrects Whisper's timestamp drift on singing). Chunker-agnostic — keeps
        # openai-whisper's own (good) internal chunking intact.
        lines = _snap_lines(lines, search_sec=0.5)

        progress(95, f"Organized into {len(lines)} lines")

        # Calculate some stats for the UI
        avg_confidence = sum(w["probability"] for w in words) / len(words) if words else 0

        progress(100, f"✓ Transcribed {len(words)} words, {len(lines)} lines")

        # Output result
        output = {
            "success": True,
            "text": result.get("text", "").strip(),
            "language": result.get("language", language),
            "lines": lines,
            "words": words,
            "model": model_name,
            "device": device,
            "duration": duration,
            "avgConfidence": round(avg_confidence, 3)
        }
        print(json.dumps(output))

    except Exception as e:
        import traceback
        print(json.dumps({
            "error": str(e),
            "traceback": traceback.format_exc()
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
