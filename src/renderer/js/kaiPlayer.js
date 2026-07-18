import { PlayerInterface } from './PlayerInterface.js';
import { MicrophoneEngine } from './microphoneEngine.js';
import {
  effectiveStemGain,
  resolveStemEntry,
  clampStemGain,
  mergeStemMix,
} from '../../shared/utils/stemGain.js';
import { isVocalStem, isMixdownStem, isMelodicStem } from '../../shared/utils/stemClassify.js';

export class KAIPlayer extends PlayerInterface {
  constructor() {
    super(); // Call PlayerInterface constructor

    // Dual audio contexts for PA and IEM outputs
    this.audioContexts = {
      PA: null,
      IEM: null,
    };

    // Device IDs for PA and IEM outputs
    this.outputDevices = {
      PA: 'default',
      IEM: 'default',
    };

    // Note: this.isPlaying is inherited from PlayerInterface
    this.currentPosition = 0;
    this.songData = null;
    this.audioBuffers = new Map();

    // Separate gain nodes and sources for each output
    this.outputNodes = {
      PA: {
        sourceNodes: new Map(),
        gainNodes: new Map(),
        masterGain: null,
        analyser: null, // For butterchurn visualization
        streamDestination: null, // MediaStreamAudioDestinationNode for browser viewer streaming
      },
      IEM: {
        sourceNodes: new Map(),
        gainNodes: new Map(),
        masterGain: null,
      },
    };

    // Track whether vocals should play through PA (for backup:PA lines)
    this.vocalsPAEnabled = false;

    this.startTime = 0;
    this.pauseTime = 0;

    // Note: this.onSongEndedCallback is inherited from PlayerInterface

    // Microphone engine (handles all mic/auto-tune functionality)
    this.micEngine = null; // Will be initialized after audio contexts are created

    this.mixerState = {
      // Simple 3-fader mixer
      PA: {
        gain: 0, // dB
        muted: false,
      },
      IEM: {
        gain: 0, // dB
        muted: true, // Default muted - user must explicitly enable IEM monitoring
        mono: true, // Always mono for single-ear monitoring
      },
      mic: {
        gain: 0, // dB
        muted: true, // Default muted - user must explicitly enable mic
      },
      // Per-bus per-stem user mix (stem×bus mixer, #49): linear gain multiplier on the
      // authored trim + independent mute, keyed [bus][stemName]. Seeded from the D1
      // defaults; persisted state merges over it in loadDevicePreferences.
      stemMix: mergeStemMix(undefined),
      // Per-song data (for internal use)
      stems: [],
      // Mic routing settings (deprecated - now in micEngine, kept for compatibility)
      micToSpeakers: true,
      enableMic: true,
    };

    // Note: this.stateReportInterval is inherited from PlayerInterface
  }

  async initialize() {
    try {
      // Get available devices first for label-based matching
      const availableDevices = await this.getAvailableOutputDevices();

      // Load and resolve device preferences (matches by label, falls back to ID)
      await this.loadDevicePreferences(availableDevices);

      // Initialize PA audio context with resolved device
      const paContextOptions = {};
      if (this.outputDevices.PA !== 'default' && 'sinkId' in AudioContext.prototype) {
        paContextOptions.sinkId = this.outputDevices.PA;
      }
      this.audioContexts.PA = new (window.AudioContext || window.webkitAudioContext)(
        paContextOptions
      );
      this.outputNodes.PA.masterGain = this.audioContexts.PA.createGain();
      this.outputNodes.PA.masterGain.connect(this.audioContexts.PA.destination);
      // Apply saved PA gain (considering mute state)
      const paGain = this.mixerState.PA.muted ? 0 : this.dbToLinear(this.mixerState.PA.gain);
      this.outputNodes.PA.masterGain.gain.value = paGain;

      // Create analyser for butterchurn visualization (before gain affects signal)
      this.outputNodes.PA.analyser = this.audioContexts.PA.createAnalyser();
      this.outputNodes.PA.analyser.fftSize = 2048;
      this.outputNodes.PA.analyser.smoothingTimeConstant = 0.8;

      // (backup:PA punchthrough now rides the ordinary PA vocals gain node via the
      // stem×bus mixer formula — the old dedicated vocalsPAGain node is gone.)

      // Parallel MediaStream destination for browser viewer streaming.
      // Connected to masterGain in addition to (not instead of) the audio device destination
      // so PA continues playing locally while the viewer receives the same mix.
      this.outputNodes.PA.streamDestination = this.audioContexts.PA.createMediaStreamDestination();
      this.outputNodes.PA.masterGain.connect(this.outputNodes.PA.streamDestination);

      // Initialize IEM audio context with validated device
      const iemContextOptions = {};
      if (this.outputDevices.IEM !== 'default' && 'sinkId' in AudioContext.prototype) {
        iemContextOptions.sinkId = this.outputDevices.IEM;
      }
      this.audioContexts.IEM = new (window.AudioContext || window.webkitAudioContext)(
        iemContextOptions
      );
      this.outputNodes.IEM.masterGain = this.audioContexts.IEM.createGain();
      this.outputNodes.IEM.masterGain.connect(this.audioContexts.IEM.destination);
      // Apply saved IEM gain (considering mute state)
      const iemGain = this.mixerState.IEM.muted ? 0 : this.dbToLinear(this.mixerState.IEM.gain);
      this.outputNodes.IEM.masterGain.gain.value = iemGain;

      // Initialize microphone engine
      this.micEngine = new MicrophoneEngine(this.audioContexts.PA, this.outputNodes.PA.masterGain, {
        getCurrentPosition: () => this.getCurrentPosition(),
      });

      // Load auto-tune worklets
      await this.micEngine.loadAutoTuneWorklet();

      // Load mic settings
      await this.loadMicSettings();

      // Start microphone if enabled (after reinitialize, mic needs to be restarted)
      if (this.micEngine.enableMic) {
        await this.micEngine.startMicrophoneInput(this.micEngine.inputDevice);

        // Apply saved mic gain and mute state
        const linearGain = this.mixerState.mic.muted
          ? 0
          : this.dbToLinear(this.mixerState.mic.gain);
        this.micEngine.setMicrophoneGain(linearGain);
      }

      return true;
    } catch (error) {
      console.warn('⚠️ Audio initialization issue:', error.message);
      return false;
    }
  }

