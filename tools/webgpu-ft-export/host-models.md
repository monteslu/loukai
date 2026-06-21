# Hosting the loukai WebGPU models

The WebGPU creator serves all libs/models same-origin via the backend proxy
(`src/main/creator/webgpuAssets.js`), which caches them on first request. Most are
fetched from existing public HuggingFace repos, but **five models are loukai's own
builds** and must be hosted before they work on a machine that hasn't cached them.

## What needs hosting (our builds)

| Model | Size | Purpose | Built by |
|-------|------|---------|----------|
| `crepe_tiny.onnx` | 1.9 MB | Pitch + key detection | `export_crepe_onnx.py` |
| `htdemucs_ft_drums_safe16.onnx` | 84 MB | "Best quality" separation (drums) | `export_ft_onnx.py` |
| `htdemucs_ft_bass_safe16.onnx` | 84 MB | "Best quality" separation (bass) | `export_ft_onnx.py` |
| `htdemucs_ft_other_safe16.onnx` | 84 MB | "Best quality" separation (other) | `export_ft_onnx.py` |
| `htdemucs_ft_vocals_safe16.onnx` | 84 MB | "Best quality" separation (vocals) | `export_ft_onnx.py` |

Total ≈ 338 MB. (Per the LAN-cache design, the host downloads these once and serves
them to every edge browser at LAN speed — so size is a one-time-per-host cost.)

## Already hosted (no action needed)

- `silero-vad` → `onnx-community/silero-vad` (MIT) — fetched at
  `/webgpu-models/onnx-community/silero-vad/resolve/main/onnx/model.onnx`.
- `htdemucs.onnx` (fast single model) → demucs-web's default URL.
- Whisper `*_timestamped` → `onnx-community/...` repos.

## Steps

1. Create a HuggingFace model repo, e.g. `monteslu/loukai-webgpu`.
2. Upload the five files above (from `~/.config/loukai/creator/webgpu-models/`) to the
   repo root (or an `onnx/` subdir — match the path used in step 3).
3. Point the renderer + proxy at the repo. Two options:
   - **Simplest:** change the fetch URLs in `WebGpuCreatorPanel.jsx` /
     `ft-ensemble.js` from `/webgpu-models/<name>` to
     `/webgpu-models/<user>/loukai-webgpu/resolve/main/<name>` (the proxy then
     resolves `huggingface.co/<user>/loukai-webgpu/...` and caches it — same
     mechanism already proven for silero-vad).
   - Or add an allowlist entry in `webgpuAssets.js` mapping the short names to the
     repo so the renderer keeps using `/webgpu-models/<name>`.
4. Optionally also offer the fp32 ft models (`*_fp32.onnx`, ≈174 MB each) as a
   "max quality" tier (the build retains corr 1.0 vs PyTorch; fp16 is ~2e-4).

Until hosted, the UI degrades gracefully: "best quality" is disabled
(`/webgpu-assets/ft-available` → false) and pitch/key detection is skipped
(both logged, never fatal). Fast `htdemucs` + Whisper work everywhere.
