# Transcription benchmark (webgpu vs python, vs a gold standard)

Proves the WebGPU (ONNX/transformers.js) transcription is ≥ the native Python
(openai-whisper) path, on the SAME model (large-v3-turbo) and precision (q4f16).

## Loop (all local, no GPU, no manual app runs)
1. Extract the vocals stem from any `.stem.mp4`:
   `ffmpeg -y -i SONG.stem.mp4 -map 0:a:4 -ar 16000 -ac 1 /tmp/vocals.wav`
2. Run a transcription approach on it (Python whisper, or the ONNX model via
   optimum — see notes below) → a `{segments:[{text,start,end}]}` JSON.
3. Score vs gold (an edited `.stem.mp4` from loukai's editor, or a JSON):
   `node score.mjs GOLD.stem.mp4 candidate.json`
   → WER / word-accuracy, extra-words (hallucination), line-timing MAE.

## Running the ACTUAL web ONNX model locally (optimum + onnxruntime, CPU)
- `pip install "optimum[onnxruntime]" "transformers<4.50"`
- Stage the chosen variant's `encoder_model_<v>.onnx` + `decoder_model_merged_<v>.onnx`
  into a temp dir under standard names (`encoder_model.onnx`,
  `decoder_model_merged.onnx`) + copy the json configs + tokenizer.json.
- `SessionOptions.graph_optimization_level = ORT_DISABLE_ALL` (a SimplifiedLayerNorm
  fusion bug crashes init otherwise); `provider="CPUExecutionProvider"`.
- KEY: feed ONE ≤30s segment per `generate()` call (NO chunk_length_s). transformers'
  internal chunked stitching double-emits at boundaries (→ WER 12%, dupes); feeding our
  silence-aware dip-segments one at a time avoids it → WER 4.3% (beats Python's 4.8%).

## Result (Can't Buy Me Love, vs the hand-edited gold)
  Python openai-whisper:        WER 4.8%,  0 extra
  ONNX transformers chunked:    WER 12.0%, 9 extra  (chunk-stitch dupes)
  ONNX + our dip-segments:      WER 4.3%,  0 extra  (≥ Python)
