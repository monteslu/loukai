/**
 * Main-thread client for the createKaraoke worker. Same signature as
 * createKaraoke minus the libs param (the worker loads its own): the panel and
 * the headless host-create path call this instead of running separation +
 * Whisper + CREPE on the UI thread.
 *
 * The worker (and everything it has warmed: ort, transformers, model sessions)
 * persists across calls; a re-transcribe or a second song skips the load.
 */

import rawr from 'rawr';
import { dom as domTransport } from 'rawr/transports/worker';

let _worker = null;
let _peer = null;
// Rebound per run; the rawr subscriptions are registered once and dispatch here.
let _emit = {};

function getPeer() {
  if (_peer) return _peer;
  _worker = new Worker(new URL('./createKaraoke.worker.js', import.meta.url), {
    type: 'module',
  });
  // timeout 0: separation + transcription of a long song takes minutes.
  _peer = rawr({ transport: domTransport(_worker), timeout: 0 });
  _peer.notifications.onphase((p) => _emit.onPhase?.(p));
  _peer.notifications.onlog((m) => _emit.onLog?.(m));
  _peer.notifications.onstemprogress((p) => _emit.onStemProgress?.(p));
  _peer.notifications.ontranscribeinfo((info) => _emit.onTranscribeInfo?.(info));
  _peer.notifications.onlyricspreview((lines) => _emit.onLyricsPreview?.(lines));
  _peer.notifications.onrtf((x) => _emit.onRtf?.(x));
  return _peer;
}

/**
 * Run the creator compute in the worker.
 * @param {Object} input { audio, stems?, lyricsOnly? } (createKaraoke shape)
 * @param {Object} opts  createKaraoke options
 * @param {Object} emit  createKaraoke emit callbacks (all optional)
 * @returns {Promise<Object>} createKaraoke's result
 */
export async function createKaraokeInWorker(input, opts, emit = {}) {
  const peer = getPeer();
  _emit = emit;
  try {
    return await peer.methods.create(input, opts);
  } finally {
    _emit = {};
  }
}

/** Tear down the worker (drops warmed models; next run reloads them). */
export function disposeCreatorWorker() {
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _peer = null;
  }
}
