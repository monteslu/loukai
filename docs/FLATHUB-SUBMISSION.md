# Flathub submission — ready-to-execute steps

The Flatpak builds, installs, launches, and validates locally (see commits in
the `feat/gpu-creator-and-web-create` branch). The remaining steps require
actions only the maintainer can take (posting to a forum, pushing, opening a PR,
accepting a GitHub invite). Everything is prepared below.

> **2026-06 update — the hard part is gone.** The Creator no longer uses
> Python / PyTorch / ROCm. Stem separation (Demucs) and transcription (Whisper)
> now run **entirely in-browser via WebGPU** (onnxruntime-web + demucs-web +
> transformers.js, with ONNX model weights). There is **no `downloadManager`,
> no pip, no 4.5 GB per-machine wheel set** anymore. What the Creator still
> needs at runtime is small, pinned, and finite — see M1.8 below. The player
> needs none of it.

---

## M0b — Resolve the runtime-download policy with reviewers (optional now)

Flathub is build-from-source + offline-install + minimal-permissions. The only
remaining tension: the Creator fetches a **fixed, pinned set** of JS/WASM/ONNX
assets on first use (vendored same-origin by `webgpuAssets.js`), plus a native
**ffmpeg** for the `.stem.mp4` save path. Unlike the old PyTorch problem, every
one of these is a single pinnable artifact — so this is a normal bundling task,
not a blocker. The forum question is now *optional* (ask only if you'd rather
runtime-download than bundle); the safe default is bundle-as-extra-data (M1.8).

If you do want reviewer guidance, post to https://discourse.flathub.org
(Submissions / App Maintenance):

> **Title:** Bundling vs. runtime-fetching a fixed set of WASM/ONNX ML assets
>
> Loukai (com.loukai.app) is an AGPL-3.0 Electron karaoke app. Its optional
> "Creator" does stem separation + transcription **in-browser via WebGPU**
> (onnxruntime-web, demucs-web, transformers.js + ONNX model weights). No
> Python/PyTorch. The player needs none of this.
>
> The assets are a **fixed, version-pinned set** (~a few hundred MB of ONNX
> weights + a few MB of JS/WASM), the same for every user/arch. Plus a native
> ffmpeg for one mux/encode step.
>
> Questions:
> 1. Preference for shipping these as `extra-data` (pinned, offline-install) vs.
>    fetching once at first use into the app data dir (with `--share=network`)?
> 2. Is `--filesystem=home` acceptable for a media-library app while I migrate
>    the songs-folder picker to the file-chooser portal? (rationale in
>    PERMISSIONS.md)

**Decision recorded here once answered:** _(pending — not blocking)_

---

## M1.8 — Bundle the Creator's WebGPU assets + ffmpeg (the only real work)

The exhaustive asset list is the source of truth in
`src/main/creator/webgpuAssets.js` (`ASSETS`, `FT_MODELS`, `HTDEMUCS_URL`,
`HF_BASE`). Keep versions in lockstep with `WebGpuCreatorPanel.jsx`. As of this
writing: ORT `1.27.0`, demucs-web `1.0.2`, transformers.js `3.8.1`.

What gets fetched at runtime today:
- **JS/WASM libs** (jsDelivr, pinned versions): onnxruntime-web bundles + wasm
  (asyncify + jsep pairs), demucs-web ESM, transformers.min.js.
- **ONNX model weights** (HuggingFace): the `monteslu/htdemucs-ft-webgpu`
  ensemble, the fast `htdemucs_embedded.onnx` (timcsy/demucs-web-onnx), silero
  VAD, and whatever Whisper model transformers.js pulls. (crepe_tiny.onnx is
  already bundled in `static/webgpu/`.)
- **ffmpeg** (native, Creator-only): currently the only native binary. See
  **M1.9** — it reduces to a single job (WAV→AAC encode) and the plan is to
  eliminate it (ffmpeg-wasm) rather than bundle it. If shipping before M1.9 is
  done, `getFFmpegPath()` checks system PATH first → use the runtime's ffmpeg.

Two implementable options — pick per M0b (default: **(a)** unless reviewers say
otherwise):

- **(a) extra-data, pinned (recommended, definitely compliant):** enumerate the
  fixed asset set with sha256 + size, ship as `extra-data` so the install is
  fully offline. A small generator can read `webgpuAssets.js` and emit the
  extra-data block. (ffmpeg: being eliminated — see M1.9.)
- **(b) runtime-fetch to data dir (lowest effort):** keep `webgpuAssets.js`
  fetching on first use; just confirm it writes under the Flatpak data dir and
  add `--share=network`. Allowed only if M0b says so.

Either way: confirm the cache dir (`getCacheDir()` →
`src/main/creator/systemChecker.js`) resolves to a Flatpak-writable path inside
the sandbox.

---

## M1.9 — Eliminate native ffmpeg (the last native dependency)

Native `ffmpeg` is the only native binary the app still needs, and it is
**Creator-only** (the player never touches it). Audited live call sites — there
are exactly THREE real uses, and all three reduce to one hard problem:

