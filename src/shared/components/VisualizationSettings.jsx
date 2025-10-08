/**
 * VisualizationSettings - Shared waveform and auto-tune settings component
 *
 * Used by both renderer and web admin for controlling:
 * - Waveform visualization options
 * - Auto-tune settings
 */

import React, { useState, useEffect } from 'react';
import './VisualizationSettings.css';

export function VisualizationSettings({
  bridge,
  waveformSettings: externalWaveform = null,
  autotuneSettings: externalAutotune = null,
  onWaveformChange = null,
  onAutotuneChange = null
}) {
  const [waveformSettings, setWaveformSettings] = useState({
    enableWaveforms: true,
    enableEffects: true,
    randomEffectOnSong: false,
    showUpcomingLyrics: true,
    overlayOpacity: 0.7
  });

  const [autotuneSettings, setAutotuneSettings] = useState({
    enabled: false,
    strength: 50,
    speed: 20
  });

  // Load preferences on mount
  useEffect(() => {
    if (!bridge) return;

    const loadPreferences = async () => {
      try {
        const waveform = await bridge.getWaveformPreferences?.();
        if (waveform) {
          setWaveformSettings(prev => ({ ...prev, ...waveform }));
        }

        const autotune = await bridge.getAutotunePreferences?.();
        if (autotune) {
          setAutotuneSettings(prev => ({ ...prev, ...autotune }));
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
      setWaveformSettings(prev => ({ ...prev, ...externalWaveform }));
    }
  }, [externalWaveform]);

  useEffect(() => {
    if (externalAutotune) {
      setAutotuneSettings(prev => ({ ...prev, ...externalAutotune }));
    }
  }, [externalAutotune]);

  // Listen for settings changes from external sources (web admin → renderer)
  useEffect(() => {
    if (!bridge) return;

    const unsubWaveform = bridge.onSettingsChanged?.('waveform', (settings) => {
      setWaveformSettings(prev => ({ ...prev, ...settings }));
    });

    const unsubAutotune = bridge.onSettingsChanged?.('autotune', (settings) => {
      setAutotuneSettings(prev => ({ ...prev, ...settings }));
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
      await bridge.saveAutotunePreferences?.(newSettings);

      // Also update via API for real-time changes
      if (key === 'enabled') {
        await bridge.setAutotuneEnabled?.(value);
      } else {
        await bridge.setAutotuneSettings?.(newSettings);
      }
    } catch (error) {
      console.error('Failed to save autotune preferences:', error);
    }
  };

  return (
    <div className="visualization-settings">
      {/* Waveform Options */}
      <div className="settings-section">
        <h3>Waveform Options</h3>
        <div className="waveform-controls">
          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={waveformSettings.enableWaveforms}
              onChange={(e) => handleWaveformChange('enableWaveforms', e.target.checked)}
            />
            <span>Enable Waveforms</span>
          </label>

          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={waveformSettings.enableEffects}
              onChange={(e) => handleWaveformChange('enableEffects', e.target.checked)}
            />
            <span>Enable Background Effects</span>
          </label>

          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={waveformSettings.randomEffectOnSong}
              onChange={(e) => handleWaveformChange('randomEffectOnSong', e.target.checked)}
            />
            <span>Random Effect on New Song</span>
          </label>

          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={waveformSettings.showUpcomingLyrics}
              onChange={(e) => handleWaveformChange('showUpcomingLyrics', e.target.checked)}
            />
            <span>Show Upcoming Lyrics</span>
          </label>

          <div className="slider-control">
            <label>
              Overlay Opacity: <span className="slider-value">{waveformSettings.overlayOpacity.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={waveformSettings.overlayOpacity}
              onChange={(e) => handleWaveformChange('overlayOpacity', parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* Auto-Tune Settings */}
      <div className="settings-section">
        <h3>Auto-Tune</h3>
        <div className="autotune-controls">
          <label className="setting-checkbox">
            <input
              type="checkbox"
              checked={autotuneSettings.enabled}
              onChange={(e) => handleAutotuneChange('enabled', e.target.checked)}
            />
            <span>Enable Auto-Tune</span>
          </label>

          <div className="slider-control">
            <label>
              Strength: <span className="slider-value">{autotuneSettings.strength}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={autotuneSettings.strength}
              onChange={(e) => handleAutotuneChange('strength', parseInt(e.target.value))}
            />
          </div>

          <div className="slider-control">
            <label>
              Speed: <span className="slider-value">{autotuneSettings.speed}</span>
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={autotuneSettings.speed}
              onChange={(e) => handleAutotuneChange('speed', parseInt(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
