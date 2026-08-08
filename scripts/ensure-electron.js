#!/usr/bin/env node
/**
 * Ensure an installed Electron is correctly extracted (repair-only).
 *
 * Electron lives in `devDependencies` because electron-builder requires it
 * there (and bundles its own copy into the DMG/installer — Electron in
 * `dependencies`/`optionalDependencies` makes electron-builder copy the whole
 * ~200MB Electron package into the app on top of the framework).
 *
 * REPAIR: if Electron is present but its dist/ is incomplete (e.g. an
 * interrupted first install), re-run Electron's own install.js. Historical
 * note: this job used to hand-roll download + system-unzip because Electron's
 * old extract-zip (bundling the dead yauzl@2) silently stalled on Node 24.
 * Electron now extracts with the native @electron-internal/extract-zip
 * (verified working on Node 24 with Electron 42), so its own installer is the
 * repair.
 *
 * If Electron is missing entirely (production/npx consumer — devDependencies
 * are skipped there), this does NOTHING: bin/loukai.js installs Electron into
 * a per-user runtime directory at launch instead. It used to `npm install`
 * Electron into this package's own node_modules here, but anything npm's
 * dependency tree doesn't declare gets pruned by npx's cache revalidation on
 * the next run, which broke every `npx loukai-app` launch after the first.
 * The launch-time install is outside npm's reach and self-heals.
 *
 * When Electron is already present and healthy, this is a silent no-op.
 * Best-effort throughout: it never fails the install; if it can't finish it
 * logs actionable guidance and exits 0.
 */

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, '..'); // package root (postinstall cwd may vary)

function log(msg) {
  console.log(`[ensure-electron] ${msg}`);
}

function platformBinaryPath(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      return null;
  }
}

function resolveElectronDir() {
  try {
    return dirname(require.resolve('electron/package.json', { paths: [projectDir] }));
  } catch {
    return null;
  }
}

function isInstalled(electronDir, version, platformPath) {
  try {
    const distVersion = readFileSync(join(electronDir, 'dist', 'version'), 'utf-8').replace(/^v/, '');
    if (distVersion !== version) return false;
    if (readFileSync(join(electronDir, 'path.txt'), 'utf-8') !== platformPath) return false;
  } catch {
    return false;
  }
  return existsSync(join(electronDir, 'dist', platformPath));
}

function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    return; // user opted out of the binary entirely
  }

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const platformPath = platformBinaryPath(platform);
  if (!platformPath) {
    log(`Unsupported platform "${platform}"; leaving Electron untouched.`);
    return;
  }

  // Missing entirely = production/npx consumer; bin/loukai.js handles that at
  // launch (see header). Only an existing install gets repaired here.
  const electronDir = resolveElectronDir();
  if (electronDir == null) {
    return;
  }

  const { version } = require(join(electronDir, 'package.json'));

  // ---- Ensure the binary is actually extracted ----
  if (isInstalled(electronDir, version, platformPath)) {
    return; // healthy — silent no-op (the common dev-repo case)
  }

  log(`Electron ${version} is not fully extracted; re-running its installer…`);
  try {
    execFileSync(process.execPath, [join(electronDir, 'install.js')], {
      cwd: electronDir,
      stdio: 'inherit',
      env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch },
    });
  } catch (err) {
    log(`Electron's installer failed: ${err.message}`);
    log('Run `npm rebuild electron` (or reinstall) to fix.');
    return;
  }

  if (isInstalled(electronDir, version, platformPath)) {
    log('Electron ready.');
  } else {
    log('Repair did not produce a valid install; try `npm rebuild electron`.');
  }
}

try {
  main();
} catch (err) {
  log(`Unexpected error (ignored): ${err.message}`);
}