  /**
   * Find a device by matching label first, then ID as fallback
   * @param {MediaDeviceInfo[]} availableDevices - List of available devices
   * @param {Object} savedPref - Saved preference with id and name properties
   * @param {string} busType - Bus type for logging (PA, IEM, input)
   * @returns {string} Resolved device ID or 'default'
   */
  resolveDeviceByLabel(availableDevices, savedPref, busType) {
    if (!savedPref || (!savedPref.id && !savedPref.name)) {
      return 'default';
    }

    // Skip if explicitly set to default
    if (savedPref.deviceKind === 'default' || savedPref.id === '') {
      return 'default';
    }

    // Try to match by label/name first (most reliable across reconnections)
    if (savedPref.name) {
      const byLabel = availableDevices.find((d) => d.label === savedPref.name);
      if (byLabel) {
        if (byLabel.deviceId !== savedPref.id) {
          console.log(`🎧 ${busType}: Matched "${savedPref.name}" by label (ID changed)`);
        }
        return byLabel.deviceId;
      }
    }

    // Fall back to ID match
    if (savedPref.id) {
      const byId = availableDevices.find((d) => d.deviceId === savedPref.id);
      if (byId) {
        return byId.deviceId;
      }
    }

    // Device not found - use default
    console.warn(
      `🎧 ${busType}: Saved device "${savedPref.name || savedPref.id}" not found, using default`
    );
    return 'default';
  }

  async loadDevicePreferences(availableOutputDevices = []) {
    try {
      // Load device preferences from settingsAPI
      if (window.kaiAPI.settings) {
        const devicePrefs = await window.kaiAPI.settings.get('devicePreferences', null);

        if (devicePrefs?.PA) {
          this.outputDevices.PA = this.resolveDeviceByLabel(
            availableOutputDevices,
            devicePrefs.PA,
            'PA'
          );
        }
        if (devicePrefs?.IEM) {
          this.outputDevices.IEM = this.resolveDeviceByLabel(
            availableOutputDevices,
            devicePrefs.IEM,
            'IEM'
          );
        }
        if (devicePrefs?.input) {
          // For input devices, get input device list
          const inputDevices = await this.getAvailableInputDevices();
          this.inputDevice = this.resolveDeviceByLabel(inputDevices, devicePrefs.input, 'input');
        }
      }

      // Load mixer state from AppState
      if (window.kaiAPI?.app) {
        const appState = await window.kaiAPI.app.getState();

        // Load mixer state from AppState
        if (appState?.mixer) {
          if (typeof appState.mixer.PA?.gain === 'number') {
            this.mixerState.PA.gain = appState.mixer.PA.gain;
          }
          if (typeof appState.mixer.PA?.muted === 'boolean') {
            this.mixerState.PA.muted = appState.mixer.PA.muted;
          }
          if (typeof appState.mixer.IEM?.gain === 'number') {
            this.mixerState.IEM.gain = appState.mixer.IEM.gain;
          }
          if (typeof appState.mixer.IEM?.muted === 'boolean') {
            this.mixerState.IEM.muted = appState.mixer.IEM.muted;
          }
          if (typeof appState.mixer.mic?.gain === 'number') {
            this.mixerState.mic.gain = appState.mixer.mic.gain;
          }
          if (typeof appState.mixer.mic?.muted === 'boolean') {
            this.mixerState.mic.muted = appState.mixer.mic.muted;
          }
          // Per-stem mix: merge persisted values over the D1 seed (handles old saved
          // states with no stemMix at all, junk values, and unknown stem keys).
          this.mixerState.stemMix = mergeStemMix(appState.mixer.stemMix);
        }
      }
    } catch (error) {
      console.warn('Failed to load device preferences:', error.message);
    }
  }

