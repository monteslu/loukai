# Manual test: host-side creation from a phone

This validates the end-to-end "Create on this host" flow: a phone web-admin uploads a
song, the desktop **player** runs the WebGPU creation on its GPU, and the finished
`.stem.mp4` lands in the library — with live progress on the phone the whole time.

This path can't be exercised headlessly (it needs a real GPU + a browser), so run it by
hand. ~5 minutes.

## Prerequisites

- The desktop machine (the "host") and the phone are on the **same network**.
- The host has a working GPU (WebGPU). On Linux the app already sets the needed flags
  (`enable-unsafe-webgpu`, Vulkan, x11 ozone).
- A test song the host can decode: `.mp3` / `.wav` / `.flac` / `.m4a` / `.mp4`, etc.
- The web admin password is set (Server tab in the app, or `server.adminPasswordHash`).

## Steps

### 1. Launch the player on the host

```bash
cd loukai
npm start          # or: npm run dev   (builds first)
```

Wait until the main window is up. Set a **Songs folder** (Settings) if you haven't —
the created file is written there.

### 2. Find the web-admin URL

In the app's **Server** tab, enable the web server and note the URL. It's
`http://<HOST-LAN-IP>:3069`. The admin lives at **`http://<HOST-LAN-IP>:3069/admin`**.
(Tip: the canvas shows a QR code you can scan from the phone.)

### 3. On the phone: open the admin and log in

- Browse to `http://<HOST-LAN-IP>:3069/admin`.
- Log in with the admin password.
- Open the **⚡ Create** tab.

### 4. Confirm the host-create UI is offered

You should see a **"Create on this host ⚡"** card at the top. It only appears when a
player is running (`hostAvailable` from `/admin/creator/status`). If you only see the
"online creator / import" cards, the player isn't reachable — recheck step 1/2.

### 5. Create

- Pick your test song. Title/Artist prefill from the filename (`Artist - Title.ext`) —
  edit if needed.
- Tap **Create on host ⚡**.
- The request is accepted immediately and a **blue progress banner** appears:
  *"Creating your song on the host…"* with a moving bar, the current step
  (separating → transcribing → pitch → saving), and an expandable progress log.

### 6. Watch it run on the host

On the host machine, the creation runs in the player renderer (DevTools console shows
the `⏱️ TIMING_WEB` line and per-stage logs). A 3–4 min song typically takes ~30–90s on
a decent GPU. **Playback may briefly stutter** during separation — expected; we run
immediately rather than queueing.

### 7. Confirm success

- The phone banner flips to **"✓ Created `<file>` and added it to the library."**
- The new song appears in the **Library** (host + every admin) without a manual refresh
  (host-create runs `syncLibrary`).
- Find `Artist - Title.stem.mp4` in your Songs folder. Play it — vocals should be
  separable and lyrics should display with timing.

## Cross-surface checks (the single-job contract)

- **Two admins:** open `/admin` on a second device. While a creation runs, both should
  show the live banner (one as "your song", the other as "running on a web admin").
- **Busy rejection:** try to start a second creation (phone or the desktop Create tab)
  while one is running → it should refuse with "a creation is already running" (HTTP 409
  on the web path), not start a parallel job.
- **Desktop ↔ phone parity:** a creation started in the desktop Create tab should show
  the amber "running on the desktop player" banner on the phone, and vice-versa.

## Failure modes to verify (optional, but valuable)

- **Player closed mid-job:** close the desktop window during a phone creation. The job
  should end in **error** on the phone within the idle watchdog window (≤5 min), not hang
  forever. (Backed by `hostCreateRelay` unit tests.)
- **Unreadable file:** upload a non-audio file renamed to `.mp3` → it should fail
  cleanly with an error, and a subsequent valid creation should still work (no stuck
  `running` state).
- **Temp cleanup:** after a few runs (and after a forced-quit mid-run), the
  `webgpu-creator` temp dir under the creator cache should not accumulate leftovers — a
  startup sweep clears orphans on next launch.

## Where things live (for debugging)

| Piece | File |
|---|---|
| Phone Create UI | `src/web/components/CreatorImportPanel.jsx` |
| Upload route + orchestration | `src/main/webServer.js` (`/admin/creator/host-create`) |
| Long-job relay | `src/main/main.js` `runHostCreate` → `src/main/creator/hostCreateRelay.js` |
| Headless compute on the host | `src/renderer/hooks/useHostCreateListener.js` → `src/shared/creator/hostCreate.js` |
| The compute itself | `src/shared/creator/createKaraoke.js` |
| Job state + broadcast | `src/main/creator/creatorJob.js`, `src/main/main.js` `setupStateListeners` |
| Live banner | `src/shared/components/creatorUi.jsx` `CreatorJobBanner` |