| Use | Caller | Removable? |
|-----|--------|-----------|
| `getAudioInfo` (ffprobe) — input duration/codec/sample-rate | `creatorService.js:96` | **Yes** — the browser already decodes the input (`decodeAudioData`), so duration/sampleRate/channels are known from the `AudioBuffer`. Legacy probe. |
| `isVideoFile` (ffprobe) — "does input have a video stream" | `creatorService.js:97` | **Yes** — irrelevant once the browser has the audio; `decodeAudioData` extracts audio from a video container for free. Legacy probe. |
| **WAV → AAC encode + mux** | `stem-mp4@0.4.0` internals, via `StemMp4Writer.write({stemsWavFiles, codec:'aac'})` in `creatorService.js:316` | **mux: yes** (pure-JS) · **AAC encode: the one genuinely hard part** |

(`convertToWav`, `encodeToAAC`, `extractAudio`, `extractStemTrack`,
`getFFprobePath` in `ffmpegService.js` have **zero live callers** — dead code
from the Python era; delete them.)

### The stem-mp4 version gap (load-bearing)

loukai pins `stem-mp4@^0.4.0`. The **published/installed** 0.4.0 is the OLD
ffmpeg-based writer: it takes WAV (`stemsWavFiles`/`mixdownWav`) and internally
shells out to ffmpeg for BOTH the AAC encode (Step 1) and the multi-track mux
(Step 3). That hidden ffmpeg dependency is why the app needs a native ffmpeg at
all today.

The local rewrite (`kai/stem-mp4`, also tagged 0.4.0 but **unpublished** and
API-incompatible) is **pure-JS, no ffmpeg** — its writer takes **pre-encoded
AAC** (`stemsAac`/`mixdownAac`) and does container + atoms only. Design intent:
keep encoding OUT of the library (it shouldn't be the lib's job to manage a
codec) and let the caller supply AAC. So migrating to it MOVES the AAC-encode
burden into loukai — it doesn't remove it — but it does kill the mux ffmpeg.

> Action: publish the rewrite as a new version (e.g. 0.5.0 — don't reuse 0.4.0,
> the API differs), bump loukai's pin, and switch `creatorService.js` to pass
> `stemsAac` instead of `stemsWavFiles`.

**Verified writer/muxer contract** (read from `kai/stem-mp4` `writer.js` +
`muxer.js`):
- `StemMp4Writer.write({ stemsAac:{drums,bass,other,vocals}, mixdownAac, ... })`
  — each value is **AAC samples inside an MP4/M4A container** (Uint8Array/
  ArrayBuffer/Buffer). The file EXTENSION is irrelevant — `muxTracks` reads bytes,
  doing `findTrack` → `moov`/`trak`/`mdia`/`minf`/`stbl`. What matters is the
  CONTAINER: it must be MP4-wrapped, NOT a raw **ADTS** elementary stream.
  - ✅ `ffmpeg -c:a aac out.m4a` (MP4 container) — works (even if named `.aac`)
  - ❌ `ffmpeg -c:a aac out.aac` (ADTS, no `moov`) — `findTrack` returns null →
    throws. ADTS has no sample table; parsing it would mean synthesizing
    stsz/stts/esds from ADTS headers = codec logic = breaks pure-JS. Forbidden.
  So the takeaway is "AAC-in-MP4, not ADTS" — not "must be named `.m4a`". It's an
  MP4→MP4 remuxer, not a frame packer; loukai's encoder must emit MP4-wrapped AAC
  per stem (5 total). `ffmpeg.exec(['-i','x.wav','-c:a','aac','x.m4a'])` fits.
- All 5 must be encoded with **identical params** (sample rate, priming) so the
  shared-mdat sample tables line up.
- `encoderDelaySamples` defaults to **1105 = ffmpeg's native aac** priming delay,
  used to align lyric timing. ffmpeg-wasm = same encoder → leave at 1105. A
  DIFFERENT encoder (e.g. libxaac) has a different priming delay → must pass the
  correct `encoderDelaySamples` or lyrics drift. (Another reason ffmpeg-wasm is
  the low-risk choice.)
- The writer is isomorphic (Node + browser; returns `data` bytes). Option for
  later: run ffmpeg-wasm in the RENDERER (stems are already PCM there before
  `encodeWav`), build the whole `.stem.mp4` client-side, POST the finished file —
  no server-side encode at all. Bigger refactor; not needed for submission.

**HARD INVARIANT — `stem-mp4` is PURE JS. No native deps, no wasm, no codec.**
The library only ever parses + remuxes containers and writes atoms (byte
manipulation). All audio encoding/decoding is the CALLER's job. This is the
constraint that drives the rest:
- **AAC-in-MP4 only; do NOT accept raw ADTS (`.aac` elementary streams).**
  Container, not extension — a `.aac` file is usually ADTS (bare frames, no
  `moov`). Accepting that would force the lib to synthesize stsz/stts/esds from
  ADTS headers + know the encoder priming delay — re-absorbing the codec
  responsibility, which breaks pure-JS. Every real encoder emits MP4-wrapped AAC
  for free (`ffmpeg -c:a aac out.m4a`), so "accept both" buys callers nothing
  while widening the surface.
