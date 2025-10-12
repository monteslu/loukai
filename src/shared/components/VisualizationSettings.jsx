/**
 * VisualizationSettings - Shared waveform and auto-tune settings component
 *
 * Used by both renderer and web admin for controlling:
 * - Waveform visualization options
 * - Auto-tune settings
 */

import React, { useState, useEffect } from 'react';

export function VisualizationSettings({
  bridge,
  waveformSettings: externalWaveform = null,
  autotuneSettings: externalAutotune = null,
  onWaveformChange = null,
  onAutotuneChange = null,
}) {
  const [waveformSettings, setWaveformSettings] = useState({
    enableWaveforms: true,
    enableEffects: true,
    randomEffectOnSong: false,
    showUpcomingLyrics: true,
    overlayOpacity: 0.7,
  });

  const [autotuneSettings, setAutotuneSettings] = useState({
    enabled: false,
    strength: 50,
    speed: 20,
    preferVocals: true,
  });

  // Load preferences on mount
  useEffect(() => {
    if (!bridge) return;

    const loadPreferences = async () => {
      try {
        const waveform = await bridge.getWaveformPreferences?.();
        if (waveform) {
          setWaveformSettings((prev) => ({ ...prev, ...waveform }));
        }

        const autotune = await bridge.getAutotunePreferences?.();
        if (autotune) {
          setAutotuneSettings((prev) => ({ ...prev, ...autotune }));
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
      }
    };

    loadPreferences();
  }, [bridge]);

  // Sync with external settings (from socket events in web UI)
  useEffect(() => {
    if (externalWaveform) {
      setWaveformSettings((prev) => ({ ...prev, ...externalWaveform }));
    }
  }, [externalWaveform]);

  useEffect(() => {
    if (externalAutotune) {
      setAutotuneSettings((prev) => ({ ...prev, ...externalAutotune }));
    }
  }, [externalAutotune]);

  // Listen for settings changes from external sources (web admin → renderer)
  useEffect(() => {
    if (!bridge) return;

    const unsubWaveform = bridge.onSettingsChanged?.('waveform', (settings) => {
      setWaveformSettings((prev) => ({ ...prev, ...settings }));
    });

    const unsubAutotune = bridge.onSettingsChanged?.('autotune', (settings) => {
      setAutotuneSettings((prev) => ({ ...prev, ...settings }));
    });

    return () => {
      unsubWaveform?.();
      unsubAutotune?.();
    };
  }, [bridge]);

  // Waveform setting change
  const handleWaveformChange = async (key, value) => {
    const newSettings = { ...waveformSettings, [key]: value };
    setWaveformSettings(newSettings);

    // Notify parent if callback provided (web UI)
    if (onWaveformChange) {
      onWaveformChange(newSettings);
    }

    try {
      await bridge.saveWaveformPreferences?.(newSettings);
    } catch (error) {
      console.error('Failed to save waveform preferences:', error);
    }
  };

  // Auto-tune setting change
  const handleAutotuneChange = async (key, value) => {
    const newSettings = { ...autotuneSettings, [key]: value };
    setAutotuneSettings(newSettings);

    // Notify parent if callback provided (web UI)
    if (onAutotuneChange) {
      onAutotuneChange(newSettings);
    }

    try {
      // saveAutotunePreferences now handles both persistence AND real-time application
      await bridge.saveAutotunePreferences?.(newSettings);
    } catch (error) {
      console.error('Failed to save autotune preferences:', error);
    }
  };

  return (
    <div className="p-4 space-y-6">
      {/* Waveform Options */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Waveform Options</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waveformSettings.enableWaveforms}
              onChange={(e) => handleWaveformChange('enableWaveforms', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-900 dark:text-gray-100">Enable Waveforms</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waveformSettings.enableEffects}
              onChange={(e) => handleWaveformChange('enableEffects', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-900 dark:text-gray-100">Enable Background Effects</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waveformSettings.randomEffectOnSong}
              onChange={(e) => handleWaveformChange('randomEffectOnSong', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-900 dark:text-gray-100">Random Effect on New Song</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waveformSettings.showUpcomingLyrics}
              onChange={(e) => handleWaveformChange('showUpcomingLyrics', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-900 dark:text-gray-100">Show Upcoming Lyrics</span>
          </label>

          <div className="space-y-2">
            <label className="flex items-center justify-between text-gray-900 dark:text-gray-100">
              <span>Overlay Opacity:</span>
              <span className="font-mono text-sm">
                {waveformSettings.overlayOpacity.toFixed(2)}
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={waveformSettings.overlayOpacity}
              onChange={(e) => handleWaveformChange('overlayOpacity', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Auto-Tune Settings */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Auto-Tune</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autotuneSettings.enabled}
              onChange={(e) => handleAutotuneChange('enabled', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-900 dark:text-gray-100">Enable Auto-Tune</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autotuneSettings.preferVocals}
              onChange={(e) => handleAutotuneChange('preferVocals', e.target.checked)}
              disabled={!autotuneSettings.enabled}
              className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-gray-900 dark:text-gray-100">
              Prefer Vocals for Pitch Reference
            </span>
          </label>

          <div className="space-y-2">
            <label className="flex items-center justify-between text-gray-900 dark:text-gray-100">
              <span>Strength:</span>
              <span className="font-mono text-sm">{autotuneSettings.strength}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={autotuneSettings.strength}
              onChange={(e) => handleAutotuneChange('strength', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-between text-gray-900 dark:text-gray-100">
              <span>Speed:</span>
              <span className="font-mono text-sm">{autotuneSettings.speed}</span>
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={autotuneSettings.speed}
              onChange={(e) => handleAutotuneChange('speed', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
