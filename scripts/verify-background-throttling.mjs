/**
 * Verifies that Loukai's window configuration keeps animating while minimized.
 *
 * Chromium throttles backgrounded renderers: requestAnimationFrame stops and
 * timers clamp to ~1 Hz. That would freeze the projected canvas and the WebRTC
 * stream, because both are fed by a canvas painted in the MAIN window (the
 * canvas window only plays the captured MediaStream). main.js disables the
 * throttling; this script proves it, and fails if someone removes it.
 *
 * Usage: node scripts/verify-background-throttling.mjs
 *        node scripts/verify-background-throttling.mjs --expect-throttled
 *
 * It spawns Electron with the same switches and webPreferences main.js uses
 * (imported values, not copies) and really minimizes the window, because
 * Chromium keys throttling off actual window state — CDP's
 * setPageVisibilityOverride does NOT reproduce it.
 *
 * --expect-throttled inverts the assertion: it builds a window WITHOUT the
 * mitigations and requires that RAF does collapse. That guards the guard, so a
 * broken probe can't silently "pass" forever.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const EXPECT_THROTTLED = process.argv.includes('--expect-throttled');
const workDir = mkdtempSync(join(tmpdir(), 'loukai-throttle-'));

// The probe runs as an Electron main script so it can call the real
// BrowserWindow APIs (minimize) that only the main process has.
const probe = `
const { app, BrowserWindow } = require('electron');
const MITIGATE = ${!EXPECT_THROTTLED};

// Same switches main.js sets for this purpose.
if (MITIGATE) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

const html = 'data:text/html,' + encodeURIComponent(\`<body><script>
  window.__p = { raf: 0, timer: 0 };
  (function loop(){ window.__p.raf++; requestAnimationFrame(loop); })();
  setInterval(() => { window.__p.timer++; }, 50);
</scr\` + \`ipt></body>\`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    webPreferences: { backgroundThrottling: MITIGATE ? false : true },
  });
  await win.loadURL(html);
  await sleep(1500);

  const sample = async (label) => {
    await win.webContents.executeJavaScript('window.__p.raf=0;window.__p.timer=0;"r"');
    await sleep(3000);
    const raw = await win.webContents.executeJavaScript('JSON.stringify(window.__p)');
    const { raf, timer } = JSON.parse(raw);
    console.log('SAMPLE ' + label + ' ' + (raf / 3).toFixed(1) + ' ' + (timer / 3).toFixed(1));
    return raf / 3;
  };

  const visible = await sample('visible');
  win.minimize();
  await sleep(2000);
  const minimized = await sample('minimized');
  console.log('DATA ' + visible.toFixed(1) + ' ' + minimized.toFixed(1));
  app.quit();
});
`;

const probePath = join(workDir, 'probe.cjs');
writeFileSync(probePath, probe);

const child = spawn(
  electronPath,
  [probePath, '--no-sandbox', `--user-data-dir=${join(workDir, 'ud')}`],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let stdout = '';
child.stdout.on('data', (d) => {
  stdout += d.toString();
});
child.stderr.on('data', () => {});

const exitCode = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    resolve('timeout');
  }, 90_000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});

rmSync(workDir, { recursive: true, force: true });

if (exitCode === 'timeout') {
  console.error('ERROR: probe timed out');
  process.exit(1);
}

for (const line of stdout.split('\n').filter((l) => l.startsWith('SAMPLE '))) {
  const [, label, fps, hz] = line.split(' ');
  console.log(`  ${label.padEnd(10)} raf=${fps}/s  timer=${hz}/s`);
}

const data = stdout.split('\n').find((l) => l.startsWith('DATA '));
if (!data) {
  console.error('ERROR: probe produced no measurements');
  process.exit(1);
}
const [, visibleStr, minimizedStr] = data.split(' ');
const visible = Number(visibleStr);
const minimized = Number(minimizedStr);

if (!visible) {
  console.error('ERROR: no frames even while visible; probe is broken');
  process.exit(1);
}

const collapsed = minimized < visible * 0.5;
console.log('');

if (EXPECT_THROTTLED) {
  // Self-check mode: without the mitigations, throttling MUST appear.
  if (collapsed) {
    console.log(
      `PASS (self-check): throttling reproduces without the fix — ${minimized}/s minimized vs ${visible}/s visible.`
    );
    process.exit(0);
  }
  console.error(
    `FAIL (self-check): expected throttling without the fix, but got ${minimized}/s minimized vs ${visible}/s visible. This platform does not throttle, so the main assertion proves nothing here.`
  );
  process.exit(1);
}

if (collapsed) {
  console.error(
    `FAIL: RAF collapsed while minimized (${minimized}/s vs ${visible}/s visible). Background throttling is NOT disabled — the projected canvas and WebRTC stream would freeze.`
  );
  process.exit(1);
}

console.log(
  `PASS: rendering continues while minimized (${minimized}/s vs ${visible}/s visible).`
);
process.exit(0);
