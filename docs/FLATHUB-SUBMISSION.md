# Flathub submission — ready-to-execute steps

The Flatpak builds, installs, launches, and validates locally (see commits in
the `feat/gpu-creator-and-web-create` branch). The remaining steps require
actions only the maintainer can take (posting to a forum, pushing, opening a PR,
accepting a GitHub invite). Everything is prepared below.

---

## M0b — Resolve the runtime-download policy with reviewers (DO THIS FIRST)

The one unresolved risk (from the deep research): Flathub is build-from-source +
offline + minimal-permissions. loukai's Creator downloads Python (now extra-data),
ffmpeg, and **PyTorch/ROCm wheels (~4.5 GB, dependency-resolved, per-machine)** at
runtime. Whether reviewers accept this — and via what mechanism — gates M1.8.

**Post this to https://discourse.flathub.org (Submissions / App Maintenance):**

> **Title:** Policy for an app that downloads a GPU ML runtime (PyTorch/ROCm) at runtime?
>
> Loukai (com.loukai.app) is an AGPL-3.0 Electron karaoke app. Its optional
> "Creator" turns a song into stem-separated karaoke using Demucs + Whisper
> (PyTorch). The player has no such needs.
>
> I've moved the bundled Python interpreter and (planned) ffmpeg to `extra-data`.
> The hard part is PyTorch: the right wheels are ~4.5 GB, dependency-resolved, and
> differ per machine (CUDA vs ROCm vs CPU vs DirectML) — so a single pinned
> extra-data set can't serve all users.
>
> Questions:
> 1. Is it acceptable to download the PyTorch wheels at runtime into the app's
>    data dir (with `--share=network`), given they're not redistributable as one
>    pinned set? Or must everything be extra-data?
> 2. Are there precedent ML/LLM-frontend apps on Flathub whose manifest/finish-args
>    I can follow?
> 3. Is `--filesystem=home` acceptable for a media-library app while I migrate the
>    songs-folder picker to the file-chooser portal? (rationale in PERMISSIONS.md)

**Decision recorded here once answered:** _(pending)_

---

## M1.8 — PyTorch/ROCm wheels for Flatpak (gated on M0b)

Three implementable options; pick per M0b's answer:

- **(a) Runtime download to data dir** (if reviewers allow): smallest manifest;
  `downloadManager` already does this — just confirm it writes under the Flatpak
  data dir and `--share=network` is present. Lowest effort.
- **(b) extra-data per-variant**: enumerate every wheel (like a pip
  generated-sources) per backend, pinned. Huge bundle, but fully offline-install.
  Would need a small generator script for the torch wheel set.
- **(c) CPU-only in the Flatpak, GPU via npx/AppImage**: ship a CPU torch as
  extra-data (one pinnable set), point power users to the npx/AppImage channel
  for GPU. Compromise that's definitely Flathub-compliant.

Recommendation if M0b is ambiguous: ship **(c)** to get on Flathub, offer GPU via
the other (already-working) channels.

---

## M1.6 — Submit to flathub/flathub (after M0b + a push)

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
   runtime-download per M0b).
6. On approval, accept the GitHub invite (2FA, within ~a week); the app moves to
   its own repo under the Flathub org.

**Prereqs already satisfied:** manifest valid + builds offline, generated-sources.json
present, metainfo passes `appstreamcli validate`, desktop file validates, AGPL-3.0
is a recognized FOSS license, app-id is reverse-DNS for a domain you control
(loukai.com).
