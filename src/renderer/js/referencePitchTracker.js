/**
 * Reference Pitch Tracker
 * Manages real-time pitch reference from vocal stem analysis
 * Provides target pitch for auto-tune correction and scoring
 *
 * Note: Pitch detection is now done at runtime from the vocal stem audio,
 * not from stored data. This simplifies the file format and provides
 * consistent behavior across all songs.
 */

export class ReferencePitchTracker {
  constructor() {
    // Real-time vocal pitch detection
    this.vocalPitch = null;
    this.vocalPitchTimestamp = 0;

    // Settings
    this.enabled = false;

    // Playback state
    this.currentTime = 0;
    this.isPlaying = false;
  }

  /**
   * Clear all reference data (when song unloads)
   */
  clear() {
    this.vocalPitch = null;
    this.vocalPitchTimestamp = 0;
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
   * Update vocal pitch from real-time detection
   * Called by the vocal stem pitch detection worklet
   * @param {number} frequency - Detected frequency in Hz
   * @param {number} timestamp - Detection timestamp (playback time)
   */
  updateVocalPitch(frequency, timestamp) {
    this.vocalPitch = frequency;
    this.vocalPitchTimestamp = timestamp;
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

    return this.getVocalPitch();
  }

  /**
   * Get pitch from real-time vocal analysis
   * @returns {number|null} - Frequency in Hz or null
   * @private
   */
  getVocalPitch() {
    // Vocal pitch should be relatively recent (within 100ms)
    const maxAge = 0.1; // 100ms
    const age = this.currentTime - this.vocalPitchTimestamp;

    if (this.vocalPitch && this.vocalPitch > 0 && age < maxAge) {
      return this.vocalPitch;
    }

    return null;
  }

  /**
   * Get current reference source
   * @returns {string} - 'vocals' or 'none'
   */
  getCurrentSource() {
    if (!this.enabled || !this.isPlaying) {
      return 'none';
    }

    if (this.getVocalPitch() !== null) {
      return 'vocals';
    }

    return 'none';
  }

  // Legacy methods for backward compatibility (no-ops)
  loadVocalsF0() {
    console.log(
      '[ReferencePitchTracker] Stored pitch data no longer used - using real-time detection'
    );
  }

  setPreferVocals() {
    // No-op - always uses real-time vocal detection
  }

  updateMusicPitch(frequency, timestamp) {
    // Alias for updateVocalPitch for backward compatibility
    this.updateVocalPitch(frequency, timestamp);
  }
}
