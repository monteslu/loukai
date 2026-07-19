import { Worker } from 'node:worker_threads';

/**
 * Run editorService.saveSong in a worker thread so the main process event loop
 * (which routes input to every window) never blocks on the file rebuild.
 *
 * Save FAILURES inside the worker propagate as rejections. Only a worker that
 * dies before reporting anything (boot failure, e.g. an exotic packaging
 * setup) falls back to the in-process save - slower UI, but the save works.
 */
export function saveSongOffMain(filePath, updates) {
  return new Promise((resolve, reject) => {
    let reported = false;
    const fallback = async () => {
      try {
        const editorService = await import('../../shared/services/editorService.js');
        resolve(await editorService.saveSong(filePath, updates));
      } catch (e) {
        reject(e);
      }
    };
    let worker;
    try {
      worker = new Worker(new URL('./editorSaveWorker.js', import.meta.url), {
        workerData: { filePath, updates },
      });
    } catch {
      fallback();
      return;
    }
    worker.once('message', (m) => {
      reported = true;
      if (m.ok) resolve(m.result);
      else reject(new Error(m.error));
    });
    worker.once('error', () => {
      if (!reported) {
        reported = true;
        fallback();
      }
    });
    worker.once('exit', (code) => {
      if (!reported && code !== 0) {
        reported = true;
        fallback();
      }
    });
  });
}
