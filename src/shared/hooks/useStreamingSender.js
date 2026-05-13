/**
 * useStreamingSender - browser-viewer broadcast sender
 *
 * Loads streamingSender on mount and binds its signaling listeners to the
 * IPC bridge so that viewer-join/answer/ice/leave events from the embedded
 * web server are handled. The sender stays idle until the first viewer joins.
 */

import { useEffect } from 'react';

export function useStreamingSender() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const module = await import('../../renderer/js/streamingSender.js');
        if (cancelled) return;
        module.default.bindSignalingListeners();
        console.log('✅ Streaming sender initialized');
      } catch (err) {
        console.error('Failed to initialize streaming sender:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
