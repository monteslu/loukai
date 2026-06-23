# Plan: unified host-side creation worker

## The core idea

Extract the WebGPU creation compute (Demucs separation + Whisper transcription +
CREPE pitch + AAC encode + stem-mp4 mux) out of the `WebGpuCreatorPanel` React
component and into a **worker-hosted creator service**: one engine that takes PCM
in and emits stems / lyrics / pitch out, with streamed progress events. The UI
just *commands* the worker and *renders* its progress.

This solves the problem that surfaced in this session: WebGPU only exists in a
**secure context** (localhost / HTTPS). The phone's web admin lives on
`http://<LAN-IP>` — no WebGPU, falls back to unusably slow WASM. By running the
compute in the **player renderer** (which is on `localhost` → WebGPU works) and
having the phone just *ask the host to create*, the secure-context problem never
touches the phone. The phone is a remote control; the host's GPU does the work.

## One engine, three front-ends

The same worker service is reused everywhere — only the transport differs:

| Context | Who commands the worker | How results return |
|---------|------------------------|--------------------|
| **Player (Electron)** | the player renderer directly | in-process to the panel |
| **Web admin (phone)** | phone → socket/HTTP → main → IPC relay → player renderer's worker | back through the relay to the phone |
| **Offsite web-light** (`karaoke-creator.loukai.com`) | the offsite page's own UI | in-tab (its own worker, same code) |

The offsite app (see `[[project_karaoke_creator_offsite]]`) becomes an OPTIONAL
escape hatch (offload to a requester's device, or when the host is busy), not the
only phone path. Host-side is the seamless default: install loukai on the Steam
Deck, open the phone, make + control songs — phone needs nothing.

## Role split (the keystone)

The **Node main process is the conductor.** Clean separation of concerns:

- **Worker (renderer)** = pure compute. PCM in → stems/lyrics/pitch out, emits
  progress. Knows nothing about phones, sockets, or the library.
- **UIs (player panel / phone admin / offsite)** = command + render. Ask for a
  job, show progress, done.
- **Node main process** = orchestration. Owns the job lifecycle (one job at a
  time, "already running" state — `creatorJob` already exists), brokers the
  request to the renderer's worker, fans worker progress OUT to every interested
  client (the requesting phone AND the player), and writes the finished file to
  the songs folder + triggers `syncLibrary`. Every cross-process hop goes through
  main; the worker and the phone never talk directly.

This is why progress is "just plumbing": main already is the socket.io hub +
renderer broker for playback/queue/effects/library — creation jobs slot into the
same conductor.

## What moves where

- **Compute → a Worker** (`creator-worker` in the renderer). Today
  `WebGpuCreatorPanel` runs separation/transcription/pitch INLINE in the React
  component (lines ~600-1360). All of that moves into the worker: model loading,
  demucs, whisper, crepe, the lyric grouping/cull (already pure functions in
  `shared/creator/creatorAudio.js`), and the ffmpeg-wasm AAC encode (already a
  worker — `aacWorker.js`; could be folded in or chained).
- **Panel → thin UI.** `WebGpuCreatorPanel` becomes: file picker + settings +
  progress display + save, posting a "create" job to the worker and rendering the
  streamed progress/result. Same component reused by player and offsite.
- **Worker driven by rawr** (already a dependency, already used for aacWorker) —
  `peer.methods.create(pcm, opts)` with progress as rawr notifications.

## Existing plumbing this builds on (verified)

- **`sendToRendererAndWait(channel, ...args)`** (main.js:2001) — generic main→
  renderer request/response relay. BUT two gaps for this use:
  - hardcoded **5s timeout** → creation takes ~80s. Needs a long-job variant.
  - **drops `...args`** (`webContents.send(channel)` ignores them) → needs to
    actually forward the payload.
  - no **progress streaming** → needs intermediate progress events, not just a
    final resolve. Model it on the WebRTC once-response pattern (main.js:426) but
    with a job id + progress channel.
- **Phone→main→renderer precedent** — `/admin/player/load` → `playerService` →
  `sendToRenderer`; settings changes use `sendToRendererAndWait` (webServer.js:
  1799). The relay shape is established.
- **The worker pattern itself** — `aacWorker.js` + `aacEncoder.js` (rawr over a
  module worker, ffmpeg-core loaded from same-origin) is the template.

## The real work (multi-session)

1. **Worker service**: move compute from the panel into a module worker; expose
   `create(pcm, opts)` + progress notifications via rawr. Models load the same
   way (`/webgpu-assets` same-origin in player/admin; CDN+SW in offsite).
2. **Long-job relay**: a `sendToRendererJob` variant — forwards payload, no short
   timeout, streams progress back to the caller (phone), returns the final stems.
3. **Payload shuttling**: input audio in + 5 stems out across phone↔main↔renderer
   ↔worker. Big buffers — use transferables inside the renderer; chunk or stream
   over socket/IPC for the phone hops. (Or: phone uploads audio via HTTP like the
   current save, worker writes results to the songs folder directly — avoids
   shipping stems back to the phone at all. PREFERRED — results never leave the
   host.)
4. **Progress UI**: route worker progress to whichever front-end asked (local
   React state for player/offsite; relayed events for the phone). This is a LOT of
   messages (per-stem separation %, transcription window N/M, pitch, encode, save,
   plus the diagnostic logs) — but it's just plumbing, not hard: loukai already
   streams `playback:state` / `queue:updated` / `effects:changed` /
   `library-refreshed` to the admin over socket.io. Creation progress is the same
   pattern on new channels (e.g. `creator:progress` { jobId, phase, pct, log }).
   The worker emits rawr notifications → renderer forwards to main → main socket-
   emits to the phone (and the player renders them locally). Volume, not difficulty.

## Honest caveats

- **Pegs the host CPU/GPU.** Separation is ~60s of heavy GPU. It WILL affect a
  currently-playing song. Mitigate: a "creating may affect playback" notice, and/
  or queue creation for between songs. Fine for the "setting up before the party"
  case; rough for hot-swapping mid-session.
- **Linux/Steam Deck WebGPU** already handled: main.js sets `enable-unsafe-webgpu`
  + `enable-features=Vulkan` + `ozone-platform=x11` (electron#41763). A hidden/
  background renderer inherits these process-wide flags.
- We chose **reuse the player renderer** (not a dedicated hidden window) for the
  worker host — less window plumbing; the worker keeps the heavy work off the
  player's UI thread anyway.

## Status

Plan only. Everything it builds on shipped this session (rawr worker pattern,
shared `WebGpuCreatorPanel`, `creatorAudio` pure functions, the import endpoint).
Relates to `[[project_webgpu_edge_compute]]`, `[[project_karaoke_creator_offsite]]`,
`[[project_webgpu_creator_parity]]`.
