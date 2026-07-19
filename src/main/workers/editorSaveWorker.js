/**
 * Worker-thread entry for the editor save. The save pipeline (read the whole
 * .stem.mp4, rebuild the kara atom, re-parse metadata, rebuild metadata atoms,
 * write) is CPU work proportional to file size. In Electron the MAIN process
 * routes input events to every window, so running that pipeline on the main
 * thread freezes the keyboard app-wide for the duration (seconds on big files
 * or slow machines). Here it runs off-main; the event loop stays free.
 */
import { parentPort, workerData } from 'node:worker_threads';

const { filePath, updates } = workerData;
try {
  const editorService = await import('../../shared/services/editorService.js');
  const result = await editorService.saveSong(filePath, updates);
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e?.message || String(e) });
}
