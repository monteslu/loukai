/**
 * AAC encode worker — runs ffmpeg-core's blocking exec() OFF the renderer main
 * thread so encoding stems never freezes the creator UI.
 *
 * Vite bundles this (rawr + glue) into a module-worker chunk; ffmpeg-core itself
 * stays OUT of the bundle, loaded at runtime from the same-origin /webgpu-assets/
 * path (vendored + LAN-cached by webgpuAssets.js). Single-thread core => no
 * SharedArrayBuffer, so no COOP/COEP cross-origin isolation needed.
 *
 * RPC via rawr (JSON-RPC over the worker postMessage transport): the page calls
 * peer.methods.encode(wav, bitrate) and gets back the AAC bytes.
 */

import rawr from 'rawr';
import { worker as workerTransport } from 'rawr/transports/worker';

let corePromise = null;

function getCore() {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    // Same-origin runtime import; kept out of the Vite bundle so the 32MB wasm is
    // fetched + LAN-cached like the other WebGPU assets. Build the specifier as a
    // VARIABLE so Vite's static analyzer leaves it alone (a string literal would be
    // resolved at build time and fail).
    const coreUrl = ['', 'webgpu-assets', 'ffmpeg-core.js'].join('/');
    const mod = await import(/* @vite-ignore */ coreUrl);
    const createFFmpegCore = mod.default || mod;
    return createFFmpegCore({
      locateFile: (path) =>
        path.endsWith('.wasm') ? '/webgpu-assets/ffmpeg-core.wasm' : `/webgpu-assets/${path}`,
    });
  })();
  return corePromise;
}

/**
 * Encode a WAV blob's bytes to a single-track AAC-in-MP4 (.m4a).
 * @param {Uint8Array|ArrayBuffer|number[]} wav
 * @param {number} bitrate
 * @returns {Promise<Uint8Array>}
 */
async function encode(wav, bitrate = 192000) {
  const core = await getCore();
  const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav);
  const inName = `in_${Math.floor(performance.now())}_${bytes.length}.wav`;
  const outName = inName.replace(/\.wav$/, '.m4a');
  core.FS.writeFile(inName, bytes);
  try {
    // -c:a aac -> MP4 container (NOT raw ADTS) so stem-mp4's muxer accepts it. The
    // core prepends ./ffmpeg -nostdin -y, so we don't pass those.
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
    if (rc !== 0 && rc !== undefined) throw new Error(`ffmpeg-core exited ${rc}`);
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

rawr({ transport: workerTransport(), methods: { encode } });
