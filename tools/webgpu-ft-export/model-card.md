---
license: mit
library_name: onnx
tags:
  - audio
  - source-separation
  - stem-separation
  - demucs
  - htdemucs
  - onnx
  - onnxruntime-web
  - webgpu
  - karaoke
---

# htdemucs_ft — WebGPU / onnxruntime-web build

The **htdemucs_ft** 4-model fine-tuned ensemble (Meta's Demucs v4), exported to ONNX
so it **runs in the browser on WebGPU via `onnxruntime-web`** — no Python, no server.

Built for [loukai](https://github.com/monteslu/loukai)'s in-browser karaoke creator.

## What makes this different from other htdemucs ONNX

There are several htdemucs ONNX exports on the Hub already, but they're **CUDA/CPU
server exports** — they fail to load on the `onnxruntime-web` WebGPU execution
provider (in-graph STFT + many `ScatterND` ops the WebGPU EP can't place; verified:
session creation throws in `transformer_memcpy`). This build is shaped specifically
for the browser:

- **STFT/iSTFT pulled out of the graph** (done in JS), using the real-magnitude input
  contract: `mix [1,2,343980]` + `mag [1,4,2048,336]` → `x [1,4,4,2048,336]` (freq
  mask) + `xt [1,4,2,343980]` (time). Masking is applied in JS (see
  [`demucs-web`](https://www.npmjs.com/package/demucs-web)).
- **fp16 weights** for speed/size — with the variance/normalization prologue pinned
  to CPU (`forceCpuNodeNames`) because that op overflows fp16 on WebGPU and NaNs.
  fp16 is parity-perfect vs fp32 (corr ~1.0).
- **Legacy `torch.onnx` export** (opset 17, no dynamo) — the dynamo path decomposes
  ops in ways that NaN on WebGPU.

## Files

- `htdemucs_ft_{drums,bass,other,vocals}_safe16.onnx` — the 4 specialist models
  (~84 MB each, fp16). Stem *k* is taken from model *k* (the bag's one-hot weights).
- `ft_cpu_nodes.json` — per-stem `forceCpuNodeNames` lists.

## Usage

Runs via [`loukai-htdemucs-ft` ensemble runner](https://github.com/monteslu/loukai)
(`createEnsembleSessions` / `runEnsemble`) on top of `demucs-web` for the STFT. See
the loukai repo for the full in-browser pipeline (Demucs + Whisper + CREPE, all
WebGPU).

## Credit

Models exported from [Demucs](https://github.com/facebookresearch/demucs)
(`htdemucs_ft`, MIT). Export approach builds on the timcsy / gianlourbano
demucs-web-onnx work.