- The legitimate axis for future flexibility is *more codecs inside `.m4a`* (e.g.
  ALAC lossless stems) — still "parse a real container," still pure JS. Not
  container-vs-raw.
- If a caller ever has raw frames, wrap them with a small separate helper in the
  CALLER, never an overloaded `write()`.
- **Pre-publish cleanup:** the published 0.4.0 `reader.js` still shells out to
  native ffmpeg (`exec("ffmpeg … -c copy")`) for track extraction — that violates
  pure-JS. The rewrite already has a pure-JS `extractor.js` ("without requiring
  FFmpeg"); confirm `reader.js`'s ffmpeg path is removed/replaced before publishing
  the new version, else the lib isn't actually pure-JS.

### So the lone blocker is WAV → AAC encode. DECISION: browser ffmpeg-wasm in the renderer.

Encoder options were explored and settled (2026-06):

- ❌ **ffmpeg-wasm in Node** — dead. Official `@ffmpeg/ffmpeg` dropped Node support
  at 0.12.0; the only Node fork is abandoned (2023). Not viable.
- ❌ **WebCodecs AudioEncoder** — AAC not ubiquitous (unsupported on desktop Linux
  in any browser, and Firefox on all platforms). Fails for loukai's own target
  (Linux host + admin browser). Rejected.
- 🗄️ **Custom `libxaac-wasm`** — built and working
  (github.com/monteslu/libxaac-wasm, 1.8 MB, benchmarks at/above ffmpeg's native
  aac on synthetic signals, priming delay measured at 1600). **Shelved:** real-music
  quality unproven without ViSQOL, and the C/wasm maintenance surface isn't worth it
  versus the proven path. Revisitable later as a size optimization.
- ✅ **Browser `@ffmpeg/ffmpeg` (0.12.x) in the RENDERER** — the chosen path. It is
  the officially-supported environment for ffmpeg-wasm. The stems are already PCM in
  the WebGPU panel, so encode each to AAC-in-MP4 there
  (`ffmpeg.exec(['-i','x.wav','-c:a','aac','x.m4a'])`), POST the 5 `.m4a`. ~25 MB
  wasm, fetched once + LAN-cached like the other WebGPU assets (no new native dep,
  no `--share=network` for encode). `encoderDelaySamples` = **1024** (ffmpeg native
  aac), passed to `StemMp4Writer.write`.

**Net for Flathub:** migrate to pure-JS stem-mp4 0.5.0, drop the dead ffprobe
calls, encode via browser ffmpeg-wasm in the renderer. No native binary remains.

---

## M1.6 — Submit to flathub/flathub (after M1.8 + a push)

1. **Push the branch + tag** so the manifest's pinned commit is reachable:
   `git push origin feat/gpu-creator-and-web-create` and create/push tag `v0.6.0`
   at the commit the manifest pins (update `commit:` in flathub-manifest.yml to the
   pushed SHA first).
2. Fork `github.com/flathub/flathub`, clone the **`new-pr`** branch:
   `git clone --branch=new-pr git@github.com:<you>/flathub.git`
3. `git checkout -b com.loukai.app new-pr`, add `com.loukai.app.yml` (= our
   flathub-manifest.yml) + generated-sources.json (or a `flathub.json` that points
   at our repo's manifest, per current Flathub external-manifest support).
4. Open a PR **against the `new-pr` base branch** (NOT master).
5. Respond to reviewer feedback (finish-args scrutiny — see PERMISSIONS.md;
   asset-bundling per M1.8).
6. On approval, accept the GitHub invite (2FA, within ~a week); the app moves to
   its own repo under the Flathub org.

**Prereqs already satisfied:** manifest valid + builds offline, generated-sources.json
present, metainfo passes `appstreamcli validate`, desktop file validates, AGPL-3.0
is a recognized FOSS license (LICENSE + THIRD-PARTY-NOTICES.md now in repo), app-id
is reverse-DNS for a domain you control (loukai.com).

---

## Cleanup left over from the Python era (do alongside M1.8)

- `flathub-manifest.yml` header comment + line ~82 still mention Python/PyTorch
  and "ffmpeg fetched by downloadManager" — `downloadManager` no longer exists.
  Update to describe the WebGPU asset set + ffmpeg.
- `flatpak/PERMISSIONS.md:37` still says "downloads a bundled Python (extra-data),
  ffmpeg, and PyTorch" — fix.
- `docs/PLAN-vulkan-torch.md` describes the old ROCm/PyTorch path — mark as
  superseded by the WebGPU creator (keep for history or delete).
- `src/shared/defaults.js` still has a `torchDevice` default — harmless, but a
  dead field now; remove when convenient.
