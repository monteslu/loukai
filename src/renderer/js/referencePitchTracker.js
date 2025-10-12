/**
 * Reference Pitch Tracker
 * Manages pitch reference data from vocals_f0 (KAI files) or music analysis
 * Provides target pitch for auto-tune correction
 */

export class ReferencePitchTracker {
  constructor() {
    // Vocals F0 data from KAI file
    this.vocalsF0 = null;
    this.vocalsF0Index = 0;
    this.vocalsF0SampleRate = 25; // Default 25Hz (for MIDI+cents format)
    this.vocalsF0Format = null; // 'midi_cents' or 'raw_hz'

    // Music pitch detection (fallback)
    this.musicPitch = null;
    this.musicPitchTimestamp = 0;

    // Settings
    this.preferVocals = true;
    this.enabled = false;

    // Playback state
    this.currentTime = 0;
    this.isPlaying = false;
  }

  /**
   * Load vocal_pitch data from KAI file features (MIDI+cents format)
   * @param {Object} features - Features object from KAI file
   */
  loadVocalsF0(features) {
    // Prefer vocal_pitch (MIDI+cents) over raw vocalsF0 (Hz)
    if (features && features.vocalPitch) {
      const vocalPitch = features.vocalPitch;
      this.vocalsF0 = vocalPitch.quant_data || null;
      this.vocalsF0Index = 0;
      this.vocalsF0SampleRate = vocalPitch.sample_rate_hz || 25; // Default 25Hz
      this.vocalsF0Format = vocalPitch.quantization_type || 'midi_cents';

      // DEBUG: Show sample data
      const firstNonZero = this.vocalsF0?.find((v) => Array.isArray(v) && v[0] > 0);
      console.log('[ReferencePitchTracker] Loaded vocal_pitch data:', {
        format: this.vocalsF0Format,
        sampleRate: this.vocalsF0SampleRate + 'Hz',
        points: this.vocalsF0?.length || 0,
        firstNonZero: firstNonZero,
        sampleValues: this.vocalsF0?.slice(0, 5),
      });
    } else if (features && features.vocalsF0) {
      // Fallback to raw Hz data (legacy)
      this.vocalsF0 = features.vocalsF0;
      this.vocalsF0Index = 0;
      this.vocalsF0SampleRate = 100; // Assume 10ms intervals
      this.vocalsF0Format = 'raw_hz';

      console.log('[ReferencePitchTracker] Loaded raw vocals_f0 data (legacy):', {
        format: this.vocalsF0Format,
        points: this.vocalsF0.length,
      });
    } else {
      this.vocalsF0 = null;
      this.vocalsF0Format = null;
      console.log('[ReferencePitchTracker] No vocal pitch data available');
    }
  }

  /**
   * Clear all reference data (when song unloads)
   */
  clear() {
    this.vocalsF0 = null;
    this.vocalsF0Index = 0;
    this.musicPitch = null;
    this.musicPitchTimestamp = 0;
    this.currentTime = 0;
    this.isPlaying = false;
  }

  /**
   * Update current playback time
   * @param {number} time - Current playback time in seconds
   */
  updateTime(time) {
    this.currentTime = time;
  }

  /**
   * Set playback state
   * @param {boolean} playing - Whether playback is active
   */
  setPlaying(playing) {
    this.isPlaying = playing;
  }

  /**
   * Update music pitch from real-time detection
   * @param {number} frequency - Detected frequency in Hz
   * @param {number} timestamp - Detection timestamp
   */
  updateMusicPitch(frequency, timestamp) {
    this.musicPitch = frequency;
    this.musicPitchTimestamp = timestamp;
  }

  /**
   * Set whether to prefer vocals over music for pitch reference
   * @param {boolean} prefer - True to use vocals_f0 when available
   */
  setPreferVocals(prefer) {
    this.preferVocals = prefer;
  }

