#!/usr/bin/env node
/**
 * Ensure Electron is installed AND correctly extracted.
 *
 * Electron lives in `devDependencies` because electron-builder requires it
 * there (and bundles its own copy into the DMG/installer — Electron in
 * `dependencies`/`optionalDependencies` makes electron-builder copy the whole
 * ~200MB Electron package into the app on top of the framework). But a
 * production/npx install skips devDependencies, so Electron is absent at
 * runtime. `postinstall` still runs for those installs, so this bridges the gap
 * with two jobs:
 *
 *  1. INSTALL: if Electron is missing (production/npx consumer), install it from
 *     the version range declared in our own package.json. In the dev repo
 *     Electron is already present, so this never triggers.
 *
 *  2. REPAIR: Electron's own postinstall extracts its binary with `extract-zip`
 *     (bundling the unmaintained `yauzl@2.x`). On Node 24 that extractor
 *     silently stalls after the first zip entry, leaving a half-written `dist/`
 *     (only `LICENSES.chromium.html`, no `path.txt`). We re-extract the
 *     downloaded zip with the system archive tool (`unzip` on macOS/Linux,
 *     PowerShell on Windows), which is unaffected by the bug, then write
 *     `path.txt`.
 *
 * When Electron is already present and healthy, this is a silent no-op.
 * Best-effort throughout: it never fails the install; if it can't finish it
 * logs actionable guidance and exits 0.
 */

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdirSync,
} from 'fs';
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

function declaredElectronRange() {
  try {
    const pkg = require(join(projectDir, 'package.json'));
    return (
      (pkg.devDependencies && pkg.devDependencies.electron) ||
      (pkg.dependencies && pkg.dependencies.electron) ||
      null
    );
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

function extractZip(zipPath, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`],
      { stdio: 'ignore' }
    );
  } else {
    // `unzip` ships with macOS and virtually every Linux base image.
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'ignore' });
  }
}

function installElectron(range) {
  const spec = `electron@${range || 'latest'}`;
  log(`Electron not found; installing ${spec} (devDependency is skipped by production/npx installs)…`);
  // --no-save: don't touch package.json; install into this package's node_modules.
  execFileSync(
    'npm',
    ['install', spec, '--no-save', '--no-audit', '--no-fund', '--loglevel', 'error'],
    { cwd: projectDir, stdio: 'inherit', env: { ...process.env, npm_config_save: 'false' } }
  );
}

async function main() {
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

  // ---- Job 1: ensure the Electron package is present ----
  let electronDir = resolveElectronDir();
  if (electronDir == null) {
    const range = declaredElectronRange();
    if (range == null) {
      return; // we don't declare Electron at all — nothing to do
    }
    try {
      installElectron(range);
    } catch (err) {
      log(`Could not install Electron automatically: ${err.message}`);
      log('Install it manually with `npm install electron`, then re-run.');
      return;
    }
    electronDir = resolveElectronDir();
    if (electronDir == null) {
      log('Electron still not resolvable after install; aborting (best-effort).');
      return;
    }
  }

  const { version } = require(join(electronDir, 'package.json'));

  // ---- Job 2: ensure the binary is actually extracted ----
  if (isInstalled(electronDir, version, platformPath)) {
    return; // healthy — silent no-op (the common dev-repo case)
  }

  log(`Electron ${version} is not fully extracted; repairing (Node ${process.version} extract-zip workaround)…`);

  let zipPath;
  try {
    const getRequire = createRequire(join(electronDir, 'package.json'));
    const { downloadArtifact } = getRequire('@electron/get');
    let checksums;
    try {
      checksums = getRequire(join(electronDir, 'checksums.json'));
    } catch {
      checksums = undefined;
    }
    zipPath = await downloadArtifact({ version, artifactName: 'electron', platform, arch, checksums });
  } catch (err) {
    log(`Could not obtain the Electron zip: ${err.message}`);
    log('Run `npm rebuild electron` (Node 22 or earlier), or reinstall, to fix.');
    return;
  }

  const distDir = join(electronDir, 'dist');
  try {
    extractZip(zipPath, distDir);
    const srcTypeDef = join(distDir, 'electron.d.ts');
    if (existsSync(srcTypeDef)) {
      renameSync(srcTypeDef, join(electronDir, 'electron.d.ts'));
    }
    writeFileSync(join(electronDir, 'path.txt'), platformPath);
  } catch (err) {
    log(`Extraction failed: ${err.message}`);
    log('Ensure `unzip` (macOS/Linux) or PowerShell (Windows) is available, then reinstall.');
    return;
  }

  if (isInstalled(electronDir, version, platformPath)) {
    log('Electron ready.');
  } else {
    log('Repair did not produce a valid install; try `npm rebuild electron`.');
  }
}

main().catch((err) => {
  log(`Unexpected error (ignored): ${err.message}`);
});