  /**
   * Get list of available audio output devices
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async getAvailableOutputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audiooutput');
    } catch (error) {
      console.warn('Failed to enumerate output devices:', error.message);
      return [];
    }
  }

  /**
   * Get list of available audio input devices
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async getAvailableInputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch (error) {
      console.warn('Failed to enumerate input devices:', error.message);
      return [];
    }
  }

  async setOutputDevice(busType, deviceId) {
    try {
      if (!['PA', 'IEM'].includes(busType)) {
        console.error('Invalid bus type:', busType);
        return false;
      }

      const wasPlaying = this.isPlaying;

      // Stop current playback if running (pause() will update currentPosition to actual position)
      if (wasPlaying) {
        this.pause();
      }

      // Capture position AFTER pause, which has the accurate current position
      const currentPos = this.currentPosition;

      // Store the device preference
      this.outputDevices[busType] = deviceId;

      // Close existing context for this bus
      if (this.audioContexts[busType]) {
        await this.audioContexts[busType].close();
      }

      // Create new context with proper device
      const contextOptions = {};
      if (deviceId !== 'default' && 'sinkId' in AudioContext.prototype) {
        contextOptions.sinkId = deviceId;
      } else {
        // Use default device - no additional config needed
      }

      this.audioContexts[busType] = new (window.AudioContext || window.webkitAudioContext)(
        contextOptions
      );
      this.outputNodes[busType].masterGain = this.audioContexts[busType].createGain();
      this.outputNodes[busType].masterGain.connect(this.audioContexts[busType].destination);

      // Reapply saved gain (considering mute state)
      const savedGain = this.mixerState[busType].muted
        ? 0
        : this.dbToLinear(this.mixerState[busType].gain);
      this.outputNodes[busType].masterGain.gain.value = savedGain;

      // Create analyser for PA (for butterchurn visualization)
      if (busType === 'PA') {
        this.outputNodes.PA.analyser = this.audioContexts.PA.createAnalyser();
        this.outputNodes.PA.analyser.fftSize = 2048;
        this.outputNodes.PA.analyser.smoothingTimeConstant = 0.8;

        // Recreate the streaming tap on the NEW context. This was the silent-viewers
        // bug: the old streamDestination belonged to the closed context, so WebRTC
        // viewers lost audio until the next song load. Consumers re-pull
        // getPAStream() on song load; recreating here makes that pull correct.
        this.outputNodes.PA.streamDestination =
          this.audioContexts.PA.createMediaStreamDestination();
        this.outputNodes.PA.masterGain.connect(this.outputNodes.PA.streamDestination);
      }

      // Clear old audio nodes
      this.outputNodes[busType].sourceNodes.clear();
      this.outputNodes[busType].gainNodes.clear();

      // If PA context was recreated, update microphone engine
      if (busType === 'PA' && this.micEngine) {
        // console.log('[AutoTune] PA context recreated, updating microphone engine...');
        this.micEngine.updateAudioContext(this.audioContexts.PA, this.outputNodes.PA.masterGain);
        await this.micEngine.loadAutoTuneWorklet();

        // Restart microphone if it was enabled
        if (this.micEngine.enableMic) {
          await this.micEngine.startMicrophoneInput(this.micEngine.inputDevice);

          // Reapply saved mic gain and mute state
          const linearGain = this.mixerState.mic.muted
            ? 0
            : this.dbToLinear(this.mixerState.mic.gain);
          this.micEngine.setMicrophoneGain(linearGain);
        }
      }

      // Reload audio buffers for the new context (audio buffers are context-specific)
      if (this.songData) {
        await this.reloadAudioBuffersForBus(busType);
      }

      // Resume playback if it was playing
      if (wasPlaying && this.songData) {
        this.currentPosition = currentPos;
        await this.play();
      }

      return true;
    } catch (error) {
      console.error(`Failed to set ${busType} output device:`, error);
      return false;
    }
  }

  async loadSong(songData) {
    this.cdgMusicNode = null; // stems song replaces any CDG music-node registration

    this.songData = songData;

    // Reset position using base class method
    this.resetPosition();

    // Reset engine-specific timing state
    this.currentPosition = 0;
    this.startTime = 0;
    this.pauseTime = 0;
    this.monitoringStartTime = null;

    // Stop any existing song end monitoring
    this.stopSongEndMonitoring();

    // Keep stems array for tracking audio sources (for internal use only)
    // Routing is automatic: vocals → IEM (mono), instrumental → PA, mic → PA
    this.mixerState.stems = (songData.audio?.sources || []).map((source, index) => ({
      id: source.name || source.filename,
      name: source.name || source.filename,
      gain: source.gain || 0, // Per-source gain (still useful for balancing)
      index,
    }));

    await this.loadAudioBuffers(songData);

    // Clear any previous pitch reference data
    // Note: Pitch detection is now done in real-time from the vocal stem
    if (this.micEngine) {
      this.micEngine.clearPitchReference();
    }

    // Report song loaded to main process
    this.reportSongLoaded();

    // Report initial playback state with position reset to 0
    this.reportStateChange();

    return true;
  }

  /**
   * Note: reportStateChange(), startStateReporting(), and stopStateReporting()
   * are inherited from PlayerInterface base class
   */

  reportSongLoaded() {
    if (window.kaiAPI?.renderer && this.songData) {
      const duration = this.getDuration();
      window.kaiAPI.renderer.songLoaded({
        path: this.songData.originalFilePath || this.songData.filePath,
        title: this.songData.metadata?.title || 'Unknown',
        artist: this.songData.metadata?.artist || 'Unknown',
        duration: duration,
        isLoading: false, // Song is fully loaded
        format: 'kai',
      });

      // Report initial mixer state
      this.reportMixerState();
    }
  }

  reportMixerState() {
    if (window.kaiAPI?.renderer && this.mixerState) {
      window.kaiAPI.renderer.updateMixerState(this.mixerState);
    }
  }

