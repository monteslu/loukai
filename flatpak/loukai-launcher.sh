#!/bin/sh
# Flatpak launcher for Loukai. Routes the Electron binary through zypak so
# Chromium's setuid sandbox maps onto the Flatpak sandbox (Flatpak disallows
# SUID binaries). TMPDIR is kept inside the app's runtime dir.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
mkdir -p "$TMPDIR"
# electron-builder names the binary after the package name ("loukai-app").
exec zypak-wrapper /app/loukai/loukai-app "$@"
