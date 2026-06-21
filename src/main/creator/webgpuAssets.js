/**
 * WebGPU asset proxy + cache.
 *
 * The in-browser WebGPU Creator (Demucs + Whisper) needs its JS libraries,
 * their WASM artifacts, and the ML models. Loading those from CDNs at runtime
 * fails in two ways: esm.sh's re-export wrappers don't resolve under dynamic
 * import(), and — critically — the WEB ADMIN is a real cross-origin context
 * where CORS + COEP block third-party fetches.
 *
 * Fix: vendor everything through loukai's own server. On first request each
 * asset is downloaded once into the creator cache dir, then served SAME-ORIGIN
 * forever after (works offline, no CORS/COEP issues, no CDN dependency).
 *
 * Asset URLs use the SELF-CONTAINED dist builds (e.g. ort.webgpu.bundle.min.mjs),
 * not esm.sh wrappers, so there are no sub-imports to resolve.
 */

import {
  existsSync,
  mkdirSync,
  createWriteStream,
  createReadStream,
  statSync,
  renameSync,
} from 'fs';
import { join } from 'path';
import https from 'https';
import { getCacheDir } from './systemChecker.js';

// Allowlisted upstream sources, keyed by the path we serve them at.
// Keep versions in lockstep with WebGpuCreatorPanel.jsx.
const ORT_VER = '1.27.0';
const DEMUCS_VER = '1.0.2';
const TF_VER = '3.8.1';

const ASSETS = {
  // onnxruntime-web — self-contained WebGPU ESM bundle. NOTE the bundle/standalone
  // build fetches the ASYNCIFY wasm; transformers.js's OWN bundled ORT fetches the
  // JSEP wasm. We serve BOTH pairs so whichever loads, its wasm is present.
  'ort.webgpu.bundle.min.mjs': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.webgpu.bundle.min.mjs`,
  'ort-wasm-simd-threaded.asyncify.wasm': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
  'ort-wasm-simd-threaded.asyncify.mjs': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort-wasm-simd-threaded.asyncify.mjs`,
  'ort-wasm-simd-threaded.jsep.wasm': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort-wasm-simd-threaded.jsep.wasm`,
  'ort-wasm-simd-threaded.jsep.mjs': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort-wasm-simd-threaded.jsep.mjs`,
  // demucs-web — plain ESM source, zero deps, takes ort as a param.
  'demucs/index.js': `https://cdn.jsdelivr.net/npm/demucs-web@${DEMUCS_VER}/src/index.js`,
  'demucs/processor.js': `https://cdn.jsdelivr.net/npm/demucs-web@${DEMUCS_VER}/src/processor.js`,
  'demucs/fft.js': `https://cdn.jsdelivr.net/npm/demucs-web@${DEMUCS_VER}/src/fft.js`,
  'demucs/constants.js': `https://cdn.jsdelivr.net/npm/demucs-web@${DEMUCS_VER}/src/constants.js`,
  // transformers.js — bundled dist.
  'transformers.min.js': `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TF_VER}/dist/transformers.min.js`,
};

const MIME = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

function assetsDir() {
  return join(getCacheDir(), 'webgpu-assets');
}

function modelsDir() {
  return join(getCacheDir(), 'webgpu-models');
}

// The demucs htdemucs ONNX upstream (demucs-web's DEFAULT_MODEL_URL). Served as
// /webgpu-models/htdemucs.onnx. Other /webgpu-models/<path> map to HuggingFace
// (transformers.js requests <model-id>/resolve/main/<file>), so the backend is a
// generic caching reverse-proxy and the UI never hits huggingface.co directly.
const HTDEMUCS_URL =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const HF_BASE = 'https://huggingface.co';

function mimeFor(name) {
  const ext = name.slice(name.lastIndexOf('.'));
  return MIME[ext] || 'application/octet-stream';
}

// Download url → destPath (follows redirects). Resolves on success.
function download(url, destPath, redirects = 5) {
  return new Promise((resolve, reject) => {
    mkdirSync(join(destPath, '..'), { recursive: true });
    const req = https.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirects <= 0) return reject(new Error('too many redirects'));
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return download(next, destPath, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const tmp = `${destPath}.part`;
      const out = createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try {
            // atomic-ish rename
            mkdirSync(join(destPath, '..'), { recursive: true });
            renameSync(tmp, destPath);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

/** Ensure one asset is cached; returns its absolute path. */
async function ensureAsset(key) {
  const url = ASSETS[key];
  if (!url) return null;
  const dest = join(assetsDir(), key);
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  await download(url, dest);
  return dest;
}

/**
 * Register the /webgpu-assets route on an Express app.
 * Serves cached JS/WASM same-origin; downloads on first miss.
 */
export function registerWebGpuAssets(app) {
  app.get('/webgpu-assets/*', async (req, res) => {
    // Strip the prefix; reject traversal.
    const key = decodeURIComponent(req.path.replace(/^\/webgpu-assets\//, ''));
    if (key.includes('..') || !Object.prototype.hasOwnProperty.call(ASSETS, key)) {
      return res.status(404).json({ error: 'unknown asset' });
    }
    try {
      const file = await ensureAsset(key);
      res.setHeader('Content-Type', mimeFor(key));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // Same-origin already, but mark cross-origin-readable for the isolated context.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // allow file:// renderer under COEP
      createReadStream(file).pipe(res);
    } catch (e) {
      console.error('webgpu-asset fetch failed:', key, e.message);
      res.status(502).json({ error: `failed to fetch asset: ${e.message}` });
    }
  });

  // Model proxy+cache. /webgpu-models/htdemucs.onnx → the demucs ONNX; any other
  // /webgpu-models/<path> → huggingface.co/<path> (transformers.js model trees).
  // Cached to disk on first request; served same-origin thereafter.
  app.get('/webgpu-models/*', async (req, res) => {
    const rel = decodeURIComponent(req.path.replace(/^\/webgpu-models\//, ''));
    if (!rel || rel.includes('..')) return res.status(400).json({ error: 'bad path' });

    const upstream = rel === 'htdemucs.onnx' ? HTDEMUCS_URL : `${HF_BASE}/${rel}`;
    // Only allow our HF host (no open proxy).
    if (!upstream.startsWith('https://huggingface.co/')) {
      return res.status(403).json({ error: 'forbidden upstream' });
    }
    const dest = join(modelsDir(), rel);
    try {
      if (!(existsSync(dest) && statSync(dest).size > 0)) {
        await download(upstream, dest);
      }
      res.setHeader('Content-Type', mimeFor(rel));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // allow file:// renderer under COEP
      createReadStream(dest).pipe(res);
    } catch (e) {
      console.error('webgpu-model fetch failed:', rel, e.message);
      res.status(502).json({ error: `failed to fetch model: ${e.message}` });
    }
  });
}

export default { registerWebGpuAssets };
