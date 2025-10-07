/**
 * useSettingsPersistence - Settings load/save via IPC
 *
 * Loads settings from storage and saves changes
 */

import { useEffect, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext.jsx';

export function useSettingsPersistence() {
  const {
    devicePreferences,
    waveformPreferences,
    autoTunePreferences,
    setDevicePreferences,
    setWaveformPreferences,
    setAutoTunePreferences,
  } = useSettings();

  // Track whether initial load has completed to prevent saving hardcoded defaults
  const isLoadedRef = useRef(false);

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      if (!window.kaiAPI?.settings) return;

      try {
        const devices = await window.kaiAPI.settings.get('devicePreferences', null);
        if (devices) setDevicePreferences(devices);

        const waveform = await window.kaiAPI.settings.get('waveformPreferences', null);
        if (waveform) setWaveformPreferences(waveform);

        const autotune = await window.kaiAPI.settings.get('autoTunePreferences', null);
        if (autotune) setAutoTunePreferences(autotune);

        isLoadedRef.current = true; // Mark as loaded to enable saving
      } catch (error) {
        console.error('Failed to load settings:', error);
        isLoadedRef.current = true; // Enable saving even on error
      }
    }

    loadSettings();
  }, [setDevicePreferences, setWaveformPreferences, setAutoTunePreferences]);

  // Save device preferences when changed (only after initial load)
  useEffect(() => {
    if (!window.kaiAPI?.settings || !isLoadedRef.current) return;
    window.kaiAPI.settings.set('devicePreferences', devicePreferences);
  }, [devicePreferences]);

  // Save waveform preferences when changed (only after initial load)
  useEffect(() => {
    if (!window.kaiAPI?.settings || !isLoadedRef.current) return;
    window.kaiAPI.settings.set('waveformPreferences', waveformPreferences);
  }, [waveformPreferences]);

  // Save autotune preferences when changed (only after initial load)
  useEffect(() => {
    if (!window.kaiAPI?.settings || !isLoadedRef.current) return;
    window.kaiAPI.settings.set('autoTunePreferences', autoTunePreferences);
  }, [autoTunePreferences]);

  return {
    devicePreferences,
    waveformPreferences,
    autoTunePreferences,
    setDevicePreferences,
    setWaveformPreferences,
    setAutoTunePreferences,
  };
}
