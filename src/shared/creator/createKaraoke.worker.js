/**
 * createKaraoke worker - runs the WHOLE creator compute (Demucs separation +
 * Whisper transcription + CREPE pitch) OFF the renderer main thread, so the
 * player UI/audio never jank while a karaoke file is being created.
 *
 * WebGPU, same-origin dynamic imports (ort/transformers/ft-ensemble/crepe via
 * /webgpu-assets), fetch of /webgpu-models, and cross-origin isolation are all
 * available in a dedicated worker; nothing in the compute path touches the DOM.
 * Electron does not enable node integration in workers, so the transformers.js
 * Node-globals hiding in creatorLibs is simply a no-op here.
 *
 * The worker stays ALIVE across runs: creatorLibs caches at module scope, so a
 * second creation (or a re-transcribe) reuses the loaded ort/transformers and
 * any warmed model sessions instead of re-downloading and re-initializing.
 *
 * RPC via rawr: the client calls peer.methods.create(input, opts) and receives
 * progress through notifications (phase/log/stemprogress/transcribeinfo/
 * lyricspreview/rtf). Stems cross back as structured-cloned Float32Arrays
 * (~40MB/min of audio, a one-time ~100ms copy per run).
 */

import rawr from 'rawr';
import { worker as workerTransport } from 'rawr/transports/worker';
import { loadCreatorLibs } from './creatorLibs.js';
import { createKaraoke } from './createKaraoke.js';

const peer = rawr({
  transport: workerTransport(),
  methods: {
    /**
     * @param {Object} input { audio:{left,right,sampleRate,duration},
     *   stems?: reuse stems ({vocals:{left,right}, …}), lyricsOnly?: boolean }
     * @param {Object} opts createKaraoke options (asrModel/demucsModel/device/…)
     * @returns {Promise<Object>} createKaraoke's result (stems/lyrics/key/pitch/timing)
     */
    async create(input, opts) {
      const libs = await loadCreatorLibs((m) => peer.notifiers.log?.(m));
      return createKaraoke(
        { audio: input.audio, stems: input.stems || null, lyricsOnly: Boolean(input.lyricsOnly) },
        opts,
        libs,
        {
          onPhase: (p) => peer.notifiers.phase?.(p),
          onLog: (m) => peer.notifiers.log?.(m),
          onStemProgress: (p) => peer.notifiers.stemprogress?.(p),
          onTranscribeInfo: (info) => peer.notifiers.transcribeinfo?.(info),
          onLyricsPreview: (lines) => peer.notifiers.lyricspreview?.(lines),
          onRtf: (x) => peer.notifiers.rtf?.(x),
        }
      );
    },
  },
});
