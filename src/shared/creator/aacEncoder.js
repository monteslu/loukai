/**
 * WAV -> AAC-in-MP4 encoder for the WebGPU creator, using ffmpeg-wasm in the
 * browser/renderer.
 *
 * stem-mp4 0.5.x is a pure-JS container muxer: it takes PRE-ENCODED AAC-in-MP4
 * tracks (stemsAac/mixdownAac), not WAV. So loukai encodes the separated stems
 * here, in the renderer, where they are already PCM. This replaces the native
 * ffmpeg the old creator relied on.
 *
 * We drive @ffmpeg/core's SINGLE-THREAD module factory DIRECTLY (no
 * @ffmpeg/ffmpeg Worker wrapper). Single-thread => no SharedArrayBuffer, so it
 * needs no COOP/COEP cross-origin isolation (the web admin is cross-origin). All
 * assets load same-origin from /webgpu-assets/* (vendored by webgpuAssets.js),
 * never a CDN, matching the rest of the WebGPU creator.
 */

import { assetBase } from './creatorAudio.js';

let _corePromise = null;

/**
 * Load + cache the ffmpeg-core module. Returns the Emscripten module instance,
 * which exposes `.exec(...args)` and `.FS.{writeFile,readFile,unlink}`.
 */
function getCore() {
  if (_corePromise) return _corePromise;
  _corePromise = (async () => {
    const base = assetBase();
    const coreUrl = `${base}/ffmpeg-core.js`;
    const wasmUrl = `${base}/ffmpeg-core.wasm`;
    // ESM factory (default export). Same-origin dynamic import.
    const mod = await import(/* @vite-ignore */ coreUrl);
    const createFFmpegCore = mod.default || mod;
    // locateFile points the core at the vendored wasm (same dir, explicit anyway).
    const core = await createFFmpegCore({
      locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : `${base}/${path}`),
    });
    return core;
  })();
  return _corePromise;
}

/**
 * Encode a single WAV blob/bytes to a single-track AAC-in-MP4 (.m4a) Uint8Array.
 *
 * @param {Blob|Uint8Array|ArrayBuffer} wav - WAV (PCM) input
 * @param {Object} [opts]
 * @param {number} [opts.bitrate=192000] - AAC bitrate (bits/sec)
 * @param {string} [opts.tag] - short label for the temp filenames (debug only)
 * @returns {Promise<Uint8Array>} the .m4a bytes (AAC-LC in an MP4 container)
 */
export async function encodeWavToAac(wav, { bitrate = 192000, tag = 's' } = {}) {
  const core = await getCore();
  let bytes;
  if (wav instanceof Uint8Array) bytes = wav;
  else if (wav instanceof ArrayBuffer) bytes = new Uint8Array(wav);
  else bytes = new Uint8Array(await wav.arrayBuffer()); // Blob

  // Unique-ish names so concurrent encodes on the shared FS never collide.
  const inName = `in_${tag}.wav`;
  const outName = `out_${tag}.m4a`;
  core.FS.writeFile(inName, bytes);
  try {
    // -c:a aac -> MP4 container (NOT raw ADTS) so stem-mp4's muxer accepts it.
    // -b:a sets the target bitrate. All 5 stems MUST use identical params so the
    // shared-mdat sample tables line up in the multi-track output. (The core
    // prepends its own ./ffmpeg -nostdin -y, so we don't pass those.)
    const rc = core.exec(
      '-i',
      inName,
      '-c:a',
      'aac',
      '-b:a',
      String(bitrate),
      '-movflags',
      '+faststart',
      outName
    );
    if (rc !== 0 && rc !== undefined) {
      throw new Error(`ffmpeg-core exited ${rc} encoding ${tag}`);
    }
    const out = core.FS.readFile(outName);
    return out instanceof Uint8Array ? out.slice() : new Uint8Array(out);
  } finally {
    try {
      core.FS.unlink(inName);
    } catch {
      /* ignore */
    }
    try {
      core.FS.unlink(outName);
    } catch {
      /* ignore */
    }
  }
}

/** ffmpeg's native aac encoder priming delay (samples). Passed to stem-mp4. */
export const FFMPEG_AAC_ENCODER_DELAY = 1024;
