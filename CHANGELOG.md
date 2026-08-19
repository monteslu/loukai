# Changelog

All notable changes to Loukai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.14.1] - 2026-08-19

### Fixed
- Singers reaching the app by its machine name or a `.local` address (the usual
  way a tablet finds it on the LAN) could load the page but never connect for
  live updates; the request page kept retrying forever instead of showing the
  queue. Socket.IO's CORS check only recognized localhost and literal local
  IPs; it now allows the same same-origin connection Express already trusts,
  comparing the browser's Origin against the Host the request actually arrived
  on (#124)

### Changed
- The kiosk request page now fills the screen on a tablet or laptop instead of
  staying a narrow mobile-width column, moves search to the left with a
  Request button on each result, and lists the artist on its own line under
  the title (#125)
- Artist names in search results and the song list are now shown in blue

## [0.14.0] - 2026-08-18

### Added
- Kiosk page: an opt-in request page at `/kiosk` for a device everyone shares,
  such as a tablet at the KJ booth. It browses like the normal request page but
  never remembers anyone: there is no one-time name prompt, every request asks
  who is singing, and the name is cleared after each submission. `localStorage`
  is never read or written in this mode, so a stale name from an earlier session
  can't be reused. Off by default; `/kiosk` returns 404 until the KJ enables it
  in Server settings (#121)

### Fixed
- Library search in the app returned nothing for queries that should have
  matched: a typo, words in a different order, or an artist and title together
  (such as "queen bohemian") all came back empty. The Library panel was using a
  literal substring filter instead of the shared Fuse-backed ranking already
  used by quick search and the singer page; every surface now searches and ranks
  identically (#122)
- Search results were cut off at 8 rows in quick search and on the singer page,
  which on a large library discarded the song you wanted before it could be
  drawn. All search surfaces now return up to 50 rows; the dropdowns already
  scrolled (#122)

## [0.13.3] - 2026-08-12

### Fixed
- Singers can now scan the QR code and browse and request songs when the app is
  reached through a reverse proxy or tunnel; the page and its requests
  previously failed with server errors

## [0.13.2] - 2026-08-12

### Fixed
- The custom QR code address now updates the on-screen QR code and the Server
  tab as soon as it is saved, and reverts correctly when switched back off
- The web server port setting is now saved and used (it was ignored, always
  starting on 3069); changing it takes effect after restarting the app

## [0.13.1] - 2026-08-12

### Fixed
- The song request page and the whole web admin failed to load (server errors)
  when the app was started with `npx loukai-app`; installed desktop builds were
  unaffected
- The "Powered by Loukai" link on the song request page pointed at the wrong
  domain

## [0.13.0] - 2026-08-12

### Added
- Point the QR code at your own address, for when a reverse proxy, tunnel or
  custom hostname fronts the app, so singers scan something they can actually
  reach (Server settings)

### Fixed
- Tooltips stay visible instead of flashing and vanishing
- Visuals keep running when the main window is minimized, so projected karaoke
  and remote viewers no longer freeze while the control window is out of the way
- Fixed a crash when quitting the app or turning the web server off during a song

## [0.12.0] - 2026-08-08

### Added
- Game controller support: drive the entire app with a gamepad. D-pad or stick
  moves a visible focus ring, A activates, B closes dialogs, Start toggles
  play/pause, shoulder buttons switch tabs
- Controllers are read natively (SDL), so they keep working when the window
  isn't focused

### Fixed
- `npx loukai-app` failed to find Electron on every launch after the first
- Disabled spellcheck underlines in text fields

### Security
- Security updates for networking dependencies

## [0.11.0] - 2026-08-02

### Added
- Chord detection v2: bass-first root notes for much more accurate chords
- Evaluate/Reevaluate Chords button in the song editor
- Editor search overhaul: better multi-word matching, artist matches on short
  queries, stem-song-only results

### Fixed
- The app opened to a blank window on new installs and updates (a bad default in
  saved settings crashed the player screen; existing installs heal automatically)
- The editor keyboard froze after deleting or retiming lyric lines

## [0.10.1] - 2026-07-21

### Security
- Updated bundled dependencies for newly published advisories (node-tar,
  body-parser); no feature changes from 0.10.0

## [0.10.0] - 2026-07-21

### Added
- Real-time chord display for players following along on guitar, bass, or keys:
  current chord big, next chord previewed, top right of the karaoke screen and
  on every phone/browser viewer
- Chords are detected automatically when a song is created, and existing library
  songs analyze themselves the first time they play with the display on
- Works on CDG/MP3 songs too (display only)
- Chord names transpose live with the key shift (Am becomes Bm at +2)
- Edit chords in the song editor like lyrics: timeline rows, pick-list names,
  and a tone preview per chord
- Off by default; enable Show Chords under Display Options

### Fixed
- Deleting a lyric line no longer risks timing fields showing the wrong line's
  values
- Clearer wording on the web Create tab

## [0.9.0] - 2026-07-18

### Added
- Key shift: transpose the loaded song up or down 6 semitones live from the
  player or the web admin. The band and guide vocal shift together, the singer's
  mic never does
- Shows the transposed key while shifted (Am to Bm at +2) when the song's key is
  known
- Per-song by design: resets to 0 on every load and is never saved to settings
- Zero cost when unshifted; the pitch processor is fully bypassed at 0

## [0.8.1] - 2026-07-18

### Fixed
- Saving a song in the editor ran the whole file rebuild on the process that
  routes keyboard input, freezing typing app-wide for seconds on larger files.
  The save now runs in a worker thread and input stays live throughout

## [0.8.0] - 2026-07-18

### Added
- Per-stem volume and mute on each output bus: give the singer a vocals-on
  monitor mix while the room hears the karaoke mix, live from the web admin
- Monitors (IEM) start fully muted so nothing leaks on single-sound-card setups

### Changed
- Better default lyrics model (Whisper large-v3-turbo, multilingual with
  language auto-detect)
- Stem separation runs on the GPU or fails fast with a clear message; no more
  silent hour-long CPU runs
- Newly created songs appear in the app library instantly, with no manual sync

### Fixed
- Linux: native Wayland with GPU song creation AND casting to phones/browser
  viewers working at the same time; terminal launches always bring up the window
- A second launch focuses the running app instead of failing
- Queue Load works for `.stem.mp4` files
- Editor timestamp fields no longer eat keystrokes

### Removed
- Legacy `.kai` code paths

## [0.7.0] - 2026-07-17

### Added
- WebGPU creator: GPU karaoke creation from any surface (in-app,
  phone-commanded host creation where the web admin uploads and the desktop
  player runs the GPU job, and the offsite creator) (#59)
- Chained 21-piece demucs split model with live toggle and cancel; optional
  htdemucs_ft "best quality" ensemble
- Full Whisper language list in creator dropdowns; auto-detect with fallback
- AIFF (.aif/.aiff) accepted by all import surfaces and the host-create upload (#58)
- Creator JS/wasm libraries (onnxruntime-web, transformers.js, ffmpeg-core) are
  now vendored into packages at build time, with no CDN dependency at runtime;
  ML models remain download-on-first-use (#65)

### Changed
- Electron 42; no native modules remain (pure JS/WASM), so compiler toolchains
  were removed from release CI; `ensure-electron` repair now reuses Electron's
  own installer (#65)
- Docs corrected across README/CONTRIBUTING/PACKAGING/architecture/flatpak to
  match the post-Python reality (#65)

### Fixed
- LAN web song requests failed with "Song ID and requester name are required":
  the client sent the sanitized-away `path` instead of the song `id` (#60)
- Real first-run download progress for chained model files (stream-through)

### Removed
- Dead `src/native/` legacy autotune module (#65)

## [0.6.0] - 2026-06-21

### Added
- In-app GPU acceleration for stem separation and transcription via WebGPU
  (WASM fallback), with no Python or extra installs
- Create karaoke files from the web admin, including file upload
- Word-level lyric timing from timestamped Whisper models with vocal-energy
  refinement

## [0.1.22] - 2025-10-12

### Added
- Improved lyric editor: clicking a text field now selects the row

### Changed
- Enhanced selection visibility with better color contrast
- Text inputs are now more clearly editable

## [0.1.21] - 2025-10-12

Early development release with core karaoke features.

### Added
- Multi-format support (KAI, CDG, MP3+CDG)
- Real-time stem mixing and vocal effects
- Web-based song request system
- Auto-tune system with pitch correction
- Butterchurn visualizations

---

## Version History Notes

### Version Numbering

- **Major (X.0.0)**: Breaking changes, major new features
- **Minor (0.X.0)**: New features, backwards-compatible
- **Patch (0.0.X)**: Bug fixes, small improvements

### Release Process

1. Update CHANGELOG.md with all changes
2. Add a `<release>` entry to `com.loukai.app.metainfo.xml`
3. Update the version in package.json: `npm version [major|minor|patch]`
4. Push the release branch and merge its pull request
5. Tag the merge commit and push tags: `git push --follow-tags`
6. Build and publish packages

### Links

- [Unreleased Changes](https://github.com/monteslu/loukai/compare/v0.14.0...HEAD)
- [0.14.0 Release](https://github.com/monteslu/loukai/releases/tag/v0.14.0)

---

**Legend:**
- **Added** - New features
- **Changed** - Changes to existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Vulnerability fixes
