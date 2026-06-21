# Plan: Create songs from the Web Admin interface

**Status:** Draft / proposal
**Feature:** Let an authenticated web-admin user create a `.stem.mp4` karaoke file from a browser — including uploading a new audio/video file from a remote device — running the same Demucs/Whisper/CREPE pipeline the Electron Creator tab uses.
**Decisions locked in:**

- **Add a file-upload endpoint** so a remote browser can send audio to the server (full remote create), in addition to picking files already in the songs folder.
- Deliverable: this plan document.

---

## What already exists (don't rebuild it)

The web server **already exposes most of the Creator backend**, all wired to the same shared `creatorService` the Electron IPC uses:

- `GET  /admin/creator/status` → `creatorService.checkComponents()` + `getStatus()` (`webServer.js:1803`)
- `POST /admin/creator/install` → `installComponents()`, progress via `io.to('admin-clients').emit('creator:install-progress')` (`:1818`)
- `POST /admin/creator/cancel-install` (`:1843`)
- `POST /admin/creator/search-lyrics` → `findLyrics()` (`:1854`)
- `POST /admin/creator/file-info` → `getFileInfo()` **— path must be inside songs folder** (`validateSongPath`, `:1871`)
- `POST /admin/creator/convert` → `startConversion()`, progress via `io.to('admin-clients')` socket events (`:1896`)
- `POST /admin/creator/cancel-convert` (`:1953`)
- `GET  /admin/creator/sources` → library files eligible as conversion sources (`:1965`)

**The gaps:**

1. **No upload.** `/file-info` and `/convert` both require a path already inside the songs folder (path-traversal guarded). A remote browser has no way to get a *new* file onto the host. **This is the core missing piece.**
2. **No `WebBridge` methods** for any creator operation (`WebBridge.js` has zero `creator*`). The web client would currently have to hand-roll `fetch`/socket calls — which violates the bridge rule (`.clauderc`).
3. **No web UI.** `src/web/` has no Creator page/component. The Electron `CreateTab.jsx` is **not reusable as-is** — it calls `window.kaiAPI.creator.*` **directly** (`CreateTab.jsx:155,289-302,312,404…`), not through a bridge, so it's Electron-only today.
4. **Concurrency/session model is unaddressed** — see the dedicated section below; this is the part that needs careful design before coding.

---

## ⚠️ Concurrency & session model (decide this first)

This is the crux the feature lives or dies on. Three independent facts:

### Fact 1 — Conversion is a hard, process-wide singleton
`conversionService.js:25` `let conversionInProgress` is **module-level**. `runConversion` throws `'Conversion already in progress'` if it's set (`:116-118`). Install has the same lock (`creatorService.js:30`). Because **Electron IPC and the web server call the same `creatorService`**, this lock is shared across *all* entry points. There is exactly **one** conversion slot for the whole Loukai process.

### Fact 2 — Progress is broadcast to ALL admins, not the requester
Every creator socket event uses `io.to('admin-clients').emit(...)` (`webServer.js:1921-1947`). There is no per-socket or per-session targeting. If two browsers are open on `/admin`, **both** see the same conversion's progress/console/complete events.

### Fact 3 — "Admin" is anonymous and shared, not per-user
The session is just `req.session.isAdmin = true` + `loginTime` (`webServer.js:295-296`). Anyone with the admin password is "the admin." There is **no per-user identity** and no notion of "my session's job." Multiple sockets can be authenticated as admin simultaneously, all sharing one logical admin identity. (The singer/request UI at `/api/*` is fully unauthenticated and keyed only by a `localStorage` name.)

### The question the user raised: one song at a time per server, or multiple?

**Recommendation: enforce ONE conversion at a time per Loukai server (single global job), and make that explicit and shared — not silent.** Rationale:

- It matches reality. A conversion pins CPU/GPU (Demucs especially). Running two on one box isn't a UX nicety problem — it's a "both run 3× slower and may OOM the GPU" problem. The user already flagged performance; concurrency here is genuinely bounded by hardware, not by code elegance.
- It matches the existing model. The singleton lock already exists and is shared across IPC + web. We should **lean into it** as the intended design, not fight it.
- It avoids a per-user identity system we don't have. We don't need real multi-tenant sessions; we need a **single shared job that every admin surface (Electron + every web admin) observes consistently.**

One job is fine. **The hard requirement is that both UIs (Electron Creator tab and the web Creator page) must visibly communicate when a job is already running** — including a UI that was just opened or refreshed *after* the job started. That can't work today for two concrete reasons:

- **`getStatus()` returns a bare boolean** — `converting: isConversionInProgress()` (`creatorService.js:57-64`). Even though `/admin/creator/status` and the IPC `GET_STATUS` already exist, they can't tell a UI *what* is running, *how far*, or *what the console says*.
- **The Electron Create tab never asks on mount.** `CreateTab.jsx`'s mount effect only calls `checkComponents()` + loads settings (`CreateTab.jsx:176-214`); it then **passively waits for live events**. So a Create tab opened (or navigated back to) mid-job shows a blank form and is unaware anything is running. The web UI doesn't exist yet, so it inherits the same blind spot unless we design against it.

So the model is **a single, observable global "current creator job"** with this contract:

1. **One job at a time.** `POST /admin/creator/convert` (and the Electron `START_CONVERSION`) while a job is active returns **409 Conflict** (web) / a structured `{ success:false, busy:true, job }` (IPC), instead of throwing an opaque error. Both UIs show "A conversion is already running" and offer to **attach** to it (switch to the live job view) rather than letting the user start a second one.
2. **A rich, shared job descriptor — not a boolean.** Promote conversion state to one descriptor held in a single place (extend `appState` or a new `creatorJob` module) and make `getStatus()` return it:
   `{ id, status: 'idle'|'running'|'complete'|'error'|'cancelled', step, progress, title, artist, source, device, startedAt, finishedAt, error, consoleTail: string[] }`.
3. **Both UIs pull on mount AND react to live events (the actual fix for your requirement).** Every Creator surface must, on open:
   - **Pull** the current job via `getStatus()` (IPC) / `GET /admin/creator/status` (web). If `status === 'running'`, render the **live job view** (progress bar, step, console tail) immediately instead of the empty Create form — *this is what closes the "opened after it started" gap, and it must be added to `CreateTab.jsx` too, not just the new web page.*
   - **Subscribe** to live updates (existing `creator:conversion-*` socket events on web; existing IPC `onConversion*` on Electron) so an already-open UI updates in real time and flips to "busy" the moment *another* surface starts a job.
