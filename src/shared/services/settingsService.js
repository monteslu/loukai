/**
 * Unified Settings Service
 * Single entry point for all settings operations
 * Handles persistence, AppState sync, and broadcasting
 */

import { ALL_DEFAULTS, mergeWithDefaults } from '../defaults.js';

let _settingsManager = null;
let _appState = null;
let _broadcastFn = null;
let _initialized = false;

/**
 * Initialize the service with dependencies (called once from main.js)
 * @param {Object} settingsManager - SettingsManager instance
 * @param {Object} appState - AppState instance
 * @param {Function} broadcastFn - Function to broadcast changes (key, value) => void
 */
export function initSettingsService(settingsManager, appState, broadcastFn) {
  _settingsManager = settingsManager;
  _appState = appState;
  _broadcastFn = broadcastFn;
  _initialized = true;
  console.log('✅ Settings service initialized');
}

/**
 * Check if service is initialized
 */
export function isInitialized() {
  return _initialized;
}

/**
 * Get a setting value (with defaults applied)
 * @param {string} key - Setting key (supports dot notation like 'creator.llm')
 * @param {*} defaultValue - Optional default if not found
 * @returns {*} Setting value
 */
export function getSetting(key, defaultValue) {
  if (!_settingsManager) {
    console.warn('⚠️ Settings service not initialized, using default');
    return defaultValue ?? getDefaultForKey(key);
  }

  const saved = _settingsManager.get(key);
  if (saved !== undefined) return saved;

  // Fall back to ALL_DEFAULTS if no explicit default provided
  if (defaultValue === undefined) {
    return getDefaultForKey(key);
  }
  return defaultValue;
}

/**
 * Get default value for a key from ALL_DEFAULTS
 * Supports dot notation
 */
function getDefaultForKey(key) {
  if (!key) return undefined;

  // Handle dot notation
  const parts = key.split('.');
  let value = ALL_DEFAULTS;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return undefined;
    }
  }
  return value;
}

/**
 * Get all settings (merged with defaults)
 * @returns {Object} All settings
 */
export function getAllSettings() {
  if (!_settingsManager) {
    console.warn('⚠️ Settings service not initialized, using defaults');
    return { ...ALL_DEFAULTS };
  }

  const saved = _settingsManager.getAll();
  return mergeWithDefaults(saved);
}

/**
 * Set a setting and broadcast to all clients
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 * @param {Object} options - Options
 * @param {boolean} options.skipBroadcast - Don't broadcast change
 * @param {boolean} options.skipPersist - Don't persist to disk
 * @param {boolean} options.skipAppState - Don't sync to AppState
 * @returns {Object} Result with success status
 */
export async function setSetting(key, value, options = {}) {
  const { skipBroadcast = false, skipPersist = false, skipAppState = false } = options;

  if (!_settingsManager && !skipPersist) {
    console.error('❌ Settings service not initialized');
    return { success: false, error: 'Settings service not initialized' };
  }

  // 1. Persist to disk
  if (!skipPersist && _settingsManager) {
    _settingsManager.set(key, value);
  }

  // 2. Update AppState mirror (for relevant keys)
  if (!skipAppState) {
    syncToAppState(key, value);
  }

  // 3. Broadcast to all clients (renderer + web)
  if (!skipBroadcast && _broadcastFn) {
    _broadcastFn(key, value);
  }

  return { success: true, key, value };
}

/**
 * Update multiple settings at once
 * @param {Object} updates - Key-value pairs to update
 * @param {Object} options - Options (same as setSetting)
 * @returns {Object} Result with success status
 */
export async function setSettings(updates, options = {}) {
  const results = {};

  for (const [key, value] of Object.entries(updates)) {
    const result = await setSetting(key, value, { ...options, skipBroadcast: true });
    results[key] = result;
  }

  // Single broadcast for batch update
  if (!options.skipBroadcast && _broadcastFn) {
    _broadcastFn('settings:batch', updates);
  }

  return { success: true, updates: results };
}

/**
 * Sync a setting to AppState (keeps memory mirror in sync)
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 */
function syncToAppState(key, value) {
  if (!_appState) return;

  // Map settings keys to AppState update methods
  switch (key) {
    case 'mixer':
      _appState.update('mixer', value);
      break;

    case 'effects':
    case 'waveformPreferences':
      // Sync effects-related settings
      if (_appState.state?.effects) {
        _appState.update('effects', {
          ..._appState.state.effects,
          ...value,
        });
      }
      break;

    case 'autoTune':
    case 'autoTunePreferences':
      if (_appState.updatePreferences) {
        _appState.updatePreferences('autoTune', value);
      }
      break;

    case 'microphone':
      if (_appState.updatePreferences) {
        _appState.updatePreferences('microphone', value);
      }
      break;

    case 'audioDevices':
    case 'devicePreferences':
      if (_appState.setAudioDevices) {
        _appState.setAudioDevices(value);
      }
      break;

    case 'iemMonoVocals':
      if (_appState.updatePreferences) {
        _appState.updatePreferences('iemMonoVocals', value);
      }
      break;

    // Add more mappings as needed
  }
}

/**
 * Load settings on startup and sync to AppState
 * @returns {Object} Loaded settings
 */
export async function loadAndSync() {
  const settings = getAllSettings();

  // Sync each category to AppState
  if (settings.mixer) syncToAppState('mixer', settings.mixer);
  if (settings.effects) syncToAppState('effects', settings.effects);
  if (settings.waveformPreferences)
    syncToAppState('waveformPreferences', settings.waveformPreferences);
  if (settings.autoTune) syncToAppState('autoTune', settings.autoTune);
  if (settings.autoTunePreferences)
    syncToAppState('autoTunePreferences', settings.autoTunePreferences);
  if (settings.microphone) syncToAppState('microphone', settings.microphone);
  if (settings.audioDevices) syncToAppState('audioDevices', settings.audioDevices);
  if (settings.devicePreferences) syncToAppState('devicePreferences', settings.devicePreferences);

  console.log('✅ Settings loaded and synced to AppState');
  return settings;
}

/**
 * Get the broadcast channel name for a settings key
 * @param {string} key - Settings key
 * @returns {string} Channel name
 */
export function getBroadcastChannel(key) {
  const channelMap = {
    mixer: 'mixer:state',
    effects: 'effects:changed',
    waveformPreferences: 'waveform:settingsChanged',
    autoTune: 'autotune:settingsChanged',
    autoTunePreferences: 'autotune:settingsChanged',
    microphone: 'preferences:updated',
    audioDevices: 'preferences:updated',
    devicePreferences: 'preferences:updated',
    'settings:batch': 'settings:updated',
  };

  return channelMap[key] || `settings:${key}`;
}

export default {
  initSettingsService,
  isInitialized,
  getSetting,
  getAllSettings,
  setSetting,
  setSettings,
  loadAndSync,
  getBroadcastChannel,
};
