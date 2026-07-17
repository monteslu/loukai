/**
 * WAV -> AAC-in-MP4 encoder for the WebGPU creator.
 *
 * stem-mp4 0.5.x is a pure-JS container muxer: it takes PRE-ENCODED AAC-in-MP4
 * tracks (stemsAac/mixdownAac), not WAV. So loukai encodes the separated stems
 * here, in the renderer, where they are already PCM. This replaces the native
 * ffmpeg the old creator relied on.
 *
 * ffmpeg-core's exec() is a BLOCKING wasm call, so it runs in a Web Worker
 * (aacWorker.js) to keep the creator UI responsive. The worker is driven over
 * rawr (JSON-RPC): we just await peer.methods.encode(wav, bitrate). Single-thread
 * core => no SharedArrayBuffer / COOP-COEP. The worker is a same-origin module
 * worker (Vite-bundled), CSP-safe under script-src 'self'.
 */

import rawr from 'rawr';
import { dom as domTransport } from 'rawr/transports/worker';

// A small POOL of ffmpeg workers so the 5 encodes per save (master + 4 stems)
// run concurrently instead of pinning one core 5x as long. Each worker costs one
// core while encoding plus its own ffmpeg heap, so the default stays modest and
// scales with the machine. Workers spawn lazily, up to the cap.
const _slots = [];
let _poolCap = defaultPoolSize();

function defaultPoolSize() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.min(5, Math.max(2, Math.floor(cores / 4)));
}

/** Override the encode-worker pool size (1..8). Call before the first encode. */
export function configureAacEncoder({ poolSize } = {}) {
  if (poolSize !== undefined) _poolCap = Math.min(8, Math.max(1, Math.floor(poolSize)));
}

/** Current encode concurrency cap (callers can size Promise batches to this). */
export function aacPoolSize() {
  return _poolCap;
}

function getSlot() {
  // An idle worker first; else grow the pool; else the least-busy one (ffmpeg's
  // exec() blocks its worker thread, so queued requests serialize there anyway).
  const idle = _slots.find((s) => s.busy === 0);
  if (idle) return idle;
  if (_slots.length < _poolCap) {
    // Vite bundles aacWorker.js into a module-worker chunk (emitted by both the
    // player and web-admin builds since the panel is shared).
    const worker = new Worker(new URL('../components/aacWorker.js', import.meta.url), {
      type: 'module',
    });
    // Generous timeout: first call also fetches + instantiates the 32MB core.
    const peer = rawr({ transport: domTransport(worker), timeout: 120000 });
    const slot = { worker, peer, busy: 0 };
    _slots.push(slot);
    return slot;
  }
  return _slots.reduce((a, b) => (b.busy < a.busy ? b : a));
}

async function withSlot(fn) {
  const slot = getSlot();
  slot.busy++;
  try {
    return await fn(slot.peer);
  } finally {
    slot.busy--;
  }
}

/**
 * Encode a WAV blob/bytes to a single-track AAC-in-MP4 (.m4a) Uint8Array.
 *
 * @param {Blob|Uint8Array|ArrayBuffer} wav - WAV (PCM) input
 * @param {Object} [opts]
 * @param {number} [opts.bitrate=192000] - AAC bitrate (bits/sec)
 * @returns {Promise<Uint8Array>} the .m4a bytes (AAC-LC in an MP4 container)
 */
export async function encodeWavToAac(wav, { bitrate = 192000 } = {}) {
  let bytes;
  if (wav instanceof Uint8Array) bytes = wav;
  else if (wav instanceof ArrayBuffer) bytes = new Uint8Array(wav);
  else bytes = new Uint8Array(await wav.arrayBuffer()); // Blob

  // rawr serializes args via structured clone; pass the bytes through and get the
  // encoded .m4a back. (The transferable fast-path is a future optimization.)
  const result = await withSlot((peer) => peer.methods.encode(bytes, bitrate));
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

/** Tear down all encode workers (optional; e.g. on unmount). */
export function disposeAacEncoder() {
  for (const s of _slots) s.worker.terminate();
  _slots.length = 0;
}

/** ffmpeg's native aac encoder priming delay (samples). Passed to stem-mp4. */
export const FFMPEG_AAC_ENCODER_DELAY = 1024;
