/**
 * TransportControlsWrapper - Renderer-specific wrapper for PlayerControls
 * Manages state and bridge integration for transport controls
 */

import React, { useState, useEffect } from 'react';
import { PlayerControls } from '../../shared/components/PlayerControls.jsx';

export function TransportControlsWrapper({ bridge }) {
  const [playback, setPlayback] = useState({ isPlaying: false, position: 0, duration: 0 });
  const [currentSong, setCurrentSong] = useState(null);
  const [currentEffect, setCurrentEffect] = useState('');

  useEffect(() => {
    if (!bridge) return;

    const unsubscribers = [];

    // Subscribe to playback state
    unsubscribers.push(
      bridge.onPlaybackStateChanged?.((state) => {
        setPlayback(state);
      })
    );

    // Subscribe to current song
    unsubscribers.push(
      bridge.onCurrentSongChanged?.((song) => {
        setCurrentSong(song);
      })
    );

    // Subscribe to effects
    unsubscribers.push(
      bridge.onEffectChanged?.((effect) => {
        setCurrentEffect(effect.current || '');
      })
    );

    // Fetch initial state
    Promise.all([
      bridge.getPlaybackState?.().then(setPlayback).catch(() => {}),
      bridge.getQueue?.().then(data => {
        if (data.currentSong) {
          setCurrentSong(data.currentSong);
        }
      }).catch(() => {})
    ]);

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [bridge]);

  // Player callbacks
  const handlePlay = () => bridge.play?.();
  const handlePause = () => bridge.pause?.();
  const handleRestart = () => bridge.restart?.();
  const handleNext = () => bridge.playNext?.();
  const handleSeek = (position) => bridge.seek?.(position);

  // Effect callbacks
  const handlePreviousEffect = () => bridge.previousEffect?.();
  const handleNextEffect = () => bridge.nextEffect?.();

  const handleOpenCanvasWindow = () => {
    if (window.kaiAPI?.window?.openCanvas) {
      window.kaiAPI.window.openCanvas();
    }
  };

  const isLoading = currentSong?.isLoading || false;

  return (
    <PlayerControls
      playback={playback}
      currentSong={currentSong}
      currentEffect={currentEffect}
      isLoading={isLoading}
      onPlay={handlePlay}
      onPause={handlePause}
      onRestart={handleRestart}
      onNext={handleNext}
      onSeek={handleSeek}
      onPreviousEffect={handlePreviousEffect}
      onNextEffect={handleNextEffect}
      onOpenCanvasWindow={handleOpenCanvasWindow}
    />
  );
}