  async loadAudioBuffers(songData) {
    if (!songData.audio?.sources) {
      console.warn('No audio sources found in song data');
      return;
    }

    if (!this.audioContexts.PA || !this.audioContexts.IEM) {
      await this.initialize();
    }

    for (const source of songData.audio.sources) {
      try {
        if (source.audioData && source.audioData.length > 0) {
          const arrayBuffer = source.audioData.buffer.slice(
            source.audioData.byteOffset,
            source.audioData.byteOffset + source.audioData.byteLength
          );

          // Sequential audio buffer decoding to avoid overwhelming WebAudio API
          // eslint-disable-next-line no-await-in-loop
          const decodedBuffer = await this.audioContexts.PA.decodeAudioData(arrayBuffer);
          this.audioBuffers.set(source.name, decodedBuffer);
        } else {
          console.warn(`No audio data for source: ${source.name}`);
        }
      } catch (error) {
        console.error(`Failed to decode audio for ${source.name}:`, error);
      }
    }

    // Calculate the actual duration from the longest audio buffer
    let maxDuration = 0;
    for (const [_name, buffer] of this.audioBuffers) {
      if (buffer.duration > maxDuration) {
        maxDuration = buffer.duration;
      }
    }

    // Update the song metadata with the actual duration
    if (maxDuration > 0) {
      if (!this.songData.metadata) {
        this.songData.metadata = {};
      }
      this.songData.metadata.duration = maxDuration;
    } else {
      console.warn('No audio buffers loaded, duration remains 0');
    }
  }

  async reloadAudioBuffersForBus(busType) {
    if (!this.songData?.audio?.sources || !this.audioContexts[busType]) {
      return;
    }

    // Audio buffers are shared between contexts, but we need to re-decode for new context
    // The existing buffers in this.audioBuffers should still work, but let's make sure
    // the new context has access to them by re-decoding if needed

    for (const source of this.songData.audio.sources) {
      if (source.audioData && source.audioData.length > 0) {
        try {
          // Check if we already have this buffer
          if (!this.audioBuffers.has(source.name)) {
            const arrayBuffer = source.audioData.buffer.slice(
              source.audioData.byteOffset,
              source.audioData.byteOffset + source.audioData.byteLength
            );

            // Sequential buffer decoding for new audio context to avoid WebAudio API errors
            // eslint-disable-next-line no-await-in-loop
            const decodedBuffer = await this.audioContexts[busType].decodeAudioData(arrayBuffer);
            this.audioBuffers.set(source.name, decodedBuffer);
          }
        } catch (error) {
          console.error(`Failed to reload audio buffer for ${busType} - ${source.name}:`, error);
        }
      }
    }
  }

  async play() {
    if (!this.songData) {
      console.error('No song loaded');
      return false;
    }

    if (!this.audioContexts.PA || !this.audioContexts.IEM) {
      console.error('Audio contexts not initialized');
      return false;
    }

    if (this.audioContexts.PA.state === 'suspended') {
      await this.audioContexts.PA.resume();
    }
    if (this.audioContexts.IEM.state === 'suspended') {
      await this.audioContexts.IEM.resume();
    }

    this.isPlaying = true;

    this.stopAllSources();
    this.createAudioGraph();
    this.startAudioSources();

    // Start song end monitoring
    this.startSongEndMonitoring();

    // Start state reporting
    this.startStateReporting();

    // Update microphone engine playing state
    if (this.micEngine) {
      this.micEngine.setPlaying(true);
    }

    // Report immediate state change
    this.reportStateChange();

    return true;
  }

  pause() {
    // Save current playback position BEFORE setting isPlaying to false
    // (getCurrentPosition uses isPlaying to calculate position)
    this.currentPosition = this.getCurrentPosition();

    this.isPlaying = false;

    if (this.audioContexts.PA) {
      this.pauseTime = this.audioContexts.PA.currentTime;
    }

    this.stopAllSources();

    // Stop song end monitoring
    this.stopSongEndMonitoring();

    // Stop state reporting
    this.stopStateReporting();

    // Update microphone engine playing state
    if (this.micEngine) {
      this.micEngine.setPlaying(false);
    }

    // Report immediate state change
    this.reportStateChange();

    return true;
  }

  seek(positionSec) {
    this.currentPosition = positionSec;

    if (this.isPlaying) {
      this.stopAllSources();
      this.startAudioSources();
    }

    // Report immediate state change
    this.reportStateChange();

    return true;
  }

  stopAllSources() {
    const _totalSources =
      this.outputNodes.PA.sourceNodes.size + this.outputNodes.IEM.sourceNodes.size;

    // Stop PA sources
    this.outputNodes.PA.sourceNodes.forEach((source, _index) => {
      try {
        source.stop();
        source.disconnect(); // Disconnect all connections
      } catch {
        // Source may already be stopped
      }
    });
    this.outputNodes.PA.sourceNodes.clear();

    // Stop IEM sources
    this.outputNodes.IEM.sourceNodes.forEach((source, _index) => {
      try {
        source.stop();
        source.disconnect(); // Disconnect all connections
      } catch {
        // Source may already be stopped
      }
    });
    this.outputNodes.IEM.sourceNodes.clear();
  }

