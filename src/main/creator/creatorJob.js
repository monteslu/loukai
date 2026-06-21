/**
 * creatorJob — single source of truth for the current creator conversion job.
 *
 * There is exactly ONE conversion at a time per Loukai process (the pipeline is
 * a hard singleton). This module holds a rich, observable descriptor of that job
 * so that EVERY admin surface — the Electron Creator tab AND every web-admin
 * browser — can answer "is something already running?" consistently, including a
 * UI that was opened or refreshed AFTER the job started.
 *
 * The descriptor is intentionally serializable (returned by getStatus over both
 * IPC and HTTP) and carries a short console tail for late-join context.
 */

const CONSOLE_TAIL_MAX = 60;

function emptyJob() {
  return {
    id: null,
    status: 'idle', // idle | running | complete | error | cancelled
    step: null,
    progress: 0,
    title: null,
    artist: null,
    source: null, // 'electron' | 'web'
    device: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    outputPath: null,
    consoleTail: [],
  };
}

let job = emptyJob();

/** @returns {object} a shallow copy of the current job descriptor (safe to serialize). */
export function getJob() {
  return { ...job, consoleTail: [...job.consoleTail] };
}

/** @returns {boolean} whether a conversion is currently running. */
export function isRunning() {
  return job.status === 'running';
}

/**
 * Begin a new job. Caller must have already confirmed nothing is running.
 * @param {{id?: string, title?: string, artist?: string, source?: string, device?: string, startedAt: number}} info
 */
export function startJob(info = {}) {
  job = emptyJob();
  job.id = info.id || `job-${info.startedAt || 0}`;
  job.status = 'running';
  job.title = info.title ?? null;
  job.artist = info.artist ?? null;
  job.source = info.source ?? null;
  job.device = info.device ?? null;
  job.startedAt = info.startedAt ?? null;
  return getJob();
}

/** Update progress/step from the pipeline's onProgress callback. */
export function updateProgress({ step, progress } = {}) {
  if (job.status !== 'running') return;
  if (typeof step === 'string') job.step = step;
  if (typeof progress === 'number') job.progress = progress;
}

/** Append a console line (bounded ring buffer for late-join context). */
export function appendConsole(line) {
  if (!line) return;
  job.consoleTail.push(line);
  if (job.consoleTail.length > CONSOLE_TAIL_MAX) {
    job.consoleTail.splice(0, job.consoleTail.length - CONSOLE_TAIL_MAX);
  }
}

/** Mark the job finished. status: 'complete' | 'error' | 'cancelled'. */
export function finishJob(status, { error = null, outputPath = null, finishedAt } = {}) {
  job.status = status;
  job.error = error;
  job.outputPath = outputPath;
  job.finishedAt = finishedAt ?? null;
  job.step = status;
  if (status === 'complete') job.progress = 100;
  return getJob();
}

export default {
  getJob,
  isRunning,
  startJob,
  updateProgress,
  appendConsole,
  finishJob,
};
