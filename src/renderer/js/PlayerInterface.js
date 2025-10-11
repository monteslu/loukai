/**
 * PlayerInterface - Abstract base class for all playback engines
 *
 * This interface ensures consistent behavior across different audio formats
 * (KAI, CDG, MP4, etc.) and eliminates code duplication for common features
 * like state reporting, playback control, and position tracking.
 */

/* global KAIPlayer, CDGPlayer, MoviePlayer */

export class PlayerInterface {
  constructor() {
    if (this.constructor === PlayerInterface) {
      throw new Error('PlayerInterface is abstract and cannot be instantiated directly');
    }

    // Common state
    this.isPlaying = false;
    this.stateReportInterval = null;
    this.onSongEndedCallback = null;
  }

  // ============================================================================
  // Abstract methods - MUST be implemented by subclasses
  // ============================================================================

  /**
   * Start or resume playback
   * @returns {Promise<boolean>} Success status
   */
  play() {
    return Promise.reject(new Error('play() must be implemented by subclass'));
  }

  /**
   * Pause playback
   * @returns {Promise<void>}
   */
  pause() {
    return Promise.reject(new Error('pause() must be implemented by subclass'));
  }

  /**
   * Seek to specific position in seconds
   * @param {number} _positionSec - Position in seconds
   * @returns {Promise<void>}
   */
  seek(_positionSec) {
    return Promise.reject(new Error('seek() must be implemented by subclass'));
  }

  /**
   * Get current playback position in seconds
   * @returns {number} Current position
   */
  getCurrentPosition() {
    throw new Error('getCurrentPosition() must be implemented by subclass');
  }

  /**
   * Get total duration in seconds
   * @returns {number} Duration
   */
  getDuration() {
    throw new Error('getDuration() must be implemented by subclass');
  }

  /**
   * Load song data
   * @param {Object} _songData - Song data to load
   * @returns {Promise<boolean>} Success status
   */
  loadSong(_songData) {
    return Promise.reject(new Error('loadSong() must be implemented by subclass'));
  }

  // ============================================================================
  // Common methods - Implemented once, used by all subclasses
  // ============================================================================

  /**
   * Report current playback state to main process via IPC
   * This is called periodically and on state changes
   */
  reportStateChange() {
    if (window.kaiAPI?.renderer) {
      const state = {
        isPlaying: this.isPlaying,
        position: this.getCurrentPosition(),
        duration: this.getDuration(),
      };
      window.kaiAPI.renderer.updatePlaybackState(state);
    }
  }

  /**
   * Start periodic state reporting (every 100ms)
   * Call this when playback starts
   */
  startStateReporting() {
    this.stopStateReporting();

    // Report state every 100ms (10x/sec)
    this.stateReportInterval = setInterval(() => {
      if (this.isPlaying) {
        this.reportStateChange();
      }
    }, 100);
  }

  /**
   * Stop periodic state reporting
   * Call this when playback stops/pauses
   */
  stopStateReporting() {
    if (this.stateReportInterval) {
      clearInterval(this.stateReportInterval);
      this.stateReportInterval = null;
    }
  }

  /**
   * Reset playback position to beginning
   * Call this when loading a new song to ensure clean state
   *
   * Subclasses should override this to reset their specific timing variables
   * and then call super.resetPosition()
   */
  resetPosition() {
    // Stop any ongoing playback
    if (this.isPlaying) {
      this.pause();
    }

    // Stop state reporting
    this.stopStateReporting();

    // Reset playing state
    this.isPlaying = false;

    // Subclasses should reset their own position tracking variables
    // (currentPosition, pauseTime, startTime, etc.)
  }

  /**
   * Set callback for when song finishes playing
   * @param {Function} callback - Called when song ends naturally (not from pause/stop)
   */
  onSongEnded(callback) {
    this.onSongEndedCallback = callback;
  }

  /**
   * Internal method called when song ends naturally
   * Subclasses should call this when playback completes
   */
  _triggerSongEnd() {
    this.stopStateReporting();
    this.isPlaying = false;

    if (this.onSongEndedCallback) {
      this.onSongEndedCallback();
    }
  }

  /**
   * Get the format type this player handles
   * @returns {string} Format name (e.g., 'kai', 'cdg', 'mp4')
   */
  getFormat() {
    throw new Error('getFormat() must be implemented by subclass');
  }

  /**
   * Cleanup resources before destroying the player
   * Override this if your player needs custom cleanup
   */
  destroy() {
    this.stopStateReporting();
    if (this.isPlaying) {
      this.pause();
    }
  }
}

/**
 * PlayerFactory - Creates the appropriate player instance based on format
 *
 * This factory pattern centralizes player instantiation and makes it easy
 * to add new formats without modifying calling code.
 */
export class PlayerFactory {
  /**
   * Create a player for the specified format
   * @param {string} format - Format type ('kai', 'cdg', 'mp4', etc.)
   * @param {Object} options - Format-specific options
   * @param {string} options.canvasId - Canvas element ID (for CDG/video formats)
   * @returns {PlayerInterface} Player instance
   * @throws {Error} If format is not supported
   */
  static create(format, options = {}) {
    switch (format.toLowerCase()) {
      case 'kai':
        if (typeof KAIPlayer === 'undefined') {
          throw new Error('KAIPlayer not loaded. Include kaiPlayer.js before using this format.');
        }
        return new KAIPlayer();

      case 'cdg':
        if (typeof CDGPlayer === 'undefined') {
          throw new Error('CDGPlayer not loaded. Include cdgPlayer.js before using this format.');
        }
        if (!options.canvasId) {
          throw new Error('CDGPlayer requires canvasId option');
        }
        return new CDGPlayer(options.canvasId);

      case 'mp4':
      case 'webm':
      case 'mkv':
      case 'video':
        if (typeof MoviePlayer === 'undefined') {
          throw new Error('MoviePlayer not loaded. Video format support not yet implemented.');
        }
        if (!options.videoElementId) {
          throw new Error('MoviePlayer requires videoElementId option');
        }
        return new MoviePlayer(options.videoElementId);

      default:
        throw new Error(`Unsupported format: ${format}. Supported formats: kai, cdg`);
    }
  }

  /**
   * Check if a format is supported
   * @param {string} format - Format type to check
   * @returns {boolean} True if format is supported
   */
  static isSupported(format) {
    const supported = ['kai', 'cdg'];

    // Check if MoviePlayer is available for video formats
    if (typeof MoviePlayer !== 'undefined') {
      supported.push('mp4', 'webm', 'mkv', 'video');
    }

    return supported.includes(format.toLowerCase());
  }

  /**
   * Get list of all supported formats
   * @returns {string[]} Array of supported format names
   */
  static getSupportedFormats() {
    const formats = ['kai', 'cdg'];

    if (typeof MoviePlayer !== 'undefined') {
      formats.push('mp4', 'webm', 'mkv');
    }

    return formats;
  }
}
