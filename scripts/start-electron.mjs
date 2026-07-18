/**
 * Launch Electron with a USABLE display environment (Linux). The x11+Vulkan GPU
 * default needs DISPLAY and a VALID XAUTHORITY before the process starts —
 * Chromium's zygotes fork before any app JS runs, so main.js cannot repair the
 * env (children inherit the broken one and the window comes up dead with
 * 'Authorization required, but no authorization protocol specified').
 *
 * Real-world launch envs this fixes:
 *  - tmux/screen shells carrying a STALE XAUTHORITY from a previous session
 *    (mutter's Xwayland cookie filename changes each boot)
 *  - shells with no XAUTHORITY exported at all (mutter does not export it)
 *  - shells with no DISPLAY (probe the XWayland socket)
 * If X still is not usable, LOUKAI_WAYLAND=1 is exported so main.js picks the
 * Wayland fallback (working window + viewer, WASM creation) instead of a
 * broken X window.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron'); // resolves to the binary path

const env = { ...process.env };
if (process.platform === 'linux' && env.LOUKAI_WAYLAND !== '1') {
  let ok = true;
  if (!env.DISPLAY) {
    if (existsSync('/tmp/.X11-unix/X0')) env.DISPLAY = ':0';
    else ok = false;
  }
  if (ok && (!env.XAUTHORITY || !existsSync(env.XAUTHORITY))) {
    // Discover mutter's current XWayland cookie (GNOME) or a classic Xauthority.
    let cookie = null;
    try {
      const dir = `/run/user/${process.getuid()}`;
      const f = readdirSync(dir).find((n) => n.startsWith('.mutter-Xwaylandauth'));
      if (f) cookie = `${dir}/${f}`;
    } catch {
      /* keep looking */
    }
    if (!cookie && env.HOME && existsSync(`${env.HOME}/.Xauthority`)) {
      cookie = `${env.HOME}/.Xauthority`;
    }
    if (cookie) env.XAUTHORITY = cookie;
    else ok = false;
  }
  if (!ok) {
    console.warn('[start] X11 not usable from this environment — falling back to Wayland mode');
    env.LOUKAI_WAYLAND = '1';
  }
}

const args = process.argv.slice(2);
const r = spawnSync(electron, args, { stdio: 'inherit', env });
process.exit(r.status ?? 1);
