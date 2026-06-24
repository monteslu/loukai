import { useEffect, useState } from 'react';

/**
 * useCreatorJob — observe the single creator job descriptor on any admin surface.
 *
 * There is exactly ONE creation at a time per Loukai process (the pipeline is a hard
 * singleton). main broadcasts that descriptor on every change to BOTH the player
 * renderer (IPC `creator:job`) and every web admin (socket `creator:job`). This hook:
 *   1. pulls the current descriptor on mount (so a tab opened/refreshed mid-job shows
 *      the live job, not a blank form), and
 *   2. subscribes to live updates.
 *
 * Transport is auto-detected: the Electron player uses `window.kaiAPI.creator`
 * (IPC); the web admin passes its `bridge` (WebBridge) so this stays bridge-clean.
 *
 * @param {object} [opts]
 * @param {object} [opts.bridge] - WebBridge instance (web admin). Omit in the player.
 * @returns {{ job: object|null, isRunning: boolean }}
 */
export function useCreatorJob({ bridge } = {}) {
  const [job, setJob] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const ipc = typeof window !== 'undefined' ? window.kaiAPI?.creator : null;

    // 1) Pull current status on mount (late-join / refresh safety).
    (async () => {
      try {
        let status;
        if (ipc?.getStatus) status = await ipc.getStatus();
        else if (bridge?.getCreatorStatus) status = await bridge.getCreatorStatus();
        if (!cancelled && status?.job) setJob(status.job);
      } catch {
        /* no status yet — stay null until a live event arrives */
      }
    })();

    // 2) Subscribe to live updates (IPC in the player, socket in the web admin).
    let unsub = () => {};
    if (ipc?.onJob) {
      unsub = ipc.onJob((j) => {
        if (!cancelled) setJob(j);
      });
    } else if (bridge?.onStateChange) {
      const handler = (j) => {
        if (!cancelled) setJob(j);
      };
      unsub = bridge.onStateChange('creatorJob', handler);
    }

    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [bridge]);

  return { job, isRunning: job?.status === 'running' };
}
