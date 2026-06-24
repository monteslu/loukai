/**
 * creatorJob tests — the single-job descriptor that makes "a creation is running"
 * observable on every admin surface. Covers the lifecycle, the bounded console tail,
 * and the onChange broadcast hook that main fans out to IPC + sockets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('creatorJob', () => {
  let job;

  beforeEach(async () => {
    vi.resetModules();
    job = await import('./creatorJob.js');
    // Each test starts from a finished/idle state so isRunning() is false.
    if (job.isRunning()) job.finishJob('cancelled');
  });

  describe('lifecycle', () => {
    it('starts idle', () => {
      const j = job.getJob();
      expect(j.status).toBe('idle');
      expect(j.progress).toBe(0);
      expect(job.isRunning()).toBe(false);
    });

    it('startJob marks running and records source/title/artist', () => {
      const j = job.startJob({ title: 'Song', artist: 'Band', source: 'web', startedAt: 5 });
      expect(j.status).toBe('running');
      expect(j.title).toBe('Song');
      expect(j.artist).toBe('Band');
      expect(j.source).toBe('web');
      expect(j.startedAt).toBe(5);
      expect(job.isRunning()).toBe(true);
    });

    it('finishJob complete sets progress 100 and stops running', () => {
      job.startJob({ title: 'Song', startedAt: 0 });
      const j = job.finishJob('complete', { outputPath: '/songs/x.stem.mp4', finishedAt: 9 });
      expect(j.status).toBe('complete');
      expect(j.progress).toBe(100);
      expect(j.outputPath).toBe('/songs/x.stem.mp4');
      expect(j.finishedAt).toBe(9);
      expect(job.isRunning()).toBe(false);
    });

    it('finishJob error carries the message', () => {
      job.startJob({ startedAt: 0 });
      const j = job.finishJob('error', { error: 'boom' });
      expect(j.status).toBe('error');
      expect(j.error).toBe('boom');
      expect(job.isRunning()).toBe(false);
    });

    it('updateProgress only applies while running', () => {
      job.startJob({ startedAt: 0 });
      job.updateProgress({ step: 'muxing', progress: 60 });
      expect(job.getJob().step).toBe('muxing');
      expect(job.getJob().progress).toBe(60);

      job.finishJob('complete', {});
      job.updateProgress({ step: 'late', progress: 5 });
      // Ignored after finish — progress stays at the completed value.
      expect(job.getJob().step).not.toBe('late');
      expect(job.getJob().progress).toBe(100);
    });
  });

  describe('console tail', () => {
    it('is a bounded ring buffer (keeps the most recent lines)', () => {
      job.startJob({ startedAt: 0 });
      for (let i = 0; i < 80; i++) job.appendConsole(`line ${i}`);
      const tail = job.getJob().consoleTail;
      expect(tail.length).toBe(60); // CONSOLE_TAIL_MAX
      expect(tail[tail.length - 1]).toBe('line 79');
      expect(tail[0]).toBe('line 20');
    });
  });

  describe('onChange broadcast hook', () => {
    it('notifies subscribers on every mutation with a fresh descriptor', () => {
      const seen = [];
      const unsub = job.onChange((j) => seen.push(j.status));
      job.startJob({ startedAt: 0 });
      job.updateProgress({ progress: 50 });
      job.finishJob('complete', {});
      expect(seen).toEqual(['running', 'running', 'complete']);
      unsub();
    });

    it('returns a working unsubscribe', () => {
      const fn = vi.fn();
      const unsub = job.onChange(fn);
      job.startJob({ startedAt: 0 });
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      job.finishJob('complete', {});
      expect(fn).toHaveBeenCalledTimes(1); // no more calls after unsub
    });

    it('a throwing listener does not break the mutation', () => {
      job.onChange(() => {
        throw new Error('bad listener');
      });
      expect(() => job.startJob({ startedAt: 0 })).not.toThrow();
      expect(job.isRunning()).toBe(true);
    });

    it('passes a serializable snapshot (consoleTail is a copy)', () => {
      let captured = null;
      const unsub = job.onChange((j) => {
        captured = j;
      });
      job.startJob({ startedAt: 0 });
      job.appendConsole('hello');
      // Mutating the captured snapshot must not affect internal state.
      captured.consoleTail.push('tampered');
      expect(job.getJob().consoleTail).toEqual(['hello']);
      unsub();
    });
  });
});
