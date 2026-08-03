#!/usr/bin/env node
/**
 * Pack static/webgpu into a release tarball for the Flathub manifest.
 *
 * Flathub builds have no network, so `npm run vendor:webgpu` (which downloads
 * onnxruntime-web, transformers.js and the ffmpeg-core wasm from jsDelivr)
 * cannot run there. Instead those same files are published as a pinned archive
 * and consumed as an `archive` source with a sha256.
 *
 * Run AFTER `npm run vendor:webgpu`, attach the output to the release, and put
 * the printed sha256 into flatpak/com.loukai.app.yml.
 *
 * Usage: node scripts/pack-webgpu-assets.js
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'static', 'webgpu');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const out = join(root, `webgpu-assets-${version}.tar.gz`);

if (!existsSync(assetsDir)) {
  console.error(`✖ ${assetsDir} does not exist. Run: npm run vendor:webgpu`);
  process.exit(1);
}

const entries = readdirSync(assetsDir);
if (entries.length === 0) {
  console.error('✖ static/webgpu is empty. Run: npm run vendor:webgpu');
  process.exit(1);
}

// Deterministic tar: sorted names, no owner/timestamp noise, so the same inputs
// always produce the same sha256 and the manifest hash stays reproducible.
execFileSync(
  'tar',
  [
    '--sort=name',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--mtime=UTC 2020-01-01',
    '-czf',
    out,
    '-C',
    assetsDir,
    '.',
  ],
  { stdio: 'inherit' }
);

const bytes = readFileSync(out);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const mb = (bytes.length / 1024 / 1024).toFixed(1);

const total = entries.reduce((n, e) => {
  const p = join(assetsDir, e);
  return n + (statSync(p).isFile() ? statSync(p).size : 0);
}, 0);

console.log(`\n✅ ${out}`);
console.log(`   ${entries.length} files, ${(total / 1024 / 1024).toFixed(1)} MB raw → ${mb} MB packed`);
console.log(`\n   sha256: ${sha256}\n`);
console.log('Put that into flatpak/com.loukai.app.yml under the webgpu-assets archive source.');
