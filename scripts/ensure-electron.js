#!/usr/bin/env node
/**
 * Ensure the Electron binary is correctly extracted.
 *
 * Electron's own postinstall extracts its prebuilt binary with `extract-zip`
 * (which bundles the unmaintained `yauzl@2.x`). On Node 24 that extractor
 * silently stalls after the first zip entry, so the postinstall exits 0 with a
 * half-written `dist/` (only `LICENSES.chromium.html`, no `path.txt`). Later,
 * `require('electron')` throws "Electron failed to install correctly" and our
 * `bin/loukai.js` reports "Could not find Electron."
 *
 * This runs as loukai-app's own postinstall (after Electron's). If Electron is
 * already installed correctly it is a silent no-op. Otherwise it re-extracts
 * the downloaded zip using the system's archive tool (`unzip` on macOS/Linux,
 * PowerShell `Expand-Archive` on Windows), which is unaffected by the bug, and
 * writes `path.txt` — making `npx loukai-app` reliable on any Node version.
 *
 * Best-effort: never fails the install. If repair is impossible it logs
 * actionable guidance and exits 0.
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

const require = createRequire(import.meta.url);

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
    // PowerShell is present on all supported Windows versions.
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

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    return; // user opted out of the binary entirely
  }

  let electronPkg;
  try {
    electronPkg = require.resolve('electron/package.json');
  } catch {
    return; // electron not installed (e.g. devDeps pruned) — nothing to repair
  }

  const electronDir = dirname(electronPkg);
  const { version } = require(electronPkg);
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const platformPath = platformBinaryPath(platform);

  if (!platformPath) {
    log(`Unsupported platform "${platform}"; leaving Electron untouched.`);
    return;
  }

  if (isInstalled(electronDir, version, platformPath)) {
    return; // already good — silent no-op (the common case)
  }

  log(`Electron ${version} is not fully extracted; repairing (Node ${process.version} extract-zip workaround)…`);

  // Resolve the downloaded artifact zip. @electron/get returns the cached zip
  // path, or downloads it if missing (the download path is unaffected by the
  // extraction bug). Resolve it from Electron's own dependency tree.
  let zipPath;
  try {
    const getRequire = createRequire(electronPkg);
    const { downloadArtifact } = getRequire('@electron/get');
    let checksums;
    try {
      checksums = getRequire(join(electronDir, 'checksums.json'));
    } catch {
      checksums = undefined;
    }
    zipPath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform,
      arch,
      checksums,
    });
  } catch (err) {
    log(`Could not obtain the Electron zip: ${err.message}`);
    log('Run `npm rebuild electron` (Node 22 or earlier), or reinstall, to fix.');
    return;
  }

  const distDir = join(electronDir, 'dist');
  try {
    extractZip(zipPath, distDir);

    // Mirror Electron's install.js: hoist the type defs and write path.txt.
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
    log('Electron repaired successfully.');
  } else {
    log('Repair did not produce a valid install; try `npm rebuild electron`.');
  }
}

main().catch((err) => {
  // Never fail the install over this.
  log(`Unexpected error (ignored): ${err.message}`);
});
