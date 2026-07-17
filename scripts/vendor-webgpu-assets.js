#!/usr/bin/env node
/**
 * Vendor the WebGPU Creator's JS/WASM assets into static/webgpu.
 *
 * The creator's code-layer assets (onnxruntime-web, transformers.js,
 * ffmpeg-core wasm — ~80MB total, pinned versions in webgpuAssets.js ASSETS)
 * are normally fetched from jsdelivr on first use and cached. Vendoring them
 * into static/webgpu at build time means packaged apps (and the npm package)
 * serve them locally with no CDN dependency — webgpuAssets.js already prefers
 * static/webgpu over the download path. The ML models stay runtime-fetched
 * (too big to ship: Whisper alone is ~540MB).
 *
 * Runs as part of build:all. Idempotent: existing non-empty files are skipped,
 * so it only downloads on a fresh checkout. OFFLINE-TOLERANT by design: a
 * failed download logs a warning and does NOT fail the build (Flathub builds
 * run fully offline — there the app simply keeps the runtime-fetch fallback
 * until the assets are added as pinned manifest sources).
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ASSETS } from '../src/main/creator/webgpuAssets.js';

const here = dirname(fileURLToPath(import.meta.url));
const destRoot = join(here, '..', 'static', 'webgpu');

// The demucs/* entries are deprecated compatibility shims for old offsite
// builds — not worth shipping in every package.
const skip = (key) => key.startsWith('demucs/');

let vendored = 0;
let present = 0;
let failed = 0;

for (const [key, url] of Object.entries(ASSETS)) {
  if (skip(key)) continue;
  const dest = join(destRoot, key);
  if (existsSync(dest) && statSync(dest).size > 0) {
    present++;
    continue;
  }
  const tmp = `${dest}.part`;
  try {
    mkdirSync(dirname(dest), { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, dest);
    const mb = (statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`[vendor-webgpu] ${key} (${mb} MB)`);
    vendored++;
  } catch (err) {
    rmSync(tmp, { force: true });
    console.warn(`[vendor-webgpu] WARN could not fetch ${key}: ${err.message} (app will fall back to runtime download)`);
    failed++;
  }
}

console.log(
  `[vendor-webgpu] done: ${vendored} downloaded, ${present} already present${failed ? `, ${failed} FAILED (runtime fetch will cover them)` : ''}`
);
