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

let _peer = null;
let _worker = null;

function getPeer() {
  if (_peer) return _peer;
  // Vite bundles aacWorker.js into a module-worker chunk (emitted by both the
  // player and web-admin builds since the panel is shared).
  _worker = new Worker(new URL('../components/aacWorker.js', import.meta.url), {
    type: 'module',
  });
  // Generous timeout: first call also fetches + instantiates the 32MB core.
  _peer = rawr({ transport: domTransport(_worker), timeout: 120000 });
  return _peer;
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

  const peer = getPeer();
  // rawr serializes args via structured clone; pass the bytes through and get the
  // encoded .m4a back. (The transferable fast-path is a future optimization.)
  const result = await peer.methods.encode(bytes, bitrate);
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

/** Tear down the worker (optional; e.g. on unmount). */
export function disposeAacEncoder() {
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _peer = null;
  }
}

/** ffmpeg's native aac encoder priming delay (samples). Passed to stem-mp4. */
export const FFMPEG_AAC_ENCODER_DELAY = 1024;
