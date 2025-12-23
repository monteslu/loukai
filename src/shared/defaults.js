/**
 * Unified defaults for all settings
 * Single source of truth - import this everywhere instead of defining defaults inline
 */

export const MIXER_DEFAULTS = {
  PA: { gain: 0, muted: false, mono: false },
  IEM: { gain: 0, muted: true, mono: true },
  mic: { gain: 0, muted: true },
  stems: {
    vocals: { gain: 0, muted: false },
    instrumental: { gain: 0, muted: false },
    bass: { gain: 0, muted: false },
    drums: { gain: 0, muted: false },
  },
};

export const EFFECTS_DEFAULTS = {
  current: null,
  disabled: [],
  enableWaveforms: false,
  enableEffects: true,
  randomEffectOnSong: false,
  overlayOpacity: 0.7,
  showUpcomingLyrics: true,
};

export const AUTOTUNE_DEFAULTS = {
  enabled: false,
  strength: 50,
  speed: 20,
  preferVocals: false,
};

export const MICROPHONE_DEFAULTS = {
  enabled: false,
  gain: 1.0,
  toSpeakers: true,
};

export const AUDIO_DEVICE_DEFAULTS = {
  PA: { id: 'default', name: 'Default Output' },
  IEM: { id: 'default', name: 'Default Output' },
  input: { id: 'default', name: 'Default Input' },
};

export const SERVER_DEFAULTS = {
  requireKJApproval: true,
  allowSongRequests: true,
  serverName: 'Loukai Karaoke',
  port: 3069,
  maxRequestsPerIP: 10,
  showQrCode: true,
  displayQueue: true,
};

export const LLM_DEFAULTS = {
  enabled: true,
  provider: 'lmstudio',
  model: '',
  apiKey: '',
  baseUrl: 'http://localhost:1234/v1',
};

export const CREATOR_DEFAULTS = {
  outputToSongsFolder: false,
  whisperModel: 'large-v3-turbo',
  enableCrepe: true,
  llm: LLM_DEFAULTS,
};

// Waveform preferences (alias for effects for backward compatibility)
export const WAVEFORM_DEFAULTS = {
  enableWaveforms: EFFECTS_DEFAULTS.enableWaveforms,
  enableEffects: EFFECTS_DEFAULTS.enableEffects,
  randomEffectOnSong: EFFECTS_DEFAULTS.randomEffectOnSong,
  overlayOpacity: EFFECTS_DEFAULTS.overlayOpacity,
  showUpcomingLyrics: EFFECTS_DEFAULTS.showUpcomingLyrics,
};

// UI defaults
export const UI_DEFAULTS = {
  sidebarCollapsed: true, // Start with sidebar collapsed for less overwhelming first experience
};

// All defaults in one object
export const ALL_DEFAULTS = {
  mixer: MIXER_DEFAULTS,
  effects: EFFECTS_DEFAULTS,
  autoTune: AUTOTUNE_DEFAULTS,
  microphone: MICROPHONE_DEFAULTS,
  audioDevices: AUDIO_DEVICE_DEFAULTS,
  server: SERVER_DEFAULTS,
  creator: CREATOR_DEFAULTS,
  waveformPreferences: WAVEFORM_DEFAULTS,
  autoTunePreferences: AUTOTUNE_DEFAULTS,
  ui: UI_DEFAULTS,
  sidebarCollapsed: UI_DEFAULTS.sidebarCollapsed,
  iemMonoVocals: true,
  songsFolder: null,
  lastOpenedFile: null,
  windowBounds: null,
};

/**
 * Deep merge saved settings over defaults
 * @param {Object} saved - Saved settings from disk
 * @param {Object} defaults - Default values
 * @returns {Object} Merged settings
 */
export function mergeWithDefaults(saved, defaults = ALL_DEFAULTS) {
  if (!saved) return { ...defaults };

  const result = {};
  for (const key of Object.keys(defaults)) {
    const defaultValue = defaults[key];
    const savedValue = saved[key];

    if (
      defaultValue !== null &&
      typeof defaultValue === 'object' &&
      !Array.isArray(defaultValue) &&
      savedValue !== null &&
      typeof savedValue === 'object' &&
      !Array.isArray(savedValue)
    ) {
      // Deep merge objects
      result[key] = { ...defaultValue, ...savedValue };
    } else if (savedValue !== undefined) {
      result[key] = savedValue;
    } else {
      result[key] = defaultValue;
    }
  }

  // Include any extra keys from saved that aren't in defaults
  for (const key of Object.keys(saved)) {
    if (!(key in result)) {
      result[key] = saved[key];
    }
  }

  return result;
}

export default {
  MIXER_DEFAULTS,
  EFFECTS_DEFAULTS,
  AUTOTUNE_DEFAULTS,
  MICROPHONE_DEFAULTS,
  AUDIO_DEVICE_DEFAULTS,
  SERVER_DEFAULTS,
  LLM_DEFAULTS,
  CREATOR_DEFAULTS,
  WAVEFORM_DEFAULTS,
  ALL_DEFAULTS,
  mergeWithDefaults,
};