  createAudioGraph() {
    if (!this.audioContexts.PA || !this.audioContexts.IEM) return;

    // Clear existing gain nodes for both outputs
    this.outputNodes.PA.gainNodes.clear();
    this.outputNodes.IEM.gainNodes.clear();

    this.mixerState.stems.forEach((stem) => {
      // Create gain node for PA output
      const paGainNode = this.audioContexts.PA.createGain();
      paGainNode.connect(this.outputNodes.PA.masterGain);
      this.outputNodes.PA.gainNodes.set(stem.name, paGainNode);

      // Create gain node for IEM output
      const iemGainNode = this.audioContexts.IEM.createGain();

      // For vocal stems, add mono conversion if enabled
      if (this.isVocalStem(stem.name) && this.mixerState.iemMonoVocals) {
        // Create channel merger to convert stereo to mono
        const channelMerger = this.audioContexts.IEM.createChannelMerger(1);
        iemGainNode.connect(channelMerger);
        channelMerger.connect(this.outputNodes.IEM.masterGain);
      } else {
        iemGainNode.connect(this.outputNodes.IEM.masterGain);
      }

      this.outputNodes.IEM.gainNodes.set(stem.name, iemGainNode);

      // Initialize BOTH nodes from the single effective-gain formula (the graph is
      // rebuilt on every play(), so this is the only init path — plan §11.2).
      this.applyStemNodeGain('PA', stem.name);
      this.applyStemNodeGain('IEM', stem.name);
    });
  }

  /**
   * Compute + apply the effective gain for one stem's node on one bus, from the
   * authored trim × the user's stemMix entry (× the backup:PA punchthrough overlay
   * for PA vocals). Ramped to avoid zipper noise; resilient to no-song / unknown
   * stem / mid-rebuild (state-only in those cases).
   */
  applyStemNodeGain(bus, stemName, rampSec = 0.03) {
    const ctx = this.audioContexts[bus];
    const gainNode = this.outputNodes[bus]?.gainNodes?.get(stemName);
    if (!ctx || !gainNode) return; // state-only; applied at next createAudioGraph()

    const stem = this.mixerState.stems.find((s) => s.name === stemName);
    const entry = resolveStemEntry(this.mixerState.stemMix, bus, stemName);
    const target = effectiveStemGain({
      fileTrimDb: stem?.gain || 0,
      userGain: entry.gain,
      muted: entry.muted,
      punchthroughActive: bus === 'PA' && this.vocalsPAEnabled && this.isVocalStem(stemName),
    });

    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(target, now + rampSec);
  }

  /**
   * Set a per-bus per-stem slider (0..1.5 linear, 1.0 = authored mix).
   * report=false when applying a control-plane value from main (no-echo loops).
   */
  setStemGain(bus, stemName, gain, report = true) {
    if (bus !== 'PA' && bus !== 'IEM') return false;
    if (!this.mixerState.stemMix[bus]) this.mixerState.stemMix[bus] = {};
    const entry = resolveStemEntry(this.mixerState.stemMix, bus, stemName);
    this.mixerState.stemMix[bus][stemName] = { ...entry, gain: clampStemGain(gain) };
    this.applyStemNodeGain(bus, stemName);
    if (bus === 'PA' && stemName === 'music') this.applyCdgMusicGain();
    if (report) this.reportMixerState();
    return true;
  }

  /** Mute/unmute one stem on one bus (independent of the slider value). */
  setStemMute(bus, stemName, muted, report = true) {
    if (bus !== 'PA' && bus !== 'IEM') return false;
    if (!this.mixerState.stemMix[bus]) this.mixerState.stemMix[bus] = {};
    const entry = resolveStemEntry(this.mixerState.stemMix, bus, stemName);
    this.mixerState.stemMix[bus][stemName] = { ...entry, muted: Boolean(muted) };
    this.applyStemNodeGain(bus, stemName);
    if (bus === 'PA' && stemName === 'music') this.applyCdgMusicGain();
    if (report) this.reportMixerState();
    return true;
  }

  getStemMix() {
    return this.mixerState.stemMix;
  }

  /**
   * CDG mode (§8): the loaded CDG song's single music gain node, driven by the PA
   * "music" strip through the same stemMix state (persists like any stem key).
   * Registered by the CDG loader; cleared when a stems song loads.
   */
  attachCdgMusicNode(gainNode) {
    this.cdgMusicNode = gainNode;
    this.applyCdgMusicGain(0); // initialize from the persisted entry, no ramp
  }

  applyCdgMusicGain(rampSec = 0.03) {
    if (!this.cdgMusicNode || !this.audioContexts.PA) return;
    const entry = resolveStemEntry(this.mixerState.stemMix, 'PA', 'music');
    const target = entry.muted ? 0 : entry.gain;
    const now = this.audioContexts.PA.currentTime;
    this.cdgMusicNode.gain.cancelScheduledValues(now);
    this.cdgMusicNode.gain.setValueAtTime(this.cdgMusicNode.gain.value, now);
    this.cdgMusicNode.gain.linearRampToValueAtTime(target, now + Math.max(rampSec, 0.001));
  }

