/**
 * Renderer App - React UI for Electron renderer process
 *
 * This runs alongside the existing vanilla JS code.
 * React components will eventually replace vanilla JS UI elements.
 */

import React, { useState, useEffect } from 'react';
import { useBridge } from '../../shared/context/BridgeContext.jsx';
import { PlayerControls } from '../../shared/components/PlayerControls.jsx';
import { MixerPanel } from '../../shared/components/MixerPanel.jsx';
import { QueueList } from '../../shared/components/QueueList.jsx';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';
import './App.css';

export default function App() {
  const bridge = useBridge();

  // State
  const [playback, setPlayback] = useState({ isPlaying: false, position: 0, duration: 0 });
  const [currentSong, setCurrentSong] = useState(null);
  const [queue, setQueue] = useState([]);
  const [mixerState, setMixerState] = useState({});
  const [currentEffect, setCurrentEffect] = useState('');

  // Subscribe to state updates from bridge
  useEffect(() => {
    const unsubscribers = [];

    // Playback state updates
    unsubscribers.push(
      bridge.onPlaybackStateChanged((state) => {
        setPlayback(state);
      })
    );

    // Current song updates
    unsubscribers.push(
      bridge.onCurrentSongChanged((song) => {
        setCurrentSong(song);
      })
    );

    // Queue updates
    unsubscribers.push(
      bridge.onQueueChanged((queueData) => {
        setQueue(queueData.queue || []);
      })
    );

    // Mixer updates
    unsubscribers.push(
      bridge.onMixerChanged((mixer) => {
        setMixerState(mixer);
      })
    );

    // Effects updates
    unsubscribers.push(
      bridge.onEffectChanged((effect) => {
        setCurrentEffect(effect.current || '');
      })
    );

    // Initial data fetch
    Promise.all([
      bridge.getPlaybackState().then(setPlayback).catch(() => {}),
      bridge.getQueue().then(data => setQueue(data.queue || [])).catch(() => {}),
      bridge.getMixerState().then(setMixerState).catch(() => {})
    ]);

    // Cleanup subscriptions
    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [bridge]);

  // Player callbacks
  const handlePlay = () => bridge.play();
  const handlePause = () => bridge.pause();
  const handleRestart = () => bridge.restart();
  const handleNext = () => bridge.playNext();
  const handleSeek = (position) => bridge.seek(position);

  // Mixer callbacks
  const handleSetMasterGain = (bus, gain) => bridge.setMasterGain(bus, gain);
  const handleToggleMasterMute = (bus) => bridge.toggleMasterMute(bus);

  // Queue callbacks
  const handlePlayFromQueue = (songId) => bridge.playFromQueue(songId);
  const handleRemoveFromQueue = (songId) => bridge.removeFromQueue(songId);
  const handleClearQueue = () => bridge.clearQueue();

  // Effects callbacks
  const handlePreviousEffect = () => bridge.previousEffect();
  const handleNextEffect = () => bridge.nextEffect();
  const handleOpenCanvasWindow = () => {
    // This will use IPC directly since it's Electron-specific
    if (window.kaiAPI?.window?.openCanvas) {
      window.kaiAPI.window.openCanvas();
    }
  };

  // Keyboard shortcut callbacks
  const handleTogglePlayback = async () => {
    if (playback.isPlaying) {
      await bridge.pause();
    } else {
      await bridge.play();
    }
  };

  const handleToggleVocalsGlobal = async () => {
    await bridge.toggleMute('vocals', 'PA');
    await bridge.toggleMute('vocals', 'IEM');
  };

  const handleToggleVocalsPA = async () => {
    await bridge.toggleMute('vocals', 'PA');
  };

  const handleToggleStemMute = async (stemIndex) => {
    // TODO: Implement stem mute/solo in React mixer panel
    console.warn('toggleStemMute not yet implemented in React mixer', stemIndex);
  };

  const handleToggleStemSolo = async (stemIndex) => {
    // TODO: Implement stem mute/solo in React mixer panel
    console.warn('toggleStemSolo not yet implemented in React mixer', stemIndex);
  };

  // Set up keyboard shortcuts
  useKeyboardShortcuts({
    onTogglePlayback: handleTogglePlayback,
    onToggleVocalsGlobal: handleToggleVocalsGlobal,
    onToggleVocalsPA: handleToggleVocalsPA,
    onToggleStemMute: handleToggleStemMute,
    onToggleStemSolo: handleToggleStemSolo
  });

  return (
    <div className="react-root-container">
      <div className="react-app-content">
        <div className="react-section">
          <h3>🎵 Player Controls</h3>
          <PlayerControls
            playback={playback}
            currentSong={currentSong}
            currentEffect={currentEffect}
            onPlay={handlePlay}
            onPause={handlePause}
            onRestart={handleRestart}
            onNext={handleNext}
            onSeek={handleSeek}
            onPreviousEffect={handlePreviousEffect}
            onNextEffect={handleNextEffect}
            onOpenCanvasWindow={handleOpenCanvasWindow}
          />
        </div>

        <div className="react-section">
          <h3>🎚️ Mixer</h3>
          <MixerPanel
            mixerState={mixerState}
            onSetMasterGain={handleSetMasterGain}
            onToggleMasterMute={handleToggleMasterMute}
          />
        </div>

        <div className="react-section">
          <h3>📋 Queue</h3>
          <QueueList
            queue={queue}
            currentIndex={currentSong?.queueItemId ? queue.findIndex(item =>
              item.id === currentSong.queueItemId
            ) : -1}
            onPlayFromQueue={handlePlayFromQueue}
            onRemoveFromQueue={handleRemoveFromQueue}
            onClearQueue={handleClearQueue}
          />
        </div>

        <div className="react-test-note">
          <p>✅ React UI Active</p>
          <p className="text-muted">Live sync with main process</p>
        </div>
      </div>
    </div>
  );
}
