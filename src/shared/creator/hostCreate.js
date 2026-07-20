/**
 * hostCreate — run a FULL karaoke creation in the player renderer on behalf of a
 * remote caller (a phone web-admin that has no WebGPU secure context). main hands in
 * the uploaded audio bytes + options; this decodes → createKaraoke() (separation +
 * transcription + pitch on the host GPU) → encodes the 5 stems to AAC-in-MP4, and
 * returns everything main needs to mux + save the .stem.mp4.
 *
 * It is the headless twin of WebGpuCreatorPanel.run(): same compute (createKaraoke),
 * same encode (encodeWavToAac), but driven by IPC instead of React. Progress is
 * reported via `onProgress({ phase, progress, log })` so main can relay it to the
 * phone over the creator:job broadcast.
 *
 * Browser/renderer only.
 */

import { detectWebGpu } from './creatorLibs.js';
import { createKaraokeInWorker } from './createKaraokeClient.js';
import { encodeWav } from './creatorAudio.js';
import { encodeWavToAac } from './aacEncoder.js';

// Decode raw file bytes (any browser-decodable container) → stereo Float32 channels.
// OfflineAudioContext pinned to 44.1k: htdemucs is trained at 44.1k, and a
// device-rate (48k) AudioContext fed the model slow audio (worse stems). Also
// avoids leaking a live AudioContext per decode.
async function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const buf = await ctx.decodeAudioData(
    u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  );
  const left = buf.getChannelData(0);
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0);
  return {
    left: Float32Array.from(left),
    right: Float32Array.from(right),
    sampleRate: buf.sampleRate,
    duration: buf.duration,
  };
}

/**
 * @param {Object} req
 * @param {Uint8Array|ArrayBuffer} req.audioBytes  the uploaded source audio
 * @param {Object} [req.opts]  creator options (asrModel/demucsModel/language/etc.)
 * @param {(p:{phase?:string, progress?:number, log?:string, stemProgress?:object})=>void} [onProgress]
 * @returns {Promise<{ stems:{[k]:Uint8Array}, lyrics, key, pitch, duration, timing }>}
 *   stems are AAC-in-MP4 bytes for master/drums/bass/other/vocals.
 */
export async function hostCreate({ audioBytes, opts = {} }, onProgress = () => {}) {
  const emitLog = (log) => onProgress({ log });
  const gpu = await detectWebGpu();
  const device = gpu ? 'webgpu' : 'wasm';
  emitLog(`host create starting — EP: ${device}`);

  emitLog('decoding uploaded audio …');
  const audio = await decodeBytes(audioBytes);

  // Rough phase→percent map so the phone sees a moving bar across the long job.
  // (createKaraoke reports per-stem separation fractions + a transcription heartbeat;
  // we coarsely map phases to an overall %.)
  const PHASE_PCT = { separating: 5, transcribing: 55, pitch: 90 };

  // Compute runs in the creator WORKER (separation + Whisper + CREPE off the
  // UI thread); the runtime libs load inside it, their logs stream via onLog.
  const created = await createKaraokeInWorker(
    { audio },
    { ...opts, device, ftAvailable: opts.ftAvailable ?? false },
    {
      onPhase: (phase) => onProgress({ phase, progress: PHASE_PCT[phase] ?? undefined }),
      onLog: emitLog,
      onStemProgress: (stemProgress) => onProgress({ stemProgress }),
      onTranscribeInfo: (info) => info && onProgress({ log: info }),
      onLyricsPreview: () => {},
      onRtf: () => {},
    }
  );

  // Encode the 5 stems to AAC-in-MP4 (ffmpeg-wasm), exactly like the panel's save path.
  emitLog('encoding stems to AAC (ffmpeg-wasm) …');
  onProgress({ phase: 'encoding', progress: 92 });
  const result = created.stems;
  const sr = audio.sampleRate;
  const wavBlobs = {
    master: encodeWav(audio.left, audio.right, sr),
    drums: encodeWav(result.drums.left, result.drums.right, sr),
    bass: encodeWav(result.bass.left, result.bass.right, sr),
    other: encodeWav(result.other.left, result.other.right, sr),
    vocals: encodeWav(result.vocals.left, result.vocals.right, sr),
  };
  // CONCURRENT on the encoder worker pool (see aacEncoder.js) instead of one
  // core pinned 5x as long.
  const stemKeys = Object.keys(wavBlobs);
  const encoded = await Promise.all(stemKeys.map((k) => encodeWavToAac(wavBlobs[k])));
  const stemsAac = {};
  stemKeys.forEach((k, i) => {
    stemsAac[k] = encoded[i];
  });

  emitLog('host create compute complete — handing stems back to main');
  return {
    stems: stemsAac, // master/drums/bass/other/vocals as AAC-in-MP4 Uint8Array
    lyrics: created.lyrics,
    chords: created.chords,
    key: created.key,
    pitch: created.pitch,
    duration: audio.duration,
    timing: created.timing,
  };
}