  startAudioSources() {
    if (!this.audioContexts.PA || !this.audioContexts.IEM) return;

    // Schedule per context — each AudioContext has its own local clock, so a single
    // shared scheduleTime would bake in a skew equal to |PA.currentTime - IEM.currentTime|.
    const lead = 0.1;
    const paStart = this.audioContexts.PA.currentTime + lead;
    const iemStart = this.audioContexts.IEM.currentTime + lead;
    this.startTime = paStart; // getCurrentPosition() measures elapsed against PA's clock

    this.mixerState.stems.forEach((stem) => {
      // Skip mixdown stems - they contain the full mix and would overlap with individual stems
      if (this.isMixdownStem(stem.name)) {
        console.log(`⏭️  Skipping mixdown stem: ${stem.name}`);
        return;
      }

      const audioBuffer = this.audioBuffers.get(stem.name);
      const paGainNode = this.outputNodes.PA.gainNodes.get(stem.name);
      const iemGainNode = this.outputNodes.IEM.gainNodes.get(stem.name);

      if (audioBuffer && paGainNode && iemGainNode) {
        try {
          const offset = Math.min(this.currentPosition, audioBuffer.duration);
          const isVocals = this.isVocalStem(stem.name);

          // Stem×bus mixer (D4): EVERY stem gets an always-running source on BOTH
          // buses; audibility is entirely the per-bus gain nodes' business (muted
          // paths run at gain 0). Buffers are decoded once and shared, so the extra
          // sources are near-free — and mute/unmute becomes a click-free ramp
          // instead of a graph rebuild (the generalized backup:PA pattern).
          const paSource = this.audioContexts.PA.createBufferSource();
          paSource.buffer = audioBuffer;
          paSource.connect(paGainNode);

          // Butterchurn analyser taps the PA source PRE-gain: visuals react to the
          // full mix (now including vocals) even when stems are muted for the room.
          if (this.outputNodes.PA.analyser) {
            paSource.connect(this.outputNodes.PA.analyser);
          }

          // Auto-tune reference: vocal + melodic PA sources feed pitch detection,
          // pre-gain, so correction keeps working when the user mutes them on PA.
          if (this.micEngine && (isVocals || this.isMelodicStem(stem.name))) {
            this.micEngine.connectMusicSource(paSource);
          }

          paSource.start(paStart, offset);
          this.outputNodes.PA.sourceNodes.set(stem.name, paSource);

          // End detection keys off PA sources only — PA is the position-truth
          // clock; IEM device clocks can drift.
          paSource.onended = () => {
            if (this.isPlaying) {
              setTimeout(() => this.checkForSongEnd(), 10);
            }
          };

          const iemSource = this.audioContexts.IEM.createBufferSource();
          iemSource.buffer = audioBuffer;
          iemSource.connect(iemGainNode);
          iemSource.start(iemStart, offset);
          this.outputNodes.IEM.sourceNodes.set(stem.name, iemSource);
        } catch (error) {
          console.error(`Failed to start source for ${stem.name}:`, error);
        }
      } else {
        console.warn(`No audio buffer or gain nodes for stem: ${stem.name}`);
      }
    });

    // Debug PA output routing (disabled)
    // this.outputNodes.PA.gainNodes.forEach((gainNode, stemName) => {
    //     console.log('PA routing:', stemName, gainNode);
    // });
  }

  // Classification heuristics live in shared/utils/stemClassify.js (unit-tested,
  // shared with the mixer's runtime defaults); these wrappers keep the call sites.
  isVocalStem(stemName) {
    return isVocalStem(stemName);
  }

  isMixdownStem(stemName) {
    return isMixdownStem(stemName);
  }

  isMelodicStem(stemName) {
    return isMelodicStem(stemName);
  }

  // New simple mixer controls
  setMasterGain(bus, gainDb) {
    if (!['PA', 'IEM', 'mic'].includes(bus)) return false;

    this.mixerState[bus].gain = gainDb;

    // Apply to audio node
    if (bus === 'PA' && this.outputNodes.PA.masterGain) {
      const linearGain = this.dbToLinear(gainDb);
      this.outputNodes.PA.masterGain.gain.setValueAtTime(
        linearGain,
        this.audioContexts.PA.currentTime
      );
    } else if (bus === 'IEM' && this.outputNodes.IEM.masterGain) {
      const linearGain = this.dbToLinear(gainDb);
      this.outputNodes.IEM.masterGain.gain.setValueAtTime(
        linearGain,
        this.audioContexts.IEM.currentTime
      );
    } else if (bus === 'mic' && this.micEngine) {
      // Apply mic gain (considering mute state)
      const linearGain = this.mixerState.mic.muted ? 0 : this.dbToLinear(gainDb);
      this.micEngine.setMicrophoneGain(linearGain);
    }

    // Report to main process (which handles persistence via AppState)
    this.reportMixerState();
    return true;
  }

  toggleMasterMute(bus) {
    if (!['PA', 'IEM', 'mic'].includes(bus)) return false;

    this.mixerState[bus].muted = !this.mixerState[bus].muted;
    const muted = this.mixerState[bus].muted;

    // Apply mute (set gain to 0 or restore)
    if (bus === 'PA' && this.outputNodes.PA.masterGain) {
      const gain = muted ? 0 : this.dbToLinear(this.mixerState.PA.gain);
      this.outputNodes.PA.masterGain.gain.setValueAtTime(gain, this.audioContexts.PA.currentTime);
    } else if (bus === 'IEM' && this.outputNodes.IEM.masterGain) {
      const gain = muted ? 0 : this.dbToLinear(this.mixerState.IEM.gain);
      this.outputNodes.IEM.masterGain.gain.setValueAtTime(gain, this.audioContexts.IEM.currentTime);
    } else if (bus === 'mic' && this.micEngine) {
      const gain = muted ? 0 : this.dbToLinear(this.mixerState.mic.gain);
      this.micEngine.setMicrophoneGain(gain);
    }

    // Report to main process (which handles persistence via AppState)
    this.reportMixerState();
    return true;
  }

