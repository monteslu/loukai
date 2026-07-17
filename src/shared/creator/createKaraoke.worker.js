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

// Live run control (rawr peers are symmetric, so the CLIENT can notify US):
//  - gentle(true/false): flip the active separator's duty mid-run (playback started or
//    stopped on the host). The runner reads the flag per segment and per chain piece,
//    so a flip takes effect within one segment.
//  - cancel(): abort the current run between segments without nuking the warmed worker.
const control = { processor: null, gentle: null, cancelled: false };

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
      control.cancelled = false;
      control.processor = null;
      try {
        return await createKaraoke(
          { audio: input.audio, stems: input.stems || null, lyricsOnly: Boolean(input.lyricsOnly) },
          // A gentle toggle that arrived before this run starts still applies.
          { ...opts, ...(control.gentle !== null ? { gentle: control.gentle } : {}) },
          libs,
          {
            onPhase: (p) => peer.notifiers.phase?.(p),
            onLog: (m) => peer.notifiers.log?.(m),
            onStemProgress: (p) => peer.notifiers.stemprogress?.(p),
            onTranscribeInfo: (info) => peer.notifiers.transcribeinfo?.(info),
            onLyricsPreview: (lines) => peer.notifiers.lyricspreview?.(lines),
            onRtf: (x) => peer.notifiers.rtf?.(x),
            onSeparator: (proc) => {
              control.processor = proc;
              if (control.gentle !== null) proc.gentle = control.gentle;
            },
            shouldCancel: () => control.cancelled,
          }
        );
      } finally {
        control.processor = null;
      }
    },
  },
});

peer.notifications.ongentle?.((v) => {
  control.gentle = Boolean(v);
  if (control.processor) {
    control.processor.gentle = control.gentle;
    peer.notifiers.log?.(`separation duty → ${control.gentle ? 'gentle (host playing)' : 'fast'}`);
  }
});
peer.notifications.oncancel?.(() => {
  control.cancelled = true;
});
