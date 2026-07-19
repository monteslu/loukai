/**
 * TransportControlsWrapper - Renderer-specific wrapper for PlayerControls
 * Uses React Context and hooks instead of bridge
 */

import React, { useState, useEffect } from 'react';
import { PlayerControls } from '../../shared/components/PlayerControls.jsx';
import { usePlayerState } from '../../shared/contexts/PlayerContext.jsx';
import { usePlayer } from '../../shared/hooks/usePlayer.js';

export function TransportControlsWrapper({ bridge: _bridge }) {
  const { currentSong, isPlaying, currentPosition, duration } = usePlayerState();
  const { play, pause, restart, next, seek } = usePlayer();
  const [currentEffect, setCurrentEffect] = useState('');
  const [keyShift, setKeyShift] = useState(0);

  // Track the loaded song's key shift: main relays every change (from the web
  // admin or from here) via mixer:keyShift; song loads reset it through the
  // engine's mixer report, which also flows back through main.
  useEffect(() => {
    const kaiPlayer = window.app?.player?.kaiPlayer;
    if (kaiPlayer) setKeyShift(kaiPlayer.keyShift ?? 0);
    if (!window.kaiAPI?.mixer?.onKeyShift) return;
    const handle = (event, { semitones }) => setKeyShift(semitones ?? 0);
    window.kaiAPI.mixer.onKeyShift(handle);
    return () => {};
  }, []);

  const handleKeyShift = (n) => {
    const kaiPlayer = window.app?.player?.kaiPlayer;
    if (kaiPlayer) {
      setKeyShift(kaiPlayer.setKeyShift(n));
    }
  };

  // Subscribe to effects state (TODO: move to EffectsContext in future)
  useEffect(() => {
    if (!window.kaiAPI?.effects) return;

    const handleEffectChanged = (event, effects) => {
      setCurrentEffect(effects.current || '');
    };

    window.kaiAPI.effects.onChanged(handleEffectChanged);

    return () => {
      window.kaiAPI.effects.removeChangedListener(handleEffectChanged);
    };
  }, []);

  // Effect callbacks (TODO: move to useEffects hook in future)
  const handlePreviousEffect = () => {
    if (window.kaiAPI?.effects) {
      window.kaiAPI.effects.previous();
    }
  };

  const handleNextEffect = () => {
    if (window.kaiAPI?.effects) {
      window.kaiAPI.effects.next();
    }
  };

  const handleOpenCanvasWindow = () => {
    if (window.kaiAPI?.window?.openCanvas) {
      window.kaiAPI.window.openCanvas();
    }
  };

  const playback = { isPlaying, position: currentPosition, duration };
  const isLoading = currentSong?.isLoading || false;

  return (
    <PlayerControls
      playback={playback}
      currentSong={currentSong}
      currentEffect={currentEffect}
      isLoading={isLoading}
      onPlay={play}
      onPause={pause}
      onRestart={restart}
      onNext={next}
      onSeek={seek}
      onPreviousEffect={handlePreviousEffect}
      onNextEffect={handleNextEffect}
      onOpenCanvasWindow={handleOpenCanvasWindow}
      keyShift={keyShift}
      songKey={currentSong?.key}
      onKeyShift={handleKeyShift}
    />
  );
}
