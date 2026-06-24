# Offsite creator (karaoke-creator.loukai.com)

A standalone static web app that runs the **same** WebGPU creation engine as the Loukai
desktop creator, but with **no Node backend**. It muxes the `.stem.mp4` entirely in the
browser and offers it as a download; the user then imports that file into Loukai's web
admin ("Create" tab → "Import a .stem.mp4").

## Why it exists

WebGPU only runs in a **secure context** (localhost or HTTPS). There are two ways to get
karaoke creation from a device that isn't the Loukai host:

1. **Command the host** (in-app, default): a phone web-admin uploads audio and the
   desktop player creates on its GPU. See `docs/TEST-host-create.md`.
2. **This offsite app** (escape hatch): an HTTPS page that runs WebGPU on the visitor's
   **own** device. Useful when no Loukai host is running, or to offload creation to a
   beefier machine. Output is a downloaded `.stem.mp4` you import into Loukai.

It reuses, unchanged:
- `src/shared/creator/createKaraoke.js` — the compute (Demucs → Whisper + culls → CREPE)
- `src/shared/creator/creatorLibs.js` — the WebGPU runtime loader
- `src/shared/creator/aacEncoder.js` + `creatorAudio.js` — WAV→AAC encode + helpers
- `src/shared/components/creatorUi.jsx` — shared UI primitives
- `stem-mp4` `StemMp4Writer` / `Atoms` (browser-safe submodules) — in-browser mux + atoms

Only the UI shell (`src/offsite/OffsiteCreator.jsx`) and the save path differ: instead of
POSTing stems to a server, it calls `StemMp4Writer.write()` (which returns a `Uint8Array`
in the browser), writes the pitch atom with `Atoms.writeVpchAtomBuffer`, and downloads
the result.

## Build

```bash
npm run build:offsite        # → src/offsite/dist/
```

Dev server (proxies the asset paths to a running Loukai on :3069 so you don't vendor
them locally):

```bash
npm run dev:offsite          # serves src/offsite with HMR
```

## Deployment requirements

The app is a static bundle, but the engine fetches its runtime **same-origin** from two
paths the deployment MUST also serve:

- **`/webgpu-assets/*`** — onnxruntime-web, demucs-web, transformers.js, the ft-ensemble
  glue, CREPE, and the ffmpeg-wasm core. In Loukai these are vendored + cached and served
  by `webgpuAssets.js`. For the offsite host, serve the same files at this path (copy the
  vendored set from `static/webgpu/` + the cached/downloaded libs, or front them with a
  small proxy mirroring `registerWebGpuAssets`).
- **`/webgpu-models/*`** — the ONNX/HF models (htdemucs, the Whisper model, crepe_tiny).
  In Loukai this proxies through to HuggingFace. For the offsite host, either proxy to
  HuggingFace the same way, or host the model files directly under this path.

**Secure context is mandatory** — deploy over **HTTPS** (or localhost for testing).
Without it `navigator.gpu` is undefined and the app falls back to (very slow) WASM.

Cross-origin isolation (COOP/COEP) is **not** required: the ffmpeg-wasm core is
single-threaded and ORT runs single-threaded without it (threads are a bonus when COOP+
COEP are present).

## How a created file gets into Loukai

1. Visitor creates on `karaoke-creator.loukai.com`, downloads `Artist - Title.stem.mp4`.
2. In Loukai's web admin (or the desktop app), Create tab → **Import a .stem.mp4** →
   choose the file. Loukai validates the kara atom, copies it into the songs folder, and
   (optionally) looks up reference lyrics + LLM-corrects. The audio/stems are untouched.

This is the same `/admin/library/import-stem` path the in-app import already uses.

## Notes / limits

- The offsite app intentionally exposes a **subset** of settings (fast single htdemucs,
  the Whisper model list, language, pitch toggle) — the audience is casual. The ft
  ensemble is omitted (large download, not hosted by default).
- LLM lyric correction is **not** run offsite (no backend / no keys). Correction happens
  later, on import into Loukai, if enabled.
- `stem-mp4`'s `writer.js` lazily imports `fs/promises` only when an `outputPath` is
  given; the offsite app never passes one, so it stays browser-safe. The Vite config
  aliases `stem-mp4/writer` + `stem-mp4/atoms` to the package's browser-safe submodules so
  the Node-only `reader.js` (child_process/music-metadata) is never bundled.
