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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { getCacheDir } from './systemChecker.js';

// loukai's own models (the htdemucs_ft WebGPU-runnable ensemble) live in a public
// HuggingFace repo and are fetched + LAN-cached exactly like the public models
// (silero, the fast htdemucs). Map the short path the renderer requests → the file
// in the HF repo. (crepe is tiny → bundled in static/webgpu, served below; silero
// VAD is fetched from its own onnx-community repo via the generic HF proxy.)
const LOUKAI_FT_REPO = 'monteslu/htdemucs-ft-webgpu';
const FT_MODELS = {
  'ft_cpu_nodes.json': `${LOUKAI_FT_REPO}/resolve/main/ft_cpu_nodes.json`,
  'htdemucs_ft_drums_safe16.onnx': `${LOUKAI_FT_REPO}/resolve/main/htdemucs_ft_drums_safe16.onnx`,
  'htdemucs_ft_bass_safe16.onnx': `${LOUKAI_FT_REPO}/resolve/main/htdemucs_ft_bass_safe16.onnx`,
  'htdemucs_ft_other_safe16.onnx': `${LOUKAI_FT_REPO}/resolve/main/htdemucs_ft_other_safe16.onnx`,
  'htdemucs_ft_vocals_safe16.onnx': `${LOUKAI_FT_REPO}/resolve/main/htdemucs_ft_vocals_safe16.onnx`,
};

// loukai's bundled static/webgpu dir (ships ft-ensemble.js + ft_cpu_nodes.json +
// crepe_tiny.onnx, and — once vendored — the libs). Served same-origin.
const STATIC_WEBGPU = join(dirname(fileURLToPath(import.meta.url)), '../../../static/webgpu');

// Allowlisted upstream sources, keyed by the path we serve them at.
// Keep versions in lockstep with WebGpuCreatorPanel.jsx.
const ORT_VER = '1.27.0';
const DEMUCS_VER = '1.0.2';
const TF_VER = '3.8.1';
// ffmpeg-wasm SINGLE-THREAD core (no SharedArrayBuffer / COOP-COEP needed, so it
// works in the cross-origin web admin). Used to encode the separated stems
// WAV -> AAC-in-MP4 before stem-mp4 muxes them. Drive the core module directly
// (no @ffmpeg/ffmpeg Worker wrapper) to match loukai's same-origin import model.
const FFMPEG_CORE_VER = '0.12.10';

