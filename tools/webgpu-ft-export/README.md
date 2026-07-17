# htdemucs_ft → ONNX export (WebGPU-safe, fp16) for the in-browser Creator

Produces the 4 fine-tuned specialist ONNX models the WebGPU Creator runs
(`htdemucs_ft_{drums,bass,other,vocals}_safe16.onnx`) — PyTorch-quality, no NaN
on the onnxruntime-web WebGPU EP, fp16 for ~GPU speed.

## Why it's done this way (hard-won)
- **timcsy contract**: model takes a REAL magnitude `[1,4,2048,336]` + raw mix
  `[1,2,343980]`; STFT/iSTFT happen in JS (demucs-web). Keeps complex ops out of
  the graph.
- **Legacy exporter** (`dynamo=False`, opset 17): the dynamo exporter decomposes
  ops the WebGPU EP miscomputes to **NaN**. Legacy gives WebGPU-safe ops.
- **fp16-safe variance**: `torch.std` (unbiased) decomposes to `mean((x-mu)^2)*N`,
  and N≈2.8M overflows fp16 (max 65504) → Inf → NaN. We use **biased std**
  `sqrt(mean((x-mu)^2))` (negligibly different for large N; parity-perfect).
- **forceCpuNodeNames**: the residual variance prologue (~16 nodes) is pinned to
  CPU at runtime so fp16 never NaNs; Conv/MatMul/attention stay fp16 on GPU.
  (The node list ships in `static/webgpu/ft_cpu_nodes.json`.)

## Run
Needs `torch`, `demucs==4.0.1`, `onnx`, `onnxruntime`, `onnxconverter-common`,
and a gianlourbano-modified `demucs/htdemucs.py` (forward(mix, spec)) on PYTHONPATH.
Exports fp32 `_ts.onnx`, then convert to fp16 via
`onnxruntime.transformers.float16.convert_float_to_float16(keep_io_types=True)`.

The 4 models (~88MB fp16 each) are NOT committed; host them (e.g. HuggingFace) and
point the backend model proxy at them, or generate locally into the creator cache.
