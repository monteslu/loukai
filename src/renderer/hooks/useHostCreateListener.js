import { useEffect, useRef } from 'react';
import { hostCreate } from '../../shared/creator/hostCreate.js';
import { setCreatorGentle } from '../../shared/creator/createKaraokeClient.js';
import { useAudio } from '../../shared/contexts/AudioContext.jsx';

/**
 * useHostCreateListener — registers the player renderer as the HOST compute engine for
 * remote (phone) creation. When a phone web-admin asks the host to create a karaoke
 * file, main relays the upload here as a `creator:hostCreate` command; we run the same
 * WebGPU compute the Create tab uses (separation + transcription + pitch + AAC encode)
 * and stream progress + the final stems back to main, which muxes + saves the file.
 *
 * GENTLE MODE, LIVE: while the host is PLAYING, separation runs in gentle duty (chained
 * model pieces with per-piece queue drains + ~50% pacing) so the karaoke video the room
 * is watching keeps its frame rate; idle host = fast mode. The flag is LIVE — playback
 * starting or stopping mid-job flips the running separator within a segment (~<1s), so
 * a creation that started on an idle player backs off the moment someone hits play.
 *
 * Mounted ONCE at the player app root so it works regardless of which tab is open (the
 * phone path must not depend on the Create tab being mounted). No-op in the web admin
 * (window.kaiAPI is absent there).
 */
export function useHostCreateListener() {
  // Fresh player handle for the job callback without re-registering the listener.
  const { kaiPlayer } = useAudio();
  const kaiPlayerRef = useRef(null);
  kaiPlayerRef.current = kaiPlayer;

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
      // Duty at job start + LIVE while the job runs: watch playback and flip the
      // worker's gentle flag on change (the runner reacts within one segment).
      const isPlaying = () => Boolean(kaiPlayerRef.current?.isPlaying);
      let gentle = isPlaying();
      if (gentle) onProgress({ log: 'host is playing — separating in gentle mode' });
      const watch = setInterval(() => {
        const now = isPlaying();
        if (now !== gentle) {
          gentle = now;
          setCreatorGentle(now);
          onProgress({ log: `playback ${now ? 'started — gentle mode' : 'stopped — fast mode'}` });
        }
      }, 1000);
      try {
        const result = await hostCreate({ audioBytes, opts: { ...opts, gentle } }, onProgress);
        api.sendHostCreateResult(jobId, { success: true, ...result });
      } catch (e) {
        api.sendHostCreateResult(jobId, {
          success: false,
          error: e?.message || 'host create failed',
        });
      } finally {
        clearInterval(watch);
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
