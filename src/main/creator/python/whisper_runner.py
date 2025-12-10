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

    if not input_path:
        print(json.dumps({"error": "Missing input path"}))
        sys.exit(1)

    try:
        import torch
        import whisper
        import numpy as np

        # Detect device
        if torch.cuda.is_available():
            device = "cuda"
            device_name = torch.cuda.get_device_name(0)
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = "mps"
            device_name = "Apple Silicon GPU"
        else:
            device = "cpu"
            device_name = "CPU"

        progress(0, f"Loading Whisper {model_name} on {device_name}")

        # Load model
        model = whisper.load_model(model_name, device=device)

        progress(15, "Loading audio for transcription")

        # Load audio to get duration
        audio = whisper.load_audio(input_path)
        duration = len(audio) / whisper.audio.SAMPLE_RATE

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

        progress(85, "Extracting line timestamps")

        # Extract line-level timestamps and estimate word positions
        words = []
        lines = []

        for segment in result.get("segments", []):
            segment_text = segment["text"].strip()
            segment_start = segment["start"]
            segment_end = segment["end"]
            segment_duration = segment_end - segment_start

            # Estimate word timings by evenly distributing across segment
            text_words = segment_text.split()
            segment_words = []

            if text_words:
                word_duration = segment_duration / len(text_words)
                for i, word_text in enumerate(text_words):
                    word_start = segment_start + (i * word_duration)
                    word_end = word_start + word_duration
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
                lines.append({
                    "text": segment_text,
                    "start": round(segment_start, 3),
                    "end": round(segment_end, 3),
                    "words": segment_words
                })

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