4. **Late-join / refresh safety.** `getStatus()` and the admin socket-connect handshake both return the descriptor *with* a `consoleTail`, so a refreshed/late browser re-attaches with context instead of a blank or frozen view. (Today a refresh loses all progress — events are fire-and-forget.)
5. **Cross-surface parity (Electron ⇄ web).** Because the lock is shared, a job started in the Electron tab must **block** web converts **and appear** in the web job view, and vice-versa. To make that real, job updates must be broadcast on **both** transports: keep the `io.to('admin-clients')` socket emits **and** add `sendToRenderer` IPC emits driven from the same descriptor. (Right now web converts only emit to sockets, so the Electron tab wouldn't see a web-started job, and vice-versa.)
6. **Single cancel.** Any admin can cancel the one job (`cancel-convert` is already global). Acceptable under the shared-admin model — document it; reflect cancel in the descriptor so every surface updates.

**Explicitly NOT doing:** a multi-job queue, per-user job ownership, or parallel conversions. If a queue is ever wanted, it's a clean follow-up: the descriptor becomes the head of a list and `convert` enqueues instead of 409-ing. Note that today even the *first* song auto-loads to the player when added to an empty *playback* queue (`queueService.addSongToQueue` `wasEmpty`) — that's unrelated to a *conversion* queue; don't conflate them.

> This section is the main design change. The upload + UI work below is comparatively mechanical; the job-descriptor refactor — plus making **both** UIs pull-on-mount and broadcast on **both** transports — is what makes "is something already running?" answerable everywhere.

### Conversion vs. live playback (the PC/TV scenario) — mostly fine on the GPU path

**Primary use case:** a living-room PC/TV (Bazzite/SteamOS/HTPC) running the Electron app as the **player + canvas** on the big screen, while everyone interacts from phones. Nobody is at the keyboard — so "create a song" will almost always arrive from a **remote browser** *while a karaoke session is actively playing*.

**This is largely a non-concern in the intended setup.** Two reasons, both from the project's own constraints:

- **Conversion is meant to run on the GPU** (see `PLAN-vulkan-torch.md`). When Demucs/Whisper run on the GPU, the heavy lifting is **off the CPU**, leaving the real-time audio engine the headroom it needs. GPU offload is precisely what makes create-while-playing viable.
- **The visuals are light.** Butterchurn here is simple WebGL — not GPU-intensive — so a GPU-based Demucs run and the canvas aren't meaningfully fighting for the GPU either.

So the design is intentionally **minimal**, not a heavy coexistence system:

1. **Allow** create during playback — no block, no queue-until-idle. (Trust the KJ; this is the social moment.)
2. **One small, conditional warning:** if a conversion is about to run **on CPU** (no GPU acceleration active — the device resolver/`getStatus` already knows the actual device) *and* playback is active, the web Creator UI shows a light note: *"Running on CPU while playing — you may notice audio/visual hiccups."* On the GPU path, **no warning** — it's expected to be fine. "Is playing" comes from the playback state already broadcast to admins; no new detection plumbing.
3. **Cancel is one click** (global `cancel-convert`) on either surface, if anything does go sideways.

**Deliberately NOT building** (unless real-world CPU-path boxes prove painful): live xrun surfacing in the web job view, queue-until-idle, or block-during-playback. The engine *does* emit `xrun`/`latencyUpdate` (`audioEngine.js`; renderer gets them via `ElectronBridge.js:578-588`) — so if we ever want a live "dropouts: N" indicator it's a small follow-up — but it's **not** in scope given the GPU happy path. The single-job descriptor leaves room to add any of these later without rework.

---

## Upload design

### Endpoint
`POST /admin/creator/upload` (admin-auth, rate-limited like other admin API). Accepts `multipart/form-data` with one audio/video file (+ optional `title`/`artist` fields).

- **Library/middleware:** add `multer` (disk storage) — simplest, well-trodden, integrates with Express 5. (`busboy` is the lighter alternative if we want zero new deps beyond what multer pulls in; multer is recommended for clarity.)
- **Destination:** a dedicated uploads/temp dir (e.g. `<cacheDir>/uploads/` from `systemChecker.getCacheDir()` or an OS temp dir), **not** straight into the songs folder. The conversion output (`.stem.mp4`) is what lands in the songs folder, via the existing `outputDir` option.
- **Constraints:** enforce max file size (config, e.g. 500 MB), allow-list extensions (mirror `creatorHandlers` SELECT_FILE filters + `/sources` list: mp3/wav/flac/ogg/m4a/aac/mp4/mkv/avi/mov/webm), sanitize the filename. Reject anything else with 400.
- **Response:** `{ success, fileId, path, info }` where `info` comes from the existing `creatorService.getFileInfo()` run against the uploaded temp path (so the client gets duration/tags just like the Electron flow).

### Path validation interaction
Current `/convert` forces `validateSongPath(inputPath, songsFolder)` and rejects anything outside the songs folder (`webServer.js:1904-1912`). Uploaded files live in the uploads/temp dir, so we must allow that path too. Options:

- Add an **allowed-roots** notion to validation: a path is valid if it's inside the songs folder **or** the uploads dir. Implement by extending the validator (or adding a second guarded root) — keep the traversal protection, just widen the allowed base set. **Do not** disable validation.
- Carry an internal `fileId → resolved temp path` map from the upload step so `/convert` can accept a `fileId` instead of a raw path (defense in depth: the client never names a filesystem path for uploaded files).

### Cleanup
- Delete the uploaded temp file after conversion completes/fails (the pipeline already cleans its *own* `kai-convert-*` temp dir in `conversionService` `finally`; the **upload** temp is ours to remove). Add it to the job's completion/error handling.
- Sweep stale uploads on startup (best-effort), and cap total uploads dir size.

---

## Bridge + UI work

### WebBridge (new methods — required so UI obeys `.clauderc`)
Add to `WebBridge.js`, mirroring how the Electron side talks to creator but over REST/socket:

- `getCreatorStatus()` → `GET /admin/creator/status`
- `installCreatorComponents()` → `POST /admin/creator/install`
- `searchCreatorLyrics(title, artist)` → `POST /admin/creator/search-lyrics`
- `getCreatorSources()` → `GET /admin/creator/sources`
- `uploadCreatorFile(file, {title, artist}, onProgress)` → `POST /admin/creator/upload` (XHR/fetch with upload progress)
- `startConversion(options)` → `POST /admin/creator/convert`
- `cancelConversion()` → `POST /admin/creator/cancel-convert`
- `getCreatorJob()` → current job descriptor (from status)
- `onCreatorEvent(cb)` / via `onStateChange('creatorJob', cb)` → subscribe to `creator:conversion-progress|console|complete|error` socket events (add `creatorJob` to the `onStateChange` event map, or expose dedicated subscribe methods).

> Consider adding the **same methods to `ElectronBridge`** (wrapping `window.kaiAPI.creator.*`) and **refactoring `CreateTab.jsx` to use the bridge**, so the bridge contract finally covers creator on both sides and a *shared* Creator component becomes possible (see UI options). This is optional but is the "right" architectural move and removes the only major place the Creator bypasses the bridge.

### BridgeInterface
Add the creator method stubs to `src/shared/adapters/BridgeInterface.js` so both bridges share the contract (consistent with every other domain in that file).

### Web UI
Two routes:

- **Option A (recommended): build a web Creator component** (`src/web/components/CreatorPanel.jsx` or a shared `src/shared/components/CreatorPanel.jsx`) that uses the bridge. Add a **"Create" tab** to the web admin (`src/web/App.jsx` tab list `:395-461`). It must:
  - Show install/status state (reuse `/status`).
  - Offer **two source modes**: upload a new file (drag-drop / file input → `uploadCreatorFile`) **or** pick from `getCreatorSources()`.
  - Pre-fill title/artist (from upload `info` or chosen source), optional lyrics lookup via `searchCreatorLyrics`.
  - Surface the **shared job view**: if a job is already running (from any surface), show its live progress/console instead of a fresh form; allow cancel; re-attach on refresh using the job descriptor.
  - Include the **whisper model / CREPE / (and the Vulkan toggle from the other plan)** options, persisted via existing settings endpoints.
- **Option B (faster, less reuse):** a web-only minimal panel that only does upload→convert with sane defaults, no source-picker, no settings. Ship-fast; layer the rest later. *Not recommended given we're already adding upload + bridge.*

Recommendation: **Option A**, ideally as a **shared component** once `CreateTab` is bridge-ified, so Electron and web converge. If sharing is too big a lift now, build a web-specific `CreatorPanel` first and converge later.

---

## Phased implementation

### Phase 0 — Job-descriptor refactor + "already running" visibility on both UIs (do this first; it's the backbone)
1. Promote conversion state to a single observable **`creatorJob`** descriptor (new `creatorJob` state on `appState`, or a small module the web server + IPC both read). Keep the existing singleton lock semantics; just make the state rich + readable. **Make `getStatus()` return the descriptor** (replace the bare `converting` boolean at `creatorService.js:57-64` — keep `converting` as a derived alias for back-compat).
2. `convert` (web) returns **409 + current job** when busy; `START_CONVERSION` (IPC) returns `{busy:true, job}` when busy. Replace the opaque `'Conversion already in progress'` throw (`conversionService.js:116-118`) with this structured result.
3. Broadcast job updates to **both** transports: `io.to('admin-clients')` socket events (already there) **and** `sendToRenderer` IPC (so the Electron Create tab and any web admin stay in sync regardless of who started it). Drive both from the one descriptor.
4. `GET /admin/creator/status`, the IPC `GET_STATUS`, and admin socket-connect all return the current job **+ console tail** (late-join/refresh safety).
5. **Electron `CreateTab.jsx`: pull-on-mount.** Add a `getStatus()` call to the mount effect (`CreateTab.jsx:176-214`); if `status === 'running'`, render the live job view (progress + console tail) instead of the blank Create form, and disable "start" with a "conversion already running" notice. (Today it only `checkComponents()` + waits for events, so a tab opened mid-job is blind — this step is the Electron half of your requirement.)
6. The new web Creator page does the same pull-on-mount + subscribe (built in Phase 3, but the contract is set here).

**Exit:** starting a conversion from *either* surface blocks the other and is **visible on both** — including a Create tab/page that is opened or refreshed *after* the job started, which shows live progress + console tail rather than a blank form.

### Phase 1 — Upload endpoint
1. Add `multer` (disk storage to uploads/temp dir), size/type/filename guards.
2. `POST /admin/creator/upload` → store file, run `getFileInfo`, return `{fileId, path, info}`.
3. Widen path validation to allow the uploads dir (or accept `fileId` in `/convert`). Keep traversal protection.
4. Upload-temp cleanup on job completion/error + startup sweep.

**Exit:** a remote browser can upload a file and get back duration/tags; the path is accepted by `/convert`.

### Phase 2 — Bridge methods
1. Add creator methods to `BridgeInterface` + `WebBridge` (and ideally `ElectronBridge`).
2. Add `creatorJob` to `WebBridge.onStateChange` event map (or dedicated subscribe methods).

**Exit:** web client can drive the whole creator flow through the bridge — no raw `fetch`/socket in components.

### Phase 3 — Web Creator UI
1. Add Create tab + `CreatorPanel` (web or shared) using the bridge.
2. Source modes (upload / pick-from-library), metadata, lyrics lookup, options, **shared job view** with attach-on-refresh + cancel.

**Exit:** an authenticated remote browser can upload audio and produce a `.stem.mp4` in the songs folder, watching live progress; a second browser sees the same job.

### Phase 3.5 — Playback coexistence (minimal; mostly a non-concern on the GPU path)
1. Web Creator UI reads live playback state (already broadcast to admins) and shows **one light, conditional warning** only when a conversion would run **on CPU** while playback is active. No warning on the GPU path.
2. That's it. **No** xrun plumbing, queue-until-idle, or block-during-playback — explicitly out of scope given GPU offload + light WebGL visuals.

**Exit:** a phone-initiated create on a CPU-only box mid-session gets a gentle heads-up; on the GPU path it just works. Cancel (already global) covers the rare bad case. Stronger policies remain a documented, low-effort follow-up the single-job descriptor already accommodates.

### Phase 4 — Convergence + polish (optional)
1. Refactor `CreateTab.jsx` to the bridge; collapse Electron + web Creator into one shared component.
2. Library re-sync after web conversion completes (mirror `CreateTab.jsx:276` `library.syncLibrary()`), so the new song appears in everyone's library.
3. Rate-limit / size-limit tuning; progress for very large uploads over slow links.

---

## Files to touch

| File | Change |
|------|--------|
| `src/main/creator/conversionService.js` | expose richer job state (id/step/progress/source); keep singleton lock; structured busy result |
| `src/main/appState.js` (or new `src/main/creatorJob.js`) | hold the single `creatorJob` descriptor + emit changes |
| `src/main/webServer.js` | new `POST /admin/creator/upload` (multer); `/convert` returns 409 when busy + accepts `fileId`; status/connect return current job + console tail; widen path validation to uploads dir |
| `src/main/handlers/creatorHandlers.js` | `START_CONVERSION` returns structured busy result; broadcast job updates via `sendToRenderer` |
| `src/shared/services/creatorService.js` | `getStatus()` returns the job descriptor (not a bare boolean); thread descriptor through `startConversion`; upload-temp cleanup hook |
| `src/renderer/components/creator/CreateTab.jsx` | **Phase 0:** pull `getStatus()` on mount; if a job is running, show the live job view + "already running" notice instead of the blank form. (Phase 4: switch to bridge / converge.) |
| `src/shared/adapters/BridgeInterface.js` | add creator method stubs |
| `src/web/adapters/WebBridge.js` | add creator methods (status/install/search/sources/upload/convert/cancel/job) + `creatorJob` subscription |
| `src/renderer/adapters/ElectronBridge.js` | (optional) add matching creator methods wrapping `window.kaiAPI.creator.*` |
| `src/web/App.jsx` | add **Create** tab |
| `src/web/components/CreatorPanel.jsx` *(or `src/shared/components/`)* | **new** web Creator UI (upload + pick + job view), pull-on-mount + subscribe |
| `package.json` | add `multer` (or `busboy`) |
| `docs/architecture.md` | document the single-job creator model + upload path |

---

## Security considerations (web-exposed file ingestion)

- **Auth:** all creator routes are under `/admin/*` and already protected by the admin-session middleware (`webServer.js:315-336`). Upload must be too — never expose creator endpoints under `/api/*` (the unauthenticated singer surface).
- **Upload abuse:** enforce max size, extension allow-list, filename sanitization, and the existing admin API rate limiter (60/min). Store uploads outside the songs folder; only the produced `.stem.mp4` enters it.
- **Path traversal:** keep `validateSongPath`; widen *allowed roots* rather than disabling it; prefer `fileId`-indirection so clients never name raw paths for uploaded files.
- **Resource exhaustion:** the single-job model is itself a safety control — one conversion pins the machine; the 409-when-busy contract prevents a remote user from spawning many heavy jobs. (This is a second reason the concurrency decision matters beyond UX.)
- **Disk:** cap uploads dir size; clean temp on completion/error + startup sweep.

## Open questions to resolve during build
- Where exactly do uploads live — `<cacheDir>/uploads` vs OS temp? (Lean `<cacheDir>/uploads` so it's co-located with creator assets and easy to sweep.)
- Do we want the produced song's `outputDir` to always be the songs folder for web converts (yes, so it's playable), vs configurable? (Default: songs folder.)
- Should a web-started job be cancelable from Electron and vice-versa? (Per the shared-admin model: **yes**, document it.)
