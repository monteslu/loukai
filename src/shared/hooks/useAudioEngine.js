/**
 * useAudioEngine - Audio engine initialization hook
 *
 * Initializes KAIPlayer and PlayerController
 * Handles song loading events from main process
 */

import { useEffect } from 'react';
import { useAudio } from '../contexts/AudioContext.jsx';

export function useAudioEngine() {
  const { kaiPlayer, player, setKaiPlayer, setPlayer } = useAudio();

  // Initialize audio engine
  useEffect(() => {
    let mounted = true;

    async function initializeAudio() {
      try {
        // Dynamically import to avoid circular deps
        const { KAIPlayer } = await import('../../renderer/js/kaiPlayer.js');
        const { PlayerController } = await import('../../renderer/js/player.js');

        const audioEngine = new KAIPlayer();
        await audioEngine.initialize();

        if (!mounted) return;

        const playerController = new PlayerController(audioEngine);

        setKaiPlayer(audioEngine);
        setPlayer(playerController);

        // Expose player globally for legacy code that needs direct access
        window.app = window.app || {};
        window.app.player = playerController;

        console.log('✅ Audio engine initialized');
      } catch (error) {
        console.error('❌ Failed to initialize audio engine:', error);
      }
    }

    if (!kaiPlayer) {
      initializeAudio();
    }

    return () => {
      mounted = false;
    };
  }, [kaiPlayer, setKaiPlayer, setPlayer]);

  // Handle mixer changes from main process (web admin or other sources)
  useEffect(() => {
    if (!kaiPlayer || !window.kaiAPI?.mixer) return;

    const handleSetMasterGain = (event, { bus, gainDb }) => {
      console.log(`🎚️ Received mixer:setMasterGain from main: ${bus} = ${gainDb}dB`);
      kaiPlayer.setMasterGain(bus, gainDb);
    };

    const handleToggleMasterMute = (event, { bus, muted }) => {
      // IMPORTANT: Despite the event name being "toggle", the event includes the explicit muted value
      // Don't call toggleMasterMute() as that would toggle again - use setMasterMute()
      console.log(`🎚️ Received mixer:toggleMasterMute from main: ${bus} = ${muted}`);
      kaiPlayer.setMasterMute(bus, muted);
    };

    const handleSetMasterMute = (event, { bus, muted }) => {
      console.log(`🎚️ Received mixer:setMasterMute from main: ${bus} = ${muted}`);
      kaiPlayer.setMasterMute(bus, muted);
    };

    window.kaiAPI.mixer.onSetMasterGain(handleSetMasterGain);
    window.kaiAPI.mixer.onToggleMasterMute(handleToggleMasterMute);
    window.kaiAPI.mixer.onSetMasterMute(handleSetMasterMute);

    console.log('✅ Mixer IPC listeners registered');

    // Note: Cleanup would require preload.js to expose removeListener methods
    // These are long-lived listeners so cleanup is not critical
    return () => {
      console.log('🧹 Mixer IPC listeners cleanup');
    };
  }, [kaiPlayer]);

  // Handle song loading events
  useEffect(() => {
    if (!player || !kaiPlayer || !window.kaiAPI?.song) return;

    // Create mutable app state object (needed by songLoaders)
    const appState = {
      player,
      kaiPlayer,
      currentSong: null,
      _pendingMetadata: null,
      randomEffectTimeout: null,
      handleSongEnded: () => {
        // Song ended - trigger next song via IPC
        if (window.kaiAPI?.player) {
          window.kaiAPI.player.next();
        }
      },
      updateStatus: (msg) => console.log('📊', msg),
      updateEffectDisplay: () => {}, // TODO: implement if needed
    };

    const handleSongLoaded = async (event, metadata) => {
      console.log('🎵 Song loading:', metadata?.title || 'Unknown');
      appState._pendingMetadata = metadata;

      // Stop current playback
      if (kaiPlayer) {
        await kaiPlayer.pause();
      }
      if (player) {
        await player.pause();
        // Also stop CDG renderer if it's playing
        if (player.cdgPlayer && player.cdgPlayer.isPlaying) {
          player.cdgPlayer.pause();
        }
      }

      // Notify PlayerController to load song metadata (lyrics, etc.)
      if (player && player.onSongLoaded) {
        player.onSongLoaded(metadata);
      }
    };

    const handleSongData = async (event, songData) => {
      console.log('🎵 Song data received:', songData.format, songData.originalFilePath);

      // Check if this is the same song
      const isSameSong =
        appState.currentSong && appState.currentSong.originalFilePath === songData.originalFilePath;

      appState.currentSong = songData;

      // Reset play state when loading a new song
      if (!isSameSong) {
        if (kaiPlayer) {
          await kaiPlayer.pause();
        }
        if (player?.cdgPlayer?.isPlaying) {
          player.cdgPlayer.pause();
        }
        if (player?.currentPlayer?.isPlaying) {
          await player.currentPlayer.pause();
        }
      }

      // Use pending metadata if available
      const metadata = appState._pendingMetadata || songData.metadata || {};

      // Detect format: CDG or KAI
      const isCDG = songData.format === 'cdg';

      try {
        // Load song using songLoaders
        const { loadCDGSong, loadKAISong } = await import('../../renderer/js/songLoaders.js');

        if (isCDG) {
          await loadCDGSong(appState, songData, metadata);
        } else {
          await loadKAISong(appState, songData, metadata);
        }

        console.log('✅ Song loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load song:', error);
      }

      // Clear pending metadata
      appState._pendingMetadata = null;
    };

    window.kaiAPI.song.onLoaded(handleSongLoaded);
    window.kaiAPI.song.onData(handleSongData);

    // Handle playback control events from main process (web admin commands)
    const handleTogglePlayback = async () => {
      console.log('🌐 Remote play/pause command');
      if (!player) return;

      if (player.isPlaying) {
        await player.pause();
      } else {
        await player.play();
      }
    };

    const handleRestart = async () => {
      console.log('🌐 Remote restart command');
      if (!player || !player.currentPlayer) return;

      // Seek to 0 based on format
      if (player.currentFormat === 'kai' && kaiPlayer) {
        await kaiPlayer.seek(0);
      } else if (player.currentFormat === 'cdg' && player.cdgPlayer) {
        await player.cdgPlayer.seek(0);
      }

      if (!player.isPlaying) {
        await player.play();
      }
    };

    const handleSetPosition = async (event, positionSec) => {
      console.log('🌐 Remote seek command:', positionSec);
      if (!player || !player.currentPlayer) return;

      // Seek based on format
      if (player.currentFormat === 'kai' && kaiPlayer) {
        await kaiPlayer.seek(positionSec);
      } else if (player.currentFormat === 'cdg' && player.cdgPlayer) {
        await player.cdgPlayer.seek(positionSec);
      }

      if (player.currentPlayer.reportStateChange) {
        player.currentPlayer.reportStateChange();
      }
    };

    window.kaiAPI.player.onTogglePlayback(handleTogglePlayback);
    window.kaiAPI.player.onRestart(handleRestart);
    window.kaiAPI.player.onSetPosition(handleSetPosition);

    // Handle settings changes (from local UI or remote web admin)
    const handleWaveformSettings = (event, settings) => {
      console.log('🎨 Waveform settings changed:', settings);
      if (player && player.applyWaveformSettings) {
        player.applyWaveformSettings(settings);
      }
    };

    if (window.kaiAPI.events) {
      window.kaiAPI.events.on('waveform:settingsChanged', handleWaveformSettings);
    }

    return () => {
      window.kaiAPI.song.removeSongListener(handleSongLoaded);
      window.kaiAPI.song.removeDataListener?.(handleSongData);
      window.kaiAPI.player.removeTogglePlaybackListener(handleTogglePlayback);
      window.kaiAPI.player.removeRestartListener(handleRestart);
      window.kaiAPI.player.removeSetPositionListener(handleSetPosition);

      if (window.kaiAPI.events) {
        window.kaiAPI.events.off?.('waveform:settingsChanged', handleWaveformSettings);
      }

      if (appState.randomEffectTimeout) {
        clearTimeout(appState.randomEffectTimeout);
      }
    };
  }, [player, kaiPlayer]);

  return { kaiPlayer, player };
}
