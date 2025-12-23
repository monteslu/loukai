/**
 * MicrophoneEngine - Shared microphone input and auto-tune processing
 *
 * This class handles all microphone-related functionality including:
 * - Audio worklet loading (pitch detection, pitch shifting, music analysis)
 * - Microphone input capture and routing
 * - Auto-tune enable/disable and settings
 * - Pitch tracking loop
 *
 * Used by both KAIPlayer and CDGPlayer to eliminate code duplication.
 */

import { ReferencePitchTracker } from './referencePitchTracker.js';

export class MicrophoneEngine {
  /**
   * @param {AudioContext} audioContext - Web Audio API context
   * @param {AudioNode} outputNode - Destination node for microphone audio
   * @param {Object} options - Configuration options
   * @param {Function} options.getCurrentPosition - Callback to get current playback position (for pitch tracking)
   */
  constructor(audioContext, outputNode, options = {}) {
    this.audioContext = audioContext;
    this.outputNode = outputNode;
    this.getCurrentPosition = options.getCurrentPosition || (() => 0);

    // Microphone input
    this.microphoneStream = null;
    this.microphoneSource = null;
    this.microphoneGain = null;
    this.inputDevice = 'default';

    // Auto-tune worklets
    this.micPitchDetectorNode = null;
    this.pitchShifterNode = null;
    this.pitchShifterMakeupGain = null; // Compensate for volume loss in pitch shifter
    this.compressor = null; // Dynamics compressor to prevent clipping
    this.musicAnalysisNode = null;
    this.autoTuneWorkletsLoaded = false;

    // Pitch tracking
    this.referencePitchTracker = new ReferencePitchTracker();
    this.pitchTrackingInterval = null;
    this.currentMicPitch = null;
    this.currentPitchShift = 0; // For speed smoothing

    // Settings
    this.autotuneSettings = {
      enabled: false,
      strength: 50, // 0-100
      speed: 20, // 1-100
      preferVocals: true,
    };

    this.micToSpeakers = true;
    this.enableMic = true;
  }

  /**
   * Load auto-tune audio worklets into the audio context
   */
  async loadAutoTuneWorklet() {
    try {
      if (!this.audioContext) {
        console.warn('[MicEngine] AudioContext not initialized');
        return;
      }

      // Ensure AudioContext is running (not suspended) before loading worklets
      if (this.audioContext.state === 'suspended') {
        // console.log('[MicEngine] Resuming suspended AudioContext before loading worklets');
        await this.audioContext.resume();
      }

      // console.log('[MicEngine] Loading worklet modules...');

      // Load mic pitch detector worklet
      await this.audioContext.audioWorklet.addModule('js/micPitchDetectorWorklet.js');

      // Load phase vocoder pitch shifter worklet (high-quality formant-preserving pitch shift)
      await this.audioContext.audioWorklet.addModule('js/phaseVocoderWorklet.js');

      // Load music analysis worklet (for pitch detection from music)
      await this.audioContext.audioWorklet.addModule('js/musicAnalysisWorklet.js');

      this.autoTuneWorkletsLoaded = true;
      // console.log('[MicEngine] ✅ Worklets loaded successfully (using phase vocoder)');
    } catch (error) {
      console.error('[MicEngine] ❌ Failed to load worklets:', error);
      this.autoTuneWorkletsLoaded = false;
    }
  }