  /**
   * Enable/disable pitch tracking
   * @param {boolean} enabled - Whether tracking is enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Get target pitch at current playback time
   * @returns {number|null} - Target frequency in Hz, or null if none available
   */
  getCurrentTargetPitch() {
    if (!this.enabled || !this.isPlaying) {
      return null;
    }

    // Prefer vocals_f0 if available and preferred
    if (this.preferVocals && this.vocalsF0 && this.vocalsF0.length > 0) {
      return this.getVocalsF0Pitch();
    }

    // Fall back to music pitch
    return this.getMusicPitch();
  }

  /**
   * Get pitch from vocals_f0 data at current time
   * @returns {number|null} - Frequency in Hz or null
   * @private
   */
  getVocalsF0Pitch() {
    if (!this.vocalsF0 || this.vocalsF0.length === 0) {
      return null;
    }

    // MIDI+cents format (default): [[midi_note, cents], ...]
    if (this.vocalsF0Format === 'midi_cents') {
      // Fixed sample rate (default 25Hz = 40ms per sample)
      const hopTime = 1.0 / this.vocalsF0SampleRate;
      const index = Math.floor(this.currentTime / hopTime);

      if (index >= 0 && index < this.vocalsF0.length) {
        const entry = this.vocalsF0[index];
        if (!Array.isArray(entry) || entry.length < 2) {
          return null;
        }

        const [midiNote, cents] = entry;

        // MIDI note 0 = silence
        if (midiNote === 0) {
          return null;
        }

        // Convert MIDI+cents to Hz
        // Hz = 440 * 2^((midi + cents/100 - 69) / 12)
        const midiFloat = midiNote + cents / 100;
        const freq = 440 * Math.pow(2, (midiFloat - 69) / 12);

        return freq > 0 && !isNaN(freq) ? freq : null;
      }
      return null;
    }

    // Raw Hz format (legacy): simple array or object format
    if (typeof this.vocalsF0[0] === 'number') {
      // Simple array format: assume fixed interval (e.g., 10ms)
      const hopTime = 1.0 / this.vocalsF0SampleRate;
      const index = Math.floor(this.currentTime / hopTime);
      if (index >= 0 && index < this.vocalsF0.length) {
        const freq = this.vocalsF0[index];
        return freq > 0 && !isNaN(freq) ? freq : null;
      }
      return null;
    }

    // Object format: { time, frequency } or { time, f0 }
    // Use binary search for efficiency
    let left = 0;
    let right = this.vocalsF0.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.vocalsF0[mid];
      const entryTime = entry.time || entry.timestamp || 0;

      if (entryTime < this.currentTime) {
        left = mid + 1;
      } else if (entryTime > this.currentTime) {
        right = mid - 1;
      } else {
        // Exact match
        const freq = entry.frequency || entry.f0 || 0;
        return freq > 0 && !isNaN(freq) ? freq : null;
      }
    }

    // No exact match - use closest point (no interpolation for pitch)
    const closestIndex = right >= 0 ? right : left;
    if (closestIndex >= 0 && closestIndex < this.vocalsF0.length) {
      const entry = this.vocalsF0[closestIndex];
      const freq = entry.frequency || entry.f0 || 0;
      return freq > 0 && !isNaN(freq) ? freq : null;
    }

    return null;
  }

  /**
   * Get pitch from music analysis
   * @returns {number|null} - Frequency in Hz or null
   * @private
   */
  getMusicPitch() {
    // Music pitch should be relatively recent (within 100ms)
    const maxAge = 0.1; // 100ms
    const age = this.currentTime - this.musicPitchTimestamp;

    if (this.musicPitch && age < maxAge) {
      return this.musicPitch;
    }

    return null;
  }

  /**
   * Get current reference source
   * @returns {string} - 'vocals', 'music', or 'none'
   */
  getCurrentSource() {
    if (!this.enabled || !this.isPlaying) {
      return 'none';
    }

    if (this.preferVocals && this.vocalsF0 && this.getVocalsF0Pitch() !== null) {
      return 'vocals';
    }

    if (this.getMusicPitch() !== null) {
      return 'music';
    }

    return 'none';
  }
}
