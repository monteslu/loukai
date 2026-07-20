/**
 * Merge a chord track into a song's kara atom off the main process (the
 * whole-file rebuild would otherwise block input routing, issue #87's lesson).
 */
import { parentPort, workerData } from 'node:worker_threads';

const { filePath, chords } = workerData;
try {
  const { Atoms } = await import('stem-mp4');
  const kara = await Atoms.readKaraAtom(filePath);
  await Atoms.writeKaraAtom(filePath, { ...kara, chords });
  parentPort.postMessage({ ok: true });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e?.message || String(e) });
}
