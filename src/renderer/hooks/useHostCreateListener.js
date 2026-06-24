import { useEffect } from 'react';
import { hostCreate } from '../../shared/creator/hostCreate.js';

/**
 * useHostCreateListener — registers the player renderer as the HOST compute engine for
 * remote (phone) creation. When a phone web-admin asks the host to create a karaoke
 * file, main relays the upload here as a `creator:hostCreate` command; we run the same
 * WebGPU compute the Create tab uses (separation + transcription + pitch + AAC encode)
 * and stream progress + the final stems back to main, which muxes + saves the file.
 *
 * Mounted ONCE at the player app root so it works regardless of which tab is open (the
 * phone path must not depend on the Create tab being mounted). No-op in the web admin
 * (window.kaiAPI is absent there).
 */
export function useHostCreateListener() {
  useEffect(() => {
    const api = window.kaiAPI?.creator;
    if (!api?.onHostCreate) return undefined;

    const unsub = api.onHostCreate(async ({ jobId, audioBytes, opts }) => {
      const onProgress = (p) => {
        try {
          api.sendHostCreateProgress(jobId, p);
        } catch {
          /* progress is best-effort */
        }
      };
      try {
        const result = await hostCreate({ audioBytes, opts }, onProgress);
        api.sendHostCreateResult(jobId, { success: true, ...result });
      } catch (e) {
        api.sendHostCreateResult(jobId, {
          success: false,
          error: e?.message || 'host create failed',
        });
      }
    });

    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, []);
}
