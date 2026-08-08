#!/usr/bin/env node

/**
 * Loukai Karaoke - CLI Launcher
 *
 * Launches the Loukai Karaoke Electron app in production mode.
 *
 * Usage: npx loukai-app
 *
 * Electron resolution: Electron is a devDependency (electron-builder bundles
 * its own framework copy and would duplicate ~200MB into installers if it were
 * a runtime dependency), so production/npx installs don't receive it from npm.
 * It must NOT be installed into the package's own node_modules either: npx
 * revalidates its cache on later runs and prunes any package the dependency
 * tree doesn't declare, which deletes Electron after the first launch
 * (https://github.com/monteslu/loukai/issues — "Could not find Electron" on
 * the second `npx loukai-app`).
 *
 * So the launcher resolves Electron in this order:
 *   1. A normally-installed electron package (the dev repo, or any environment
 *      that installed it) — same as always.
 *   2. A per-user runtime directory outside npm's reach, keyed by the Electron
 *      version this package declares. npm never inventories it, so nothing
 *      ever prunes it.
 *   3. Install Electron into that runtime directory now (first launch only),
 *      then use it. Repairs half-extracted installs the same way.
 */

import { spawn, execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import os from 'os';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.join(__dirname, '..');

const require = createRequire(import.meta.url);

function electronRange() {
  const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf-8'));
  return (
    (pkg.devDependencies && pkg.devDependencies.electron) ||
    (pkg.dependencies && pkg.dependencies.electron) ||
    'latest'
  );
}

// Per-user cache location, overridable for tests/relocation.
function runtimeBaseDir() {
  if (process.env.LOUKAI_ELECTRON_DIR) return process.env.LOUKAI_ELECTRON_DIR;
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Caches', 'loukai', 'electron');
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'loukai',
        'electron'
      );
    default:
      return path.join(
        process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
        'loukai',
        'electron'
      );
  }
}

function runtimeDir(range) {
  // One directory per declared range: bumping Electron in a release lands in a
  // fresh directory instead of fighting a stale install.
  return path.join(runtimeBaseDir(), range.replace(/[^\w.-]/g, '_'));
}

// Resolve the electron binary from a directory that has electron in its
// node_modules. Returns null if the package is missing or its binary isn't
// extracted (electron's index.js throws in that case).
function resolveElectronFrom(dir) {
  try {
    const req = createRequire(path.join(dir, 'noop.js'));
    const electronPath = req('electron');
    if (typeof electronPath === 'string' && existsSync(electronPath)) {
      return electronPath;
    }
  } catch {
    // fall through
  }
  return null;
}

function npm(args, cwd) {
  execFileSync('npm', args, {
    cwd,
    stdio: 'inherit',
    // npm is npm.cmd on Windows; execFile needs a shell to find it.
    shell: process.platform === 'win32',
  });
}

function installRuntimeElectron(dir, range) {
  mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) {
    writeFileSync(
      manifest,
      JSON.stringify({ name: 'loukai-electron-runtime', private: true }, null, 2)
    );
  }
  console.log(`Downloading Electron ${range} (one-time setup)…`);
  npm(['install', `electron@${range}`, '--no-audit', '--no-fund', '--loglevel', 'error'], dir);

  let electronPath = resolveElectronFrom(dir);
  if (electronPath) return electronPath;

  // Package present but the binary isn't extracted (interrupted download?):
  // electron's own installer is the repair.
  const installJs = path.join(dir, 'node_modules', 'electron', 'install.js');
  if (existsSync(installJs)) {
    console.log('Electron install incomplete; repairing…');
    execFileSync(process.execPath, [installJs], {
      cwd: path.join(dir, 'node_modules', 'electron'),
      stdio: 'inherit',
    });
    electronPath = resolveElectronFrom(dir);
    if (electronPath) return electronPath;
  }
  return null;
}

function findElectron() {
  // 1. Normally-installed electron (dev repo, or a consumer that installed it).
  try {
    const electronPath = require('electron');
    if (typeof electronPath === 'string' && existsSync(electronPath)) {
      return electronPath;
    }
  } catch {
    // not installed here — use the runtime directory
  }

  const range = electronRange();
  const dir = runtimeDir(range);

  // 2. Already in the per-user runtime directory (every launch after the first).
  const cached = resolveElectronFrom(dir);
  if (cached) return cached;

  // 3. First launch (or a damaged cache): install it there now.
  return installRuntimeElectron(dir, range);
}

let electronPath = null;
try {
  electronPath = findElectron();
} catch (err) {
  console.error('Error: could not set up Electron.');
  console.error(err.message);
  process.exit(1);
}

if (!electronPath) {
  console.error('Error: could not set up Electron.');
  console.error('Check your network connection and try again, or install it manually:');
  console.error('  npm install electron');
  process.exit(1);
}

console.log('Starting Loukai Karaoke...');

// Launch Electron pointing at the app root
const child = spawn(electronPath, [appRoot, '--no-sandbox'], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('error', (err) => {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