  setMasterMute(bus, muted) {
    if (!['PA', 'IEM', 'mic'].includes(bus)) return false;

    this.mixerState[bus].muted = muted;

    // Apply mute (set gain to 0 or restore)
    if (bus === 'PA' && this.outputNodes.PA.masterGain) {
      const gain = muted ? 0 : this.dbToLinear(this.mixerState.PA.gain);
      this.outputNodes.PA.masterGain.gain.setValueAtTime(gain, this.audioContexts.PA.currentTime);
    } else if (bus === 'IEM' && this.outputNodes.IEM.masterGain) {
      const gain = muted ? 0 : this.dbToLinear(this.mixerState.IEM.gain);
      this.outputNodes.IEM.masterGain.gain.setValueAtTime(gain, this.audioContexts.IEM.currentTime);
    } else if (bus === 'mic' && this.micEngine) {
      const gain = muted ? 0 : this.dbToLinear(this.mixerState.mic.gain);
      this.micEngine.setMicrophoneGain(gain);
    }

    // Don't report back to main - this was initiated by main/admin
    return true;
  }

  /**
   * backup:PA punchthrough (lyric lines tagged singer="backup:PA"). Rides the
   * ordinary PA vocals gain node via the mixer formula: while active, the node
   * targets max(user's PA-vocals level, authored level) — the line can only ADD
   * vocals, never fight the user (D2). User-muted vocals rise for the line and
   * fall back after; a user already at/above authored level hears no change.
   * @param {boolean} enabled - Whether the punchthrough overlay is active
   * @param {number} fadeTime - Ramp duration in seconds (default 50ms, no clicks)
   */
  setVocalsPAEnabled(enabled, fadeTime = 0.05) {
    if (this.vocalsPAEnabled === enabled) return;
    this.vocalsPAEnabled = enabled;

    // Recompute every vocal stem's PA node (multi-vocal-stem files: all of them).
    this.mixerState.stems.forEach((stem) => {
      if (this.isVocalStem(stem.name)) {
        this.applyStemNodeGain('PA', stem.name, fadeTime);
      }
    });
  }

  // Preset system removed - routing is now automatic with master faders
  // Vocals → IEM (mono), Instrumental → PA, Mic → PA

  getCurrentPosition() {
    if (this.isPlaying && this.audioContexts.PA && this.startTime > 0) {
      const elapsed = this.audioContexts.PA.currentTime - this.startTime;
      const calculatedPosition = this.currentPosition + elapsed;

      // Don't let position exceed song duration
      const duration = this.getDuration();
      const clampedPosition =
        duration > 0 ? Math.min(calculatedPosition, duration) : calculatedPosition;

      return clampedPosition;
    }
    return this.currentPosition;
  }

  getCurrentTime() {
    return this.getCurrentPosition();
  }

  getDuration() {
    return this.songData?.metadata?.duration || 0;
  }

  /**
   * Get the PA bus audio as a MediaStream, for piping into browser viewers via WebRTC.
   * Returns null if audio hasn't initialized yet.
   */
  getPAStream() {
    return this.outputNodes.PA.streamDestination?.stream ?? null;
  }

  getMixerState() {
    return {
      PA: this.mixerState.PA,
      IEM: this.mixerState.IEM,
      mic: this.mixerState.mic,
      stems: this.mixerState.stems, // For reference only
      isPlaying: this.isPlaying,
      position: this.getCurrentPosition(),
      duration: this.getDuration(),
    };
  }

  // Microphone/Auto-tune delegation methods (delegate to MicrophoneEngine)

  async startMicrophoneInput(deviceId = 'default') {
    if (this.micEngine) {
      await this.micEngine.startMicrophoneInput(deviceId);
    }
  }

  stopMicrophoneInput() {
    if (this.micEngine) {
      this.micEngine.stopMicrophoneInput();
    }
  }

  setAutoTuneSettings(settings) {
    if (this.micEngine) {
      this.micEngine.setAutoTuneSettings(settings);

      // Reapply gain after auto-tune enable/disable reconnects the audio chain
      if (this.micEngine.microphoneGain && Object.hasOwn(settings, 'enabled')) {
        const linearGain = this.mixerState.mic.muted
          ? 0
          : this.dbToLinear(this.mixerState.mic.gain);
        this.micEngine.setMicrophoneGain(linearGain);
      }
    }
  }

  setMicrophoneGain(gainValue) {
    if (this.micEngine) {
      this.micEngine.setMicrophoneGain(gainValue);
    }
  }

  setIEMMonoVocals(enabled) {
    this.mixerState.iemMonoVocals = enabled;

    // If playing, recreate audio graph to apply the change
    if (this.isPlaying) {
      this.stopAllSources();
      this.createAudioGraph();
      this.startAudioSources();
    } else {
      // Just recreate the graph for next playback
      this.createAudioGraph();
    }

    return true;
  }

