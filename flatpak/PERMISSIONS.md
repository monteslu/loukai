# Flatpak permission justifications (for Flathub review)

Reviewers scrutinize every `finish-args` sandbox hole. This documents why each is
needed and the plan to narrow the broad ones.

| finish-arg | Why it's needed | Narrowable? |
|------------|-----------------|-------------|
| `--share=ipc` | Chromium/Electron shared-memory (X11) | No (standard for Electron) |
| `--socket=x11` / `--socket=wayland` | Display the app window | No |
| `--device=dri` | GPU rendering for the UI + Butterchurn visualizations, and WebGPU compute for the Creator (stem separation, transcription, pitch detection) | No |
| `--socket=session-bus` | Chromium requires the session bus (also used by the notifications portal) | No |
| `--socket=pulseaudio` | **Core feature** — karaoke audio output (PA + IEM buses) | No |
| `--share=network` | The web remote-control server (Express + Socket.IO) that singers connect to from phones; lyrics lookup (LRCLIB); model/runtime downloads for the Creator | No |
| `--filesystem=home` | The song library is a **user-chosen folder** anywhere under home; the library scanner reads audio files directly | **Yes — see below** |
| `--talk-name=org.freedesktop.Notifications` | Song-request notifications | Already minimal (talk-name, not own-name) |

## Narrowing `--filesystem=home` (the one reviewers flag)

Today the library scanner uses direct `fs` access to a user-configured folder, so
it needs broad read access. The Flathub-preferred approach is the **file-chooser
portal** (`xdg-desktop-portal`): the user picks their songs folder via the portal,
which grants access to *just that folder* without a static `--filesystem=home`
hole.

**Plan:** migrate the "choose songs folder" flow to the portal (the Electron
`dialog.showOpenDialog` already routes through the portal inside Flatpak; the
granted path persists via the documents portal). Once the scanner reads only the
portal-granted path, replace `--filesystem=home` with `--filesystem=xdg-music`
(a sensible default) plus the dynamically-granted folder.

This is a real app change (scanner + persistence), tracked as a follow-up. Until
it lands, `--filesystem=home` is requested with this justification; reviewers
commonly accept it for media-library apps with a clear rationale.

## Creator runtime deps

The Creator runs entirely in-browser (WebGPU via onnxruntime-web, WASM fallback) —
no Python, PyTorch, native modules, or system ffmpeg. On first use it downloads JS
libraries, wasm binaries, and ONNX models (onnxruntime-web, transformers.js /
Whisper, htdemucs ONNX, @ffmpeg/core wasm) through the app's same-origin caching
proxy (`src/main/creator/webgpuAssets.js`) into the user cache dir; subsequent
runs are fully offline. `--share=network` covers these one-time CDN (jsdelivr) /
Hugging Face fetches.
