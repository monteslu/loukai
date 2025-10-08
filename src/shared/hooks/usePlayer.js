/**
 * usePlayer - Playback control hook
 *
 * Directly controls audio engine in renderer process
 * Only uses IPC for next song (queue management in main process)
 */

import { usePlayerState } from '../contexts/PlayerContext.jsx';
import { useAudio } from '../contexts/AudioContext.jsx';

export function usePlayer() {
  const { currentSong, isPlaying } = usePlayerState();
  const { kaiPlayer, player } = useAudio();

  const togglePlayback = async () => {
    if (!currentSong || !player || !player.currentPlayer) return;

    if (isPlaying) {
      await player.pause();
    } else {
      await player.play();
    }
  };

  const play = async () => {
    if (!player || !player.currentPlayer || isPlaying) return;
    await player.play();
  };

  const pause = async () => {
    if (!player || !player.currentPlayer || !isPlaying) return;
    await player.pause();
  };

  const seek = async (positionSec) => {
    if (!player || !player.currentPlayer) return;

    // For KAI format, use kaiPlayer.seek()
    if (player.currentFormat === 'kai' && kaiPlayer) {
      await kaiPlayer.seek(positionSec);
    }
    // For CDG format, seek is handled differently
    else if (player.currentFormat === 'cdg' && player.cdgPlayer) {
      await player.cdgPlayer.seek(positionSec);
    }

    // Report state change
    if (player.currentPlayer.reportStateChange) {
      player.currentPlayer.reportStateChange();
    }
  };

  const restart = async () => {
    if (!player || !player.currentPlayer) return;

    // Seek to 0
    if (player.currentFormat === 'kai' && kaiPlayer) {
      await kaiPlayer.seek(0);
    } else if (player.currentFormat === 'cdg' && player.cdgPlayer) {
      await player.cdgPlayer.seek(0);
    }

    // Start playing if not already
    if (!isPlaying) {
      await player.currentPlayer.play();
      player.isPlaying = true;
    }

    // Report state change
    if (player.currentPlayer.reportStateChange) {
      player.currentPlayer.reportStateChange();
    }
  };

  const next = async () => {
    // Next song requires queue management in main process
    if (!window.kaiAPI?.player) return;
    await window.kaiAPI.player.next();
  };

  return {
    togglePlayback,
    play,
    pause,
    seek,
    restart,
    next,
  };
}
