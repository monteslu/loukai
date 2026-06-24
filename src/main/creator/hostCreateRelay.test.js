/**
 * hostCreateRelay tests — the main↔renderer protocol for a long host-create job. These
 * cover the regression-prone parts: resolve/reject on response, the idle watchdog (and
 * that progress RESETS it), window-gone reject, settle-once, and full listener cleanup
 * on every exit path. Dependencies (ipc, webContents, timers) are injected so this runs
 * with no Electron and deterministic timers.
 */

import { describe, it, expect } from 'vitest';
import { runHostCreateRelay } from './hostCreateRelay.js';

// Minimal ipcMain-like emitter that tracks listeners so we can assert cleanup.
function makeIpc() {
  const map = new Map(); // channel → Set<fn>
  const add = (ch, fn) => {
    if (!map.has(ch)) map.set(ch, new Set());
    map.get(ch).add(fn);
  };
  return {
    on: (ch, fn) => add(ch, fn),
    once: (ch, fn) => add(ch, fn), // for tests, treat once like on (we remove manually)
    removeListener: (ch, fn) => map.get(ch)?.delete(fn),
    emit: (ch, event, payload) => {
      for (const fn of [...(map.get(ch) || [])]) fn(event, payload);
    },
    count: (ch) => map.get(ch)?.size || 0,
    total: () => [...map.values()].reduce((n, s) => n + s.size, 0),
  };
}

// webContents-like: records sends, lets tests fire window-gone, tracks listeners.
function makeWebContents({ destroyed = false } = {}) {
  const map = new Map();
  const add = (ch, fn) => {
    if (!map.has(ch)) map.set(ch, new Set());
    map.get(ch).add(fn);
  };
  return {
    sent: [],
    isDestroyed: () => destroyed,
    send: function (ch, payload) {
      this.sent.push({ ch, payload });
    },
    once: (ch, fn) => add(ch, fn),
    removeListener: (ch, fn) => map.get(ch)?.delete(fn),
    fire: (ch) => {
      for (const fn of [...(map.get(ch) || [])]) fn();
    },
    listenerTotal: () => [...map.values()].reduce((n, s) => n + s.size, 0),
  };
}

// A controllable timer: setTimer returns an id; tests call tick(id) to fire it.
function makeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    setTimer: (fn) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    tick: (id) => {
      const fn = timers.get(id);
      if (fn) fn();
    },
    active: () => timers.size,
  };
}

const JOB = { jobId: 'job-1', audioBytes: new Uint8Array([1, 2, 3]), opts: { language: 'en' } };
const respChan = `creator:hostCreate:response:${JOB.jobId}`;

describe('runHostCreateRelay', () => {
  it('sends the FULL command payload to the renderer', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const p = runHostCreateRelay({ ipc, webContents: wc, ...t }, JOB);
    // Resolve so the promise doesn't dangle.
    ipc.emit(respChan, {}, { success: true, stems: {} });
    await p;
    expect(wc.sent).toHaveLength(1);
    expect(wc.sent[0].ch).toBe('creator:hostCreate');
    expect(wc.sent[0].payload).toEqual(JOB); // jobId + audioBytes + opts all forwarded
  });

  it('resolves with the renderer success result and cleans up all listeners', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const p = runHostCreateRelay({ ipc, webContents: wc, ...t }, JOB);
    ipc.emit(respChan, {}, { success: true, stems: { vocals: 1 }, key: 'Am' });
    const result = await p;
    expect(result.key).toBe('Am');
    expect(ipc.total()).toBe(0); // all ipc listeners removed
    expect(wc.listenerTotal()).toBe(0); // window listeners removed
    expect(t.active()).toBe(0); // watchdog cleared
  });

  it('rejects with the renderer error message', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const p = runHostCreateRelay({ ipc, webContents: wc, ...t }, JOB);
    ipc.emit(respChan, {}, { success: false, error: 'GPU OOM' });
    await expect(p).rejects.toThrow('GPU OOM');
    expect(ipc.total()).toBe(0);
  });

  it('rejects immediately when there is no usable webContents', async () => {
    const ipc = makeIpc();
    const t = makeTimers();
    await expect(runHostCreateRelay({ ipc, webContents: undefined, ...t }, JOB)).rejects.toThrow(
      'no player window'
    );
    await expect(
      runHostCreateRelay({ ipc, webContents: makeWebContents({ destroyed: true }), ...t }, JOB)
    ).rejects.toThrow('no player window');
  });

  it('rejects when the idle watchdog fires (renderer went silent)', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const p = runHostCreateRelay({ ipc, webContents: wc, idleMs: 1000, ...t }, JOB);
    // One watchdog armed.
    expect(t.active()).toBe(1);
    // Fire it.
    t.tick(1);
    await expect(p).rejects.toThrow('timed out');
    expect(ipc.total()).toBe(0);
    expect(wc.listenerTotal()).toBe(0);
  });

  it('progress RESETS the watchdog (a long-but-alive job is not killed) and streams progress', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const seen = [];
    const p = runHostCreateRelay({ ipc, webContents: wc, idleMs: 1000, ...t }, JOB, (pr) =>
      seen.push(pr)
    );
    const firstTimerId = 1;
    // A progress tick should clear timer 1 and arm a new one (timer 2).
    ipc.emit(
      'creator:hostCreate:progress',
      {},
      { jobId: JOB.jobId, progress: { phase: 'separating', progress: 5 } }
    );
    expect(seen).toEqual([{ phase: 'separating', progress: 5 }]);
    // Firing the ORIGINAL (now-cleared) timer must NOT settle the promise.
    t.tick(firstTimerId);
    // Still resolvable → not rejected by the stale timer.
    ipc.emit(respChan, {}, { success: true, ok: 1 });
    await expect(p).resolves.toMatchObject({ ok: 1 });
  });

  it('ignores progress for a DIFFERENT jobId', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const seen = [];
    const p = runHostCreateRelay({ ipc, webContents: wc, ...t }, JOB, (pr) => seen.push(pr));
    ipc.emit('creator:hostCreate:progress', {}, { jobId: 'other-job', progress: { phase: 'x' } });
    expect(seen).toHaveLength(0); // not ours → ignored
    ipc.emit(respChan, {}, { success: true });
    await p;
  });

  it('rejects when the player window is destroyed mid-job', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const p = runHostCreateRelay({ ipc, webContents: wc, ...t }, JOB);
    wc.fire('destroyed');
    await expect(p).rejects.toThrow('window closed');
    expect(ipc.total()).toBe(0);
    expect(t.active()).toBe(0);
  });

  it('settles ONCE: a response after a timeout is ignored (no double-settle)', async () => {
    const ipc = makeIpc();
    const wc = makeWebContents();
    const t = makeTimers();
    const p = runHostCreateRelay({ ipc, webContents: wc, idleMs: 1000, ...t }, JOB);
    t.tick(1); // timeout → reject
    await expect(p).rejects.toThrow('timed out');
    // A late renderer response must be a no-op (listeners already removed; settled).
    expect(() => ipc.emit(respChan, {}, { success: true })).not.toThrow();
  });
});