  /**
   * Start microphone input
   * @param {string} deviceId - Microphone device ID
   */
  async startMicrophoneInput(deviceId = 'default') {
    try {
      // Don't start mic if disabled
      if (!this.enableMic) {
        return;
      }

      // Store device ID
      this.inputDevice = deviceId;

      // Stop existing microphone if running
      this.stopMicrophoneInput();

      const constraints = {
        audio: {
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
          channelCount: 1,
          sampleRate: 44100,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      // Get microphone stream
      this.microphoneStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Create audio source from microphone
      this.microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream);

      // Create gain node for microphone volume control
      this.microphoneGain = this.audioContext.createGain();
      this.microphoneGain.gain.value = 1.0; // Full volume, can be adjusted

      // Connect microphone to gain node
      this.microphoneSource.connect(this.microphoneGain);

      // Only route to speakers if micToSpeakers is enabled
      if (this.micToSpeakers) {
        // If auto-tune is available and enabled, route through it
        if (this.autoTuneWorkletsLoaded && this.autotuneSettings.enabled) {
          this.enableAutoTune();
        } else {
          // Direct connection to output
          this.microphoneGain.connect(this.outputNode);
        }
      } else {
        // Mic not routed to speakers - captured but silent
      }
    } catch (error) {
      console.error('[MicEngine] Failed to start microphone input:', error);
      this.stopMicrophoneInput();
    }
  }

  /**
   * Enable auto-tune processing
   */
  enableAutoTune() {
    try {
      if (!this.autoTuneWorkletsLoaded || !this.microphoneGain) {
        console.log(
          '[MicEngine] ❌ Cannot enable - worklets loaded:',
          this.autoTuneWorkletsLoaded,
          'mic exists:',
          Boolean(this.microphoneGain)
        );
        return;
      }

      // console.log('[MicEngine] Enabling auto-tune...');

      // Disconnect current mic connections
      this.microphoneGain.disconnect();

      // Create mic pitch detector node if it doesn't exist
      if (!this.micPitchDetectorNode) {
        // console.log('[MicEngine] Creating mic pitch detector node');
        this.micPitchDetectorNode = new AudioWorkletNode(this.audioContext, 'mic-pitch-detector');

        // Listen for pitch detection results
        this.micPitchDetectorNode.port.onmessage = (event) => {
          if (event.data.type === 'pitch') {
            this.currentMicPitch = event.data.frequency;
          }
        };
      }

      // Create pitch shifter node if it doesn't exist
      if (!this.pitchShifterNode) {
        // console.log('[MicEngine] Creating phase vocoder pitch shifter node');
        this.pitchShifterNode = new AudioWorkletNode(this.audioContext, 'phase-vocoder-processor');

        // Send sample rate to worklet
        this.pitchShifterNode.port.postMessage({
          type: 'setSampleRate',
          value: this.audioContext.sampleRate,
        });

        // Initialize pitch shift to 0 (no change)
        if (this.pitchShifterNode.parameters) {
          this.pitchShifterNode.parameters.get('pitchSemitones').value = 0;
          // console.log('[MicEngine] Initialized phase vocoder pitch shift to 0 semitones');
        }
      }

      // Create makeup gain node (phase vocoder preserves volume better than SoundTouch)
      if (!this.pitchShifterMakeupGain) {
        // console.log('[MicEngine] Creating makeup gain node');
        this.pitchShifterMakeupGain = this.audioContext.createGain();
        // Phase vocoder preserves volume well, only need slight boost
        this.pitchShifterMakeupGain.gain.value = 1.2;
        console.log(
          '[MicEngine] Set makeup gain to 1.2x (phase vocoder has better volume preservation)'
        );
      }

      // Create dynamics compressor to prevent clipping and smooth out peaks
      if (!this.compressor) {
        // console.log('[MicEngine] Creating dynamics compressor');
        this.compressor = this.audioContext.createDynamicsCompressor();
        // Gentle compression to catch peaks without squashing dynamics
        this.compressor.threshold.value = -24; // dB
        this.compressor.knee.value = 12; // dB (soft knee for natural sound)
        this.compressor.ratio.value = 3; // 3:1 compression ratio
        this.compressor.attack.value = 0.003; // 3ms attack (fast enough to catch transients)
        this.compressor.release.value = 0.1; // 100ms release (natural envelope)
        // console.log('[MicEngine] Compressor configured for smooth auto-tune output');
      }

      // Create music analysis node for pitch detection from music (fallback)
      if (!this.musicAnalysisNode) {
        // console.log('[MicEngine] Creating music analysis node');
        this.musicAnalysisNode = new AudioWorkletNode(
          this.audioContext,
          'music-analysis-processor'
        );

        // Enable pitch detection in music analysis
        this.musicAnalysisNode.port.postMessage({
          type: 'setSampleRate',
          value: this.audioContext.sampleRate,
        });
        this.musicAnalysisNode.port.postMessage({
          type: 'enablePitchDetection',
          value: true,
        });

        // Listen for music pitch detection
        this.musicAnalysisNode.port.onmessage = (event) => {
          if (event.data.type === 'analysis' && event.data.data.pitch) {
            // Feed music pitch to reference tracker (used when preferVocals is false)
            this.referencePitchTracker.updateMusicPitch(
              event.data.data.pitch,
              this.getCurrentPosition()
            );
          }
        };
      }

      // Chain: mic → pitch detector → phase vocoder → makeup gain → compressor → output
      console.log(
        '[MicEngine] Connecting audio chain: mic → detector → phase vocoder → makeup → compressor → output'
      );
      this.microphoneGain.connect(this.micPitchDetectorNode);
      this.micPitchDetectorNode.connect(this.pitchShifterNode);
      this.pitchShifterNode.connect(this.pitchShifterMakeupGain);
      this.pitchShifterMakeupGain.connect(this.compressor);
      this.compressor.connect(this.outputNode);

      // Enable reference pitch tracking
      this.referencePitchTracker.setEnabled(true);
      this.referencePitchTracker.setPreferVocals(this.autotuneSettings.preferVocals);

      // Start pitch tracking loop
      this.startPitchTracking();

      console.log(
        '[MicEngine] ✅ Auto-tune enabled with phase vocoder (formant-preserving pitch shift)'
      );
    } catch (error) {
      console.error('[MicEngine] ❌ Failed to enable auto-tune:', error);
      console.error('[MicEngine] Error name:', error.name);
      console.error('[MicEngine] Error message:', error.message);
      console.error('[MicEngine] Error stack:', error.stack);

      // Try to restore direct connection on error
      try {
        if (this.microphoneGain) {
          this.microphoneGain.disconnect();
          if (this.micToSpeakers) {
            this.microphoneGain.connect(this.outputNode);
            // console.log('[MicEngine] Restored direct mic connection after error');
          }
        }
      } catch (restoreError) {
        console.error('[MicEngine] Failed to restore mic connection:', restoreError.message);
      }
    }
  }

  /**
   * Disable auto-tune processing
   */
  disableAutoTune() {
    try {
      if (!this.microphoneGain) return;

      // console.log('[MicEngine] Disabling auto-tune');

      // Stop pitch tracking
      this.stopPitchTracking();
      this.referencePitchTracker.setEnabled(false);

      // Disconnect worklet chain
      this.microphoneGain.disconnect();
      if (this.micPitchDetectorNode) {
        this.micPitchDetectorNode.disconnect();
      }
      if (this.pitchShifterNode) {
        this.pitchShifterNode.disconnect();
      }
      if (this.pitchShifterMakeupGain) {
        this.pitchShifterMakeupGain.disconnect();
      }
      if (this.compressor) {
        this.compressor.disconnect();
      }
      if (this.musicAnalysisNode) {
        this.musicAnalysisNode.disconnect();
      }

      // Only reconnect if mic routing is enabled
      if (this.micToSpeakers) {
        // Direct connection to output
        this.microphoneGain.connect(this.outputNode);
      } else {
        // Mic disabled - stay disconnected
      }
    } catch (error) {
      console.error('[MicEngine] Failed to disable auto-tune:', error);
    }
  }

  /**
   * Update auto-tune settings
   * @param {Object} settings - Auto-tune settings to update
   */
  setAutoTuneSettings(settings) {
    this.autotuneSettings = { ...this.autotuneSettings, ...settings };

    // Handle enable/disable
    if (Object.hasOwn(settings, 'enabled')) {
      if (settings.enabled) {
        this.enableAutoTune();
      } else {
        this.disableAutoTune();
      }
    }

    // Handle preferVocals change
    if (Object.hasOwn(settings, 'preferVocals')) {
      this.referencePitchTracker.setPreferVocals(settings.preferVocals);
    }

    // Note: strength and speed affect pitch shift amount which is calculated
    // in the pitch tracking loop, not stored in the worklet
    // The worklet just performs the pitch shift we tell it to

    // If auto-tune should be enabled but isn't running, enable it
    if (settings.enabled && this.microphoneGain && !this.pitchShifterNode) {
      this.enableAutoTune();
    }
  }

  /**
   * Stop microphone input and cleanup
   */
  stopMicrophoneInput() {
    // Stop pitch tracking
    this.stopPitchTracking();

    if (this.microphoneSource) {
      this.microphoneSource.disconnect();
      this.microphoneSource = null;
    }

    if (this.microphoneGain) {
      this.microphoneGain.disconnect();
      this.microphoneGain = null;
    }

    if (this.micPitchDetectorNode) {
      this.micPitchDetectorNode.disconnect();
      this.micPitchDetectorNode = null;
    }

    if (this.pitchShifterNode) {
      this.pitchShifterNode.disconnect();
      this.pitchShifterNode = null;
    }

    if (this.pitchShifterMakeupGain) {
      this.pitchShifterMakeupGain.disconnect();
      this.pitchShifterMakeupGain = null;
    }

    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }

    if (this.musicAnalysisNode) {
      this.musicAnalysisNode.disconnect();
      this.musicAnalysisNode = null;
    }

    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((track) => track.stop());
      this.microphoneStream = null;
    }
  }

  /**
   * Set microphone gain/volume
   * @param {number} gainValue - Linear gain value (0.0 to 1.0+)
   */
  setMicrophoneGain(gainValue) {
    if (this.microphoneGain) {
      this.microphoneGain.gain.value = gainValue;
    }
  }

  /**
   * Enable or disable microphone routing to speakers
   * @param {boolean} enabled - Whether to route mic to speakers
   */
  setMicToSpeakers(enabled) {
    this.micToSpeakers = enabled;

    // Update routing if mic is currently active
    if (this.microphoneGain) {
      this.microphoneGain.disconnect();

      if (enabled) {
        // Reconnect to speakers
        if (this.autoTuneWorkletsLoaded && this.autotuneSettings.enabled) {
          this.enableAutoTune();
        } else {
          this.microphoneGain.connect(this.outputNode);
        }
      }
      // If disabled, mic stays disconnected (captured but not routed)
    }
  }

  /**
   * Enable or disable microphone input entirely
   * @param {boolean} enabled - Whether to enable microphone
   */
  async setEnableMic(enabled) {
    this.enableMic = enabled;

    if (enabled) {
      // Restart mic with saved device preference
      await this.startMicrophoneInput(this.inputDevice);
    } else {
      // Stop mic completely
      this.stopMicrophoneInput();
    }
  }

  /**
   * Start pitch tracking loop for auto-tune
   */
  startPitchTracking() {
    // Stop existing tracking first
    this.stopPitchTracking();

    if (!this.autotuneSettings.enabled || !this.pitchShifterNode) {
      console.log(
        '[MicEngine] Cannot start pitch tracking - enabled:',
        this.autotuneSettings.enabled,
        'shifter exists:',
        Boolean(this.pitchShifterNode)
      );
      return;
    }

    // console.log('[MicEngine] Starting pitch tracking loop (20Hz)');

    // Update pitch tracking at ~20Hz (every 50ms)
    this.pitchTrackingInterval = setInterval(() => {
      // Update playback time in reference tracker
      const currentTime = this.getCurrentPosition();
      this.referencePitchTracker.updateTime(currentTime);

      // Get target pitch from reference (vocals_f0 or music)
      const targetPitch = this.referencePitchTracker.getCurrentTargetPitch();

      // Get current mic pitch
      const micPitch = this.currentMicPitch;

      // Calculate pitch correction
      if (targetPitch && micPitch && micPitch > 0) {
        // DEBUG: Log pitch values every 2 seconds
        if (!this._lastDebugLog || Date.now() - this._lastDebugLog > 2000) {
          console.log('[AutoTune Debug]', {
            targetPitch: targetPitch.toFixed(2) + 'Hz',
            micPitch: micPitch.toFixed(2) + 'Hz',
            source: this.referencePitchTracker.getCurrentSource(),
            preferVocals: this.autotuneSettings.preferVocals,
          });
          this._lastDebugLog = Date.now();
        }

        // Calculate semitones difference
        let semitones = 12 * Math.log2(targetPitch / micPitch);

        // Octave correction: snap to nearest octave within ±12 semitones
        // This prevents extreme pitch shifts when octave detection errors occur
        // Example: +26 semitones becomes +2 semitones (subtract 24 = 2 octaves)
        while (semitones > 12) {
          semitones -= 12;
        }
        while (semitones < -12) {
          semitones += 12;
        }

        // Safety clamp to valid range [-24, +24] (should rarely be needed after octave correction)
        semitones = Math.max(-24, Math.min(24, semitones));

        // DEBUG: Log correction being applied
        if (!this._lastCorrectionLog || Date.now() - this._lastCorrectionLog > 2000) {
          console.log('[AutoTune Correction]', {
            semitones: semitones.toFixed(2),
            strength: this.autotuneSettings.strength + '%',
            targetShift: (semitones * (this.autotuneSettings.strength / 100)).toFixed(2),
            currentShift: this.currentPitchShift.toFixed(2),
          });
          this._lastCorrectionLog = Date.now();
        }

        // Apply strength (0-100 -> 0-1)
        const strength = this.autotuneSettings.strength / 100;
        const targetShift = semitones * strength;

        // Apply speed/smoothing (1-100 -> 0.01-1.0)
        // Low speed = slow/gradual = natural sound
        // High speed = fast/instant = robotic effect
        const speed = this.autotuneSettings.speed / 100;
        this.currentPitchShift = this.currentPitchShift * (1 - speed) + targetShift * speed;

        // Final clamp for smoothed output (prevents accumulated errors)
        this.currentPitchShift = Math.max(-24, Math.min(24, this.currentPitchShift));

        // Set pitch shift on the worklet
        if (this.pitchShifterNode.parameters) {
          this.pitchShifterNode.parameters.get('pitchSemitones').value = this.currentPitchShift;
        }
      } else {
        // No correction needed - keep pitch shift at 0 (pass-through)
        // This allows mic audio to pass through unmodified when no target pitch
        if (this.pitchShifterNode.parameters) {
          this.pitchShifterNode.parameters.get('pitchSemitones').value = 0;
        }
        this.currentPitchShift = 0;
      }
    }, 50); // 20Hz update rate
  }

  /**
   * Stop pitch tracking loop
   */
  stopPitchTracking() {
    if (this.pitchTrackingInterval) {
      clearInterval(this.pitchTrackingInterval);
      this.pitchTrackingInterval = null;
      // console.log('[MicEngine] Stopped pitch tracking loop');
    }
  }

  /**
   * Legacy method - stored pitch data is no longer used
   * Pitch detection is now done in real-time from the vocal stem
   * @deprecated
   */
  loadVocalsF0() {
    // No-op - pitch detection is now done at runtime
  }

  /**
   * Clear pitch reference data (resets real-time tracking state)
   */
  clearPitchReference() {
    this.referencePitchTracker.clear();
  }

  /**
   * Set whether playback is active (for pitch tracking)
   * @param {boolean} playing - Whether audio is playing
   */
  setPlaying(playing) {
    this.referencePitchTracker.setPlaying(playing);

    // Only start pitch tracking if auto-tune is enabled
    if (playing && this.autotuneSettings.enabled) {
      this.startPitchTracking();
    } else {
      this.stopPitchTracking();
    }
  }

  /**
   * Connect a music source to the music analysis node for pitch detection
   * @param {AudioNode} sourceNode - Audio source node to analyze
   */
  connectMusicSource(sourceNode) {
    if (this.musicAnalysisNode && sourceNode) {
      try {
        sourceNode.connect(this.musicAnalysisNode);
        // console.log('[MicEngine] Connected music source to pitch analysis');
      } catch (error) {
        console.error('[MicEngine] Failed to connect music source:', error);
      }
    }
  }

  /**
   * Disconnect music source from analysis
   * @param {AudioNode} sourceNode - Audio source node to disconnect
   */
  disconnectMusicSource(sourceNode) {
    if (this.musicAnalysisNode && sourceNode) {
      try {
        sourceNode.disconnect(this.musicAnalysisNode);
      } catch {
        // May not be connected, that's okay
      }
    }
  }

  /**
   * Update the audio context and output node (e.g., when contexts are recreated)
   * @param {AudioContext} audioContext - New audio context
   * @param {AudioNode} outputNode - New output node
   */
  updateAudioContext(audioContext, outputNode) {
    // Stop everything first
    this.stopMicrophoneInput();

    // Update references
    this.audioContext = audioContext;
    this.outputNode = outputNode;

    // Reset worklet loaded flag (worklets are lost when context is recreated)
    this.autoTuneWorkletsLoaded = false;
  }
}