  async loadMicSettings() {
    try {
      if (window.kaiAPI.settings && this.micEngine) {
        const micToSpeakers = await window.kaiAPI.settings.get('micToSpeakers', false);
        const enableMic = await window.kaiAPI.settings.get('enableMic', true);
        const iemMonoVocals = await window.kaiAPI.settings.get('iemMonoVocals', true);

        this.mixerState.micToSpeakers = micToSpeakers;
        this.mixerState.enableMic = enableMic;
        this.mixerState.iemMonoVocals = iemMonoVocals;

        // Load settings into microphone engine
        this.micEngine.micToSpeakers = micToSpeakers;
        this.micEngine.enableMic = enableMic;

        // Load auto-tune settings
        const autoTunePrefs = await window.kaiAPI.settings.get('autoTunePreferences', {});
        if (autoTunePrefs.enabled !== undefined) {
          this.micEngine.autotuneSettings.enabled = autoTunePrefs.enabled;
        }
        if (autoTunePrefs.strength !== undefined) {
          this.micEngine.autotuneSettings.strength = autoTunePrefs.strength;
        }
        if (autoTunePrefs.speed !== undefined) {
          this.micEngine.autotuneSettings.speed = autoTunePrefs.speed;
        }
        if (autoTunePrefs.preferVocals !== undefined) {
          this.micEngine.autotuneSettings.preferVocals = autoTunePrefs.preferVocals;
        }

        // console.log('[AutoTune] Loaded settings:', this.micEngine.autotuneSettings);

        // If auto-tune is enabled and mic is already running, apply it
        if (
          this.micEngine.autotuneSettings.enabled &&
          this.micEngine.microphoneGain &&
          this.micEngine.autoTuneWorkletsLoaded
        ) {
          // console.log('[AutoTune] Applying enabled auto-tune from saved settings');
          this.micEngine.enableAutoTune();

          // Reapply gain after auto-tune reconnects the audio chain
          const linearGain = this.mixerState.mic.muted
            ? 0
            : this.dbToLinear(this.mixerState.mic.gain);
          this.micEngine.setMicrophoneGain(linearGain);
        }
      }
    } catch (error) {
      console.error('Failed to load mic/autotune settings:', error);
    }
  }

  setMicToSpeakers(enabled) {
    this.mixerState.micToSpeakers = enabled;
    if (this.micEngine) {
      this.micEngine.setMicToSpeakers(enabled);

      // Reapply gain after mic routing changes reconnect the audio chain
      if (this.micEngine.microphoneGain) {
        const linearGain = this.mixerState.mic.muted
          ? 0
          : this.dbToLinear(this.mixerState.mic.gain);
        this.micEngine.setMicrophoneGain(linearGain);
      }
    }
  }

  async setEnableMic(enabled) {
    this.mixerState.enableMic = enabled;
    if (this.micEngine) {
      await this.micEngine.setEnableMic(enabled);

      // Reapply saved mic gain and mute state after mic restarts
      if (enabled && this.micEngine.microphoneGain) {
        const linearGain = this.mixerState.mic.muted
          ? 0
          : this.dbToLinear(this.mixerState.mic.gain);
        this.micEngine.setMicrophoneGain(linearGain);
      }
    }
  }

  stop() {
    this.isPlaying = false;
    this.stopAllSources();
    this.stopMicrophoneInput();
    this.stopSongEndMonitoring();

    if (this.audioContexts.PA) {
      this.audioContexts.PA.close();
      this.audioContexts.PA = null;
    }
    if (this.audioContexts.IEM) {
      this.audioContexts.IEM.close();
      this.audioContexts.IEM = null;
    }

    this.audioBuffers.clear();
    this.outputNodes.PA.gainNodes.clear();
    this.outputNodes.IEM.gainNodes.clear();
  }

  async reinitialize() {
    this.stop();

    // Wait for audio sources to fully stop and contexts to close
    await new Promise((resolve) => setTimeout(resolve, 200));

    await this.initialize();
  }

  setOnSongEndedCallback(callback) {
    this.onSongEndedCallback = callback;
  }

  // Check if song has ended based on position
  checkForSongEnd() {
    const duration = this.getDuration();
    const currentPos = this.getCurrentPosition();
    const timeSinceMonitoringStarted = this.monitoringStartTime
      ? this.audioContexts.PA.currentTime - this.monitoringStartTime
      : 0;

    // Only trigger if:
    // 1. We've been monitoring for at least 2 seconds (prevents seek issues)
    // 2. Song duration > 3 seconds
    // 3. Current position is near the end
    if (
      this.isPlaying &&
      timeSinceMonitoringStarted > 2.0 &&
      duration > 3 &&
      currentPos >= duration - 0.2
    ) {
      this.stopAllSources();
      this.stopSongEndMonitoring();

      // Pause to properly clean up (sets isPlaying = false, updates renderer, etc.)
      this.pause();

      // Use base class method for consistent song end handling (triggers callback)
      this._triggerSongEnd();
    }
  }

  // Start monitoring for song end
  startSongEndMonitoring() {
    if (this.songEndMonitor) {
      clearInterval(this.songEndMonitor);
    }

    // Track when monitoring actually started to prevent false positives
    this.monitoringStartTime = this.audioContexts.PA.currentTime;

    this.songEndMonitor = setInterval(() => {
      this.checkForSongEnd();
    }, 250); // Check every 250ms for more responsive detection
  }

  // Stop monitoring for song end
  stopSongEndMonitoring() {
    if (this.songEndMonitor) {
      clearInterval(this.songEndMonitor);
      this.songEndMonitor = null;
    }
  }

  // Utility: Convert dB to linear gain
  dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  // Utility: Convert linear gain to dB
  linearToDb(linear) {
    return 20 * Math.log10(linear);
  }

  /**
   * Get the format type this player handles
   * @returns {string} Format name
   */
  getFormat() {
    return 'kai';
  }
}

// Export removed - KAIPlayer is instantiated by KaiPlayerApp in main.js
// No longer attached to window global
