/**
 * BridgeInterface - Abstract base class for platform-specific communication
 *
 * This defines the contract that both ElectronBridge and WebBridge must implement.
 * Components use this interface and don't care about the underlying transport.
 *
 * Platform-specific implementations:
 * - ElectronBridge: Uses window.kaiAPI (IPC to main process)
 * - WebBridge: Uses fetch() and Socket.IO (REST + WebSocket)
 */

export class BridgeInterface {
  // ===== Player Controls =====

  play() {
    return Promise.reject(new Error('play() not implemented'));
  }

  pause() {
    return Promise.reject(new Error('pause() not implemented'));
  }

  restart() {
    return Promise.reject(new Error('restart() not implemented'));
  }

  seek(_positionSec) {
    return Promise.reject(new Error('seek() not implemented'));
  }

  getPlaybackState() {
    return Promise.reject(new Error('getPlaybackState() not implemented'));
  }

  // ===== Queue Management =====

  getQueue() {
    return Promise.reject(new Error('getQueue() not implemented'));
  }

  addToQueue(_song) {
    return Promise.reject(new Error('addToQueue() not implemented'));
  }

  removeFromQueue(_id) {
    return Promise.reject(new Error('removeFromQueue() not implemented'));
  }

  clearQueue() {
    return Promise.reject(new Error('clearQueue() not implemented'));
  }

  reorderQueue(_fromIndex, _toIndex) {
    return Promise.reject(new Error('reorderQueue() not implemented'));
  }

  playNext() {
    return Promise.reject(new Error('playNext() not implemented'));
  }

  // ===== Mixer Controls =====

  getMixerState() {
    return Promise.reject(new Error('getMixerState() not implemented'));
  }

  setMasterGain(_bus, _gainDb) {
    return Promise.reject(new Error('setMasterGain() not implemented'));
  }

  toggleMasterMute(_bus) {
    return Promise.reject(new Error('toggleMasterMute() not implemented'));
  }

  setMasterMute(_bus, _muted) {
    return Promise.reject(new Error('setMasterMute() not implemented'));
  }

  // ===== Effects Controls =====

  getEffects() {
    return Promise.reject(new Error('getEffects() not implemented'));
  }

  selectEffect(_effectName) {
    return Promise.reject(new Error('selectEffect() not implemented'));
  }

  toggleEffect(_effectName, _enabled) {
    return Promise.reject(new Error('toggleEffect() not implemented'));
  }

  nextEffect() {
    return Promise.reject(new Error('nextEffect() not implemented'));
  }

  previousEffect() {
    return Promise.reject(new Error('previousEffect() not implemented'));
  }

  randomEffect() {
    return Promise.reject(new Error('randomEffect() not implemented'));
  }

  // ===== Library Management =====

  getLibrary() {
    return Promise.reject(new Error('getLibrary() not implemented'));
  }

  scanLibrary() {
    return Promise.reject(new Error('scanLibrary() not implemented'));
  }

  searchSongs(_query) {
    return Promise.reject(new Error('searchSongs() not implemented'));
  }

  loadSongForEditing(_path) {
    return Promise.reject(new Error('loadSongForEditing() not implemented'));
  }

  saveSongEdits(_updates) {
    return Promise.reject(new Error('saveSongEdits() not implemented'));
  }

  // ===== Preferences =====

  getPreferences() {
    return Promise.reject(new Error('getPreferences() not implemented'));
  }

  updateAutoTunePreferences(_prefs) {
    return Promise.reject(new Error('updateAutoTunePreferences() not implemented'));
  }

  updateMicrophonePreferences(_prefs) {
    return Promise.reject(new Error('updateMicrophonePreferences() not implemented'));
  }

  updateEffectsPreferences(_prefs) {
    return Promise.reject(new Error('updateEffectsPreferences() not implemented'));
  }

  // ===== Song Requests =====

  getRequests() {
    return Promise.reject(new Error('getRequests() not implemented'));
  }

  approveRequest(_requestId) {
    return Promise.reject(new Error('approveRequest() not implemented'));
  }

  rejectRequest(_requestId) {
    return Promise.reject(new Error('rejectRequest() not implemented'));
  }

  // ===== State Subscriptions =====

  /**
   * Subscribe to state changes for a specific domain
   * @param {string} domain - State domain (mixer, queue, playback, effects, etc.)
   * @param {Function} callback - Callback function (receives updated state)
   * @returns {Function} Unsubscribe function
   */
  onStateChange(_domain, _callback) {
    throw new Error('onStateChange() not implemented');
  }

  /**
   * Unsubscribe from state changes
   * @param {string} domain - State domain
   * @param {Function} callback - Callback to remove
   */
  offStateChange(_domain, _callback) {
    throw new Error('offStateChange() not implemented');
  }

  // ===== Lifecycle =====

  /**
   * Initialize the bridge (e.g., connect sockets)
   */
  async connect() {
    // Optional - override if needed
  }

  /**
   * Clean up resources (e.g., disconnect sockets)
   */
  async disconnect() {
    // Optional - override if needed
  }
}
