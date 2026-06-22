# Hosting the htdemucs_ft WebGPU models on HuggingFace

The WebGPU creator serves all models same-origin via the backend proxy
(`src/main/creator/webgpuAssets.js`), which fetches + LAN-caches them on first
request. Most come from public HuggingFace repos; the **htdemucs_ft ensemble is
loukai's own export** and lives in a free public HF repo.

## What goes where

| Model | Size | Source | Action |
|-------|------|--------|--------|
| `crepe_tiny.onnx` | 1.9 MB | bundled in `static/webgpu` | none (ships in app) |
| `silero_vad` | 2.2 MB | `onnx-community/silero-vad` (public) | none |
| `htdemucs.onnx` (fast) | 172 MB | demucs-web default (public) | none |
| Whisper `*_timestamped` | up to ~540 MB (q4f16) | `onnx-community/...` (public) | none |
| **htdemucs_ft ensemble** | **4 × 84 MB + cpu-nodes** | **`monteslu/htdemucs-ft-webgpu` (to create)** | **upload (below)** |

Only the ft ensemble needs hosting. The proxy resolves it via `FT_MODELS` in
`webgpuAssets.js` → `huggingface.co/monteslu/htdemucs-ft-webgpu/resolve/main/<file>`.

## Why HF (not npm)

ONNX weights aren't a good fit for npm (registry norms, CDN bandwidth, the
gitignore/publish dance). HF is purpose-built: free **public** hosting (no card, no
trial, no overage — paid tiers are opt-in only), LFS, a blob CDN, model cards, and
discoverability. One distribution path, matching how silero + the fast model already
work.

## Upload steps (free account)

1. Create a free HF account, then a **public** model repo named
   **`monteslu/htdemucs-ft-webgpu`** (must match `LOUKAI_FT_REPO`).
2. `pip install -U "huggingface_hub[cli]"` and `huggingface-cli login`.
3. Upload the 5 files from `~/.config/loukai/creator/webgpu-models/`:
   ```
   huggingface-cli upload monteslu/htdemucs-ft-webgpu \
     ~/.config/loukai/creator/webgpu-models/htdemucs_ft_drums_safe16.onnx  htdemucs_ft_drums_safe16.onnx
   # ...repeat for bass, other, vocals, and static/webgpu/ft_cpu_nodes.json
   ```
   (or use the web UI / `upload_folder`).
4. Use `model-card.md` (in this dir) as the repo's README.

## Model card framing (important)

Frame it as **"WebGPU / onnxruntime-web-runnable htdemucs_ft"**, NOT just "fp16
htdemucs_ft". Tested fact: existing fp16 ft ONNX on HF (e.g. StemSplitio's) are
CUDA/CPU-server exports — they **fail to load on the WebGPU execution provider**
(in-graph STFT + ScatterND). This export is shaped for the browser (STFT pulled into
JS via the timcsy contract; the fp16-variance prologue pinned to CPU so it doesn't
NaN). That is the differentiator and the reason this repo isn't redundant.

Until the repo exists, the UI degrades gracefully: if the ft models can't be
fetched, the run falls back to the fast htdemucs (logged). Fast separation, Whisper,
VAD, pitch/key all work without it.
