/**
 * hostCreateRelay — the main↔renderer protocol for a long host-side creation job,
 * extracted from KaiApp.runHostCreate so the tricky parts (idle watchdog, settle-once,
 * window-gone reject, listener cleanup) are pure and unit-testable. Dependencies are
 * injected: the IPC emitter, the renderer webContents, and the timer fns. No Electron
 * import here — KaiApp wires in the real ipcMain / mainWindow.webContents.
 *
 * Protocol:
 *   - main → renderer: send `creator:hostCreate` { jobId, audioBytes, opts }.
 *   - renderer → main: stream `creator:hostCreate:progress` { jobId, progress }, then
 *     a final `creator:hostCreate:response:${jobId}` { success, ... } (or { error }).
 *   - If the renderer goes silent (no progress) for idleMs, OR the window dies, the
 *     job rejects so the caller can mark the creatorJob 'error' instead of hanging it
 *     'running' forever (which would 409 all future creations).
 */

const PROGRESS_CHANNEL = 'creator:hostCreate:progress';
const COMMAND_CHANNEL = 'creator:hostCreate';

/**
 * @param {Object} deps
 * @param {{on:Function, once:Function, removeListener:Function}} deps.ipc  ipcMain-like
 * @param {{send:Function, once:Function, removeListener:Function, isDestroyed?:Function}} deps.webContents
 * @param {number} [deps.idleMs=300000]  reject if no progress for this long
 * @param {Function} [deps.setTimer=setTimeout]
 * @param {Function} [deps.clearTimer=clearTimeout]
 * @param {Object} job  { jobId, audioBytes, opts }
 * @param {(progress:object)=>void} [onProgress]
 * @returns {Promise<object>}  the renderer's success result
 */
export function runHostCreateRelay(
  { ipc, webContents, idleMs = 5 * 60 * 1000, setTimer = setTimeout, clearTimer = clearTimeout },
  { jobId, audioBytes, opts = {} },
  onProgress = () => {}
) {
  return new Promise((resolve, reject) => {
    if (!webContents || webContents.isDestroyed?.()) {
      return reject(new Error('no player window available to run host creation'));
    }
    const responseChannel = `creator:hostCreate:response:${jobId}`;

    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimer(timer);
      ipc.removeListener(PROGRESS_CHANNEL, progressListener);
      ipc.removeListener(responseChannel, responseListener);
      webContents.removeListener('render-process-gone', onGone);
      webContents.removeListener('destroyed', onGone);
    };
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(arg);
    };
    const arm = () => {
      if (timer) clearTimer(timer);
      timer = setTimer(
        () => finish(reject, new Error('host creation timed out (renderer went silent)')),
        idleMs
      );
    };

    const progressListener = (_event, payload) => {
      if (payload?.jobId !== jobId) return;
      arm(); // alive → reset the watchdog
      try {
        onProgress(payload.progress || {});
      } catch {
        /* progress is best-effort */
      }
    };

    const responseListener = (_event, result) => {
      if (result?.success) finish(resolve, result);
      else finish(reject, new Error(result?.error || 'host creation failed in renderer'));
    };

    // The player window dying mid-job must reject (not hang) so finishJob('error') runs.
    const onGone = () => finish(reject, new Error('player window closed during host creation'));

    ipc.on(PROGRESS_CHANNEL, progressListener);
    ipc.once(responseChannel, responseListener);
    webContents.once('render-process-gone', onGone);
    webContents.once('destroyed', onGone);
    arm();

    // Forward the FULL payload (the bug sendToRendererAndWait has — dropping args — is
    // exactly what we must not repeat here).
    webContents.send(COMMAND_CHANNEL, { jobId, audioBytes, opts });
  });
}
