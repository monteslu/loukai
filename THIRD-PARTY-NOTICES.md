# Third-Party Notices

Loukai Karaoke (AGPL-3.0) bundles or builds upon the third-party works listed
below. Each remains under its own license; the notices here are reproduced to
satisfy those licenses' attribution requirements. This file covers bundled
**assets** and notable upstream works; the full dependency tree and its licenses
are described by `package.json` / `package-lock.json`.

---

## Material Icons (font)

- File: `static/fonts/material-icons.woff2`
- Source: https://github.com/google/material-design-icons
- License: Apache License 2.0

> Copyright Google, Inc.
>
> Licensed under the Apache License, Version 2.0 (the "License"); you may not
> use this file except in compliance with the License. You may obtain a copy of
> the License at http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
> WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
> License for the specific language governing permissions and limitations under
> the License.

---

## Butterchurn & Butterchurn Presets

- Packages: `butterchurn`, `butterchurn-presets`
- Source: https://github.com/jberg/butterchurn — https://butterchurnviz.com
- License: MIT

The visualizer preset preview thumbnails in
`static/images/butterchurn-screenshots/` were rendered by this project from the
`butterchurn-presets` pack (MIT). The presets themselves are community MilkDrop
presets distributed under that package.

> The MIT License (MIT)
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

---

## CREPE (pitch detection model)

- File: `static/webgpu/crepe_tiny.onnx` — exported by this project from
  `torchcrepe` (see `tools/webgpu-ft-export/export_crepe_onnx.py`)
- Source: https://github.com/marl/crepe — https://github.com/maxrmorrison/torchcrepe
- License: MIT

> The MIT License (MIT)
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

---

## CDGraphics

- Package: `cdgraphics`
- Source: https://github.com/bhj/cdgraphics
- License: ISC

---

## aubio / aubiojs

- Package: `aubiojs` (WASM build of aubio, used for realtime pitch tracking)
- Source: https://github.com/aubio/aubio — https://github.com/qiuxiang/aubiojs
- License: GPL-3.0 (compatible with this project's AGPL-3.0)

---

## Vendored Creator libraries (shipped in packages)

The in-browser Creator's JS/wasm libraries are downloaded at build time by
`scripts/vendor-webgpu-assets.js` (pinned versions in
`src/main/creator/webgpuAssets.js`) into `static/webgpu/` and shipped inside
the installers and the npm package:

- **onnxruntime-web** (Microsoft) — MIT — https://github.com/microsoft/onnxruntime
- **@huggingface/transformers** (transformers.js) — Apache-2.0 —
  https://github.com/huggingface/transformers.js
- **@ffmpeg/core** (ffmpeg.wasm core) — MIT wrapper around **FFmpeg**
  (LGPL-2.1+) — https://github.com/ffmpegwasm/ffmpeg.wasm — https://ffmpeg.org

(Builds produced without network access — e.g. the Flathub-from-source build —
omit them; there the app fetches the same pinned files at runtime through its
same-origin caching proxy instead.)

## Runtime-fetched Creator models

The ML models are fetched at first Creator use from Hugging Face via the app's
same-origin caching proxy, cached locally, and re-served by the app:

- **Whisper** speech-to-text model weights (OpenAI) — MIT — via onnx-community
  timestamped exports
- **Demucs / htdemucs** stem-separation models (Meta AI) — MIT —
  https://github.com/facebookresearch/demucs — ONNX exports served from
  Hugging Face (incl. `monteslu/htdemucs-ft-webgpu`; provenance in
  `tools/webgpu-ft-export/model-card.md`)
- **Silero VAD** — MIT — https://github.com/snakers4/silero-vad — used by the
  vocal-gating step (`static/webgpu/vad-gate.js`)
