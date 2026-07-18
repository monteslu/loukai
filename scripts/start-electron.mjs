/**
 * Launch Electron with a usable display environment (Linux). Chromium's zygotes
 * fork before any app JS runs, so display env vars must be correct BEFORE the
 * electron binary spawns — main.js cannot repair them.
 *
 * The app runs on the session's native ozone platform (Wayland on a Wayland
 * desktop — forcing x11 there creates NO toplevel window at all). What this
 * launcher fixes is stale/missing env in long-lived shells (tmux/screen):
 *  - WAYLAND_DISPLAY missing → probe the runtime dir for the wayland socket
 *  - DISPLAY/XAUTHORITY missing or stale → repair for XWayland fallback
 *    (mutter's cookie filename changes every boot)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron'); // resolves to the binary path

const env = { ...process.env };
if (process.platform === 'linux') {
  const runDir = env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  env.XDG_RUNTIME_DIR = env.XDG_RUNTIME_DIR || runDir;

  if (!env.WAYLAND_DISPLAY) {
    try {
      const sock = readdirSync(runDir).find((n) => /^wayland-\d+$/.test(n));
      if (sock) env.WAYLAND_DISPLAY = sock;
    } catch {
      /* not a wayland session */
    }
  }

  if (!env.DISPLAY && existsSync('/tmp/.X11-unix/X0')) env.DISPLAY = ':0';
  if (env.DISPLAY && (!env.XAUTHORITY || !existsSync(env.XAUTHORITY))) {
    let cookie = null;
    try {
      const f = readdirSync(runDir).find((n) => n.startsWith('.mutter-Xwaylandauth'));
      if (f) cookie = `${runDir}/${f}`;
    } catch {
      /* keep looking */
    }
    if (!cookie && env.HOME && existsSync(`${env.HOME}/.Xauthority`)) {
      cookie = `${env.HOME}/.Xauthority`;
    }
    if (cookie) env.XAUTHORITY = cookie;
  }
}

const args = process.argv.slice(2);
const r = spawnSync(electron, args, { stdio: 'inherit', env });
process.exit(r.status ?? 1);