const ASSETS = {
  // onnxruntime-web — self-contained WebGPU ESM bundle. NOTE the bundle/standalone
  // build fetches the ASYNCIFY wasm; transformers.js's OWN bundled ORT fetches the
  // JSEP wasm. We serve BOTH pairs so whichever loads, its wasm is present.
  'ort.webgpu.bundle.min.mjs': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.webgpu.bundle.min.mjs`,
  // transformers.js's OWN bundled ORT dynamically imports ort.bundle.min.mjs
  // (the generic build, not the webgpu one) relative to transformers.min.js's
  // location — which is this same dir. Without it, transformers' InferenceSession
  // is undefined → '.create()' crashes. Serve it here.
  'ort.bundle.min.mjs': `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.bundle.min.mjs`,
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
  // ffmpeg-wasm single-thread core (factory ESM + its wasm). The .wasm is ~32 MB;
  // fetched once + LAN-cached like the ONNX models.
  'ffmpeg-core.js': `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VER}/dist/esm/ffmpeg-core.js`,
  'ffmpeg-core.wasm': `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VER}/dist/esm/ffmpeg-core.wasm`,
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
      // HuggingFace uses 307 (and CDNs use 308) — follow all redirect codes.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
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
  app.get('/webgpu-assets/*splat', async (req, res) => {
    // Special non-file key: report whether the htdemucs_ft "best quality" ensemble
    // is available. The models are HF-hosted (FT_MODELS → monteslu/htdemucs-ft-webgpu)
    // and fetched on demand + LAN-cached like the fast model — so "best" is available
    // whenever they're already cached OR an upstream URL is configured. (If the HF
    // repo isn't reachable, the run falls back to fast — handled in the renderer.)
    // Handled inside this (known-working) splat route to avoid route-precedence issues.
    if (req.path === '/webgpu-assets/ft-available') {
      const md = modelsDir();
      const available = ['drums', 'bass', 'other', 'vocals'].every((s) => {
        const name = `htdemucs_ft_${s}_safe16.onnx`;
        if (FT_MODELS[name]) return true; // has a configured HF upstream
        const f = join(md, name);
        return existsSync(f) && statSync(f).size > 0;
      });
      return res.json({ available });
    }
    // Express 5 (path-to-regexp v8) requires a named splat, not a bare '*'.
    // Strip the prefix; reject traversal.
    const key = decodeURIComponent(req.path.replace(/^\/webgpu-assets\//, ''));
    if (key.includes('..')) return res.status(400).json({ error: 'bad path' });
    // Locally-bundled assets in static/webgpu (ft-ensemble.js, ft_cpu_nodes.json,
    // and any vendored libs) take precedence; otherwise fall to the CDN cache map.
    const localFile = join(STATIC_WEBGPU, key);
    if (existsSync(localFile) && statSync(localFile).isFile()) {
      res.setHeader('Content-Type', mimeFor(key));
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Length', statSync(localFile).size);
      return createReadStream(localFile).pipe(res);
    }
    if (!Object.prototype.hasOwnProperty.call(ASSETS, key)) {
      return res.status(404).json({ error: 'unknown asset' });
    }
    try {
      const file = await ensureAsset(key);
      res.setHeader('Content-Type', mimeFor(key));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // Same-origin already, but mark cross-origin-readable for the isolated context.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // allow file:// renderer under COEP
      res.setHeader('Content-Length', statSync(file).size); // let consumers pre-size buffers
      createReadStream(file).pipe(res);
    } catch (e) {
      console.error('webgpu-asset fetch failed:', key, e.message);
      res.status(502).json({ error: `failed to fetch asset: ${e.message}` });
    }
  });

  // Model proxy+cache. /webgpu-models/htdemucs.onnx → the demucs ONNX; any other
  // /webgpu-models/<path> → huggingface.co/<path> (transformers.js model trees).
  // Cached to disk on first request; served same-origin thereafter.
  app.get('/webgpu-models/*splat', async (req, res) => {
    const rel = decodeURIComponent(req.path.replace(/^\/webgpu-models\//, ''));
    if (!rel || rel.includes('..')) return res.status(400).json({ error: 'bad path' });

    // crepe (tiny) is bundled in static/webgpu → serve directly, offline, no fetch.
    const bundled = join(STATIC_WEBGPU, rel);
    const staticPath = existsSync(bundled) && statSync(bundled).size > 0 ? bundled : null;
    const dest = staticPath || join(modelsDir(), rel);
    try {
      // Otherwise fetch + LAN-cache from HuggingFace: our htdemucs_ft ensemble
      // (FT_MODELS → monteslu/htdemucs-ft-webgpu), the fast htdemucs alias, and the
      // public model trees (silero VAD, Whisper) that transformers.js requests.
      if (!staticPath && !(existsSync(dest) && statSync(dest).size > 0)) {
        let upstream;
        if (rel === 'htdemucs.onnx') upstream = HTDEMUCS_URL;
        else if (FT_MODELS[rel]) upstream = `${HF_BASE}/${FT_MODELS[rel]}`;
        else upstream = `${HF_BASE}/${rel}`;
        if (!upstream.startsWith('https://huggingface.co/')) {
          return res.status(404).json({ error: 'model not found locally and no upstream' });
        }
        await download(upstream, dest);
      }
      res.setHeader('Content-Type', mimeFor(rel));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // allow file:// renderer under COEP
      // Content-Length is REQUIRED so transformers.js pre-sizes its download buffer.
      // Without it, it repeatedly grows the buffer and OOMs on large models
      // (v3-turbo's 688MB → 'RangeError: Array buffer allocation failed').
      res.setHeader('Content-Length', statSync(dest).size);
      createReadStream(dest).pipe(res);
    } catch (e) {
      console.error('webgpu-model fetch failed:', rel, e.message);
      res.status(502).json({ error: `failed to fetch model: ${e.message}` });
    }
  });
}

export default { registerWebGpuAssets };
