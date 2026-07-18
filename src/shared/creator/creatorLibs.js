/**
 * loadCreatorLibs — load the WebGPU creator runtime (onnxruntime-web, demucs-web,
 * transformers.js, the ft ensemble, CREPE) from loukai's same-origin /webgpu-assets/*.
 *
 * Extracted from WebGpuCreatorPanel so the SAME loader serves both the inline panel
 * and the headless host-create path (a phone commanding the player to create). The
 * loaded module bundle is cached at module scope so a second caller (e.g. headless
 * after the panel already loaded) reuses it — and the heavy 32MB+ wasm is fetched once.
 *
 * Browser/renderer only (uses dynamic import of same-origin ESM + WebAudio-adjacent
 * globals); never import from the Node main process.
 */

import { assetBase } from './creatorAudio.js';
// The demucs runner is VENDORED (WASM+SIMD FFT, optional full-WebGPU DSP path,
// aligned tail segment) instead of loading demucs-web from the asset cache. Same
// API (DemucsProcessor, CONSTANTS, prepareModelInput/standaloneMask/standaloneIspec
// for the ft ensemble) plus the fused freqTrackToTime fast path.
import * as demucs from './demucs/index.js';

let cached = null;

// transformers.js keys its environment detection off `typeof process`. In the Electron
// renderer (nodeIntegration: true) `process` exists, so it WRONGLY thinks it's Node →
// tries onnxruntime-node (not bundled) → InferenceSession is undefined. Hide the Node
// globals for the duration of the import so it detects a browser env.
async function importTransformers(url) {
  const saved = {
    process: globalThis.process,
    module: globalThis.module,
    require: globalThis.require,
    global: globalThis.global,
  };
  try {
    delete globalThis.process;
    delete globalThis.module;
    delete globalThis.require;
    delete globalThis.global;
  } catch {
    /* ignore */
  }
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    globalThis.process = saved.process;
    globalThis.module = saved.module;
    globalThis.require = saved.require;
    globalThis.global = saved.global;
  }
}

/**
 * @param {(msg:string)=>void} [onLog]
 * @returns {Promise<object>} { ort, base, demucs, DemucsProcessor, CONSTANTS,
 *   pipeline, tf, ftEnsemble, crepeMod, crepeSession? }
 */
export async function loadCreatorLibs(onLog = () => {}) {
  if (cached?.ort) return cached;
  const base = assetBase();
  onLog('loading libraries from loukai (same-origin, backend-cached) …');
  // All from /webgpu-assets/* — never a CDN. Self-contained ESM bundles, so dynamic
  // import works. transformers.js is imported with Node globals hidden. (demucs is
  // vendored + bundled now; only ort still fetches its own .wasm at runtime.)
  let ort, tf, ftEnsemble, crepeMod;
  try {
    [ort, tf, ftEnsemble, crepeMod] = await Promise.all([
      import(/* @vite-ignore */ `${base}/ort.webgpu.bundle.min.mjs`),
      importTransformers(`${base}/transformers.min.js`),
      import(/* @vite-ignore */ `${base}/ft-ensemble.js`),
      import(/* @vite-ignore */ `${base}/crepe-pitch.js`),
    ]);
  } catch (e) {
    throw new Error(
      `failed to load WebGPU libraries from loukai (${String(e.message).slice(0, 100)}). ` +
        `If the app was reloading, just try again.`
    );
  }
  try {
    if (ort.env?.wasm) {
      ort.env.wasm.wasmPaths = `${base}/`;
      // SIMD is built in; THREADS need cross-origin isolation (COOP+COEP). Else 1.
      // WebGPU machines: keep the pool TINY (2). The demucs graph runs 100% on the
      // WebGPU EP (verified via ORT node placements), so a bigger pool just spins
      // under the GPU session, stealing cores from audio decode + the AAC encode
      // pool — and under the chained model it competes for the compositor slots
      // the per-piece drains exist to create. WASM-only machines: Whisper and
      // separation run ON this pool, so cap at ~60% of cores instead (full
      // concurrency starves UI + audio).
      const isolated = self.crossOriginIsolated === true;
      const cores = navigator.hardwareConcurrency || 4;
      const hasWebGpu = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
      const threads = !isolated ? 1 : hasWebGpu ? 2 : Math.max(1, Math.floor(cores * 0.6));
      ort.env.wasm.numThreads = threads;
      onLog(
        `WASM: SIMD on, ${threads} thread${threads === 1 ? '' : 's'}` +
          (isolated ? '' : ' (not cross-origin-isolated → single-threaded)')
      );
    }
    if (ort.env?.webgpu) ort.env.webgpu.powerPreference = 'high-performance';
    try {
      ort.env.logLevel = 'info';
      if (ort.env.webgpu) ort.env.webgpu.profiling = { mode: 'off' };
    } catch {
      /* ignore */
    }
    if (tf.env) {
      tf.env.allowRemoteModels = true;
      tf.env.remoteHost = '/webgpu-models/';
      tf.env.remotePathTemplate = '{model}/resolve/{revision}/';
      if (tf.env.backends?.onnx?.wasm) tf.env.backends.onnx.wasm.wasmPaths = `${base}/`;
    }
  } catch {
    /* ignore */
  }
  cached = {
    ort,
    base,
    demucs,
    DemucsProcessor: demucs.DemucsProcessor,
    CONSTANTS: demucs.CONSTANTS,
    pipeline: tf.pipeline,
    tf,
    ftEnsemble,
    crepeMod,
  };
  return cached;
}

/** Probe WebGPU availability (REAL adapter present). Used to pick the EP. */
export async function detectWebGpu() {
  try {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    // Reject software adapters: on Wayland (no Vulkan) Chromium offers SwiftShader,
    // a CPU emulation. Running Demucs/Whisper on it is slower than the WASM path
    // while claiming to be 'webgpu' — treat it as no GPU so the WASM fallback wins.
    if (adapter.isFallbackAdapter) return false;
    const vendor = (adapter.info?.vendor || '').toLowerCase();
    const arch = (adapter.info?.architecture || '').toLowerCase();
    if (vendor.includes('swiftshader') || arch.includes('swiftshader')) return false;
    return true;
  } catch {
    return false;
  }
}
