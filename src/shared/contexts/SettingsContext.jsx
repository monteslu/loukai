/**
 * SettingsContext - Application settings/preferences
 *
 * Manages device preferences, waveform settings, autotune settings
 * Uses unified defaults from shared/defaults.js
 */

import { createContext, useContext, useState } from 'react';
import { AUDIO_DEVICE_DEFAULTS, WAVEFORM_DEFAULTS, AUTOTUNE_DEFAULTS } from '../defaults.js';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [devicePreferences, setDevicePreferences] = useState({
    ...AUDIO_DEVICE_DEFAULTS,
  });

  const [waveformPreferences, setWaveformPreferences] = useState({
    ...WAVEFORM_DEFAULTS,
    micToSpeakers: true,
    enableMic: true,
    disabledEffects: [],
  });

  const [autoTunePreferences, setAutoTunePreferences] = useState({
    ...AUTOTUNE_DEFAULTS,
  });

  const value = {
    // Settings
    devicePreferences,
    waveformPreferences,
    autoTunePreferences,

    // Actions
    setDevicePreferences,
    setWaveformPreferences,
    setAutoTunePreferences,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}
