/**
 * Chord backfill worker (issue #93): analyzes already-decoded stem PCM for a
 * library song that predates the chord track. Runs off the UI thread; the
 * player posts transferable Float32Arrays, we post back the segment list.
 */
import { detectChords } from '../../shared/creator/chordDetect.js';

self.onmessage = (e) => {
  const { other, bass, sampleRate } = e.data;
  try {
    const chords = detectChords(other, bass, sampleRate);
    self.postMessage({ ok: true, chords });
  } catch (err) {
    self.postMessage({ ok: false, error: err?.message || String(err) });
  }
};
