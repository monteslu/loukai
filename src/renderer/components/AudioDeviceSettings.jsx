/**
 * AudioDeviceSettings - Renderer-only audio device configuration
 *
 * This component is Electron-specific because it requires access to
 * native audio device enumeration via Web Audio API.
 *
 * NOT shared with web admin (browser can't access system audio devices).
 */

import React from 'react';
import './AudioDeviceSettings.css';

export function AudioDeviceSettings({
  devices = { pa: [], iem: [], input: [] },
  selected = { pa: '', iem: '', input: '' },
  settings = { iemMonoVocals: true, micToSpeakers: true, enableMic: true },
  onDeviceChange,
  onSettingChange,
  onRefreshDevices
}) {
  return (
    <>
      {/* Audio Device Settings */}
      <div className="audio-settings-section">
        <h3>
          Audio Devices
          <button
            onClick={onRefreshDevices}
            className="refresh-btn"
            title="Refresh device list"
          >
            ↻
          </button>
        </h3>

        <div className="device-selector">
          <label>PA Output:</label>
          <select
            id="paDeviceSelect"
            value={selected.pa || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('pa', e.target.value)}
          >
            <option value="">Default</option>
            {devices.pa && devices.pa.map(dev => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label || dev.deviceId}
              </option>
            ))}
          </select>
        </div>

        <div className="device-selector">
          <label>IEM Output:</label>
          <select
            id="iemDeviceSelect"
            value={selected.iem || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('iem', e.target.value)}
          >
            <option value="">Default</option>
            {devices.iem && devices.iem.map(dev => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label || dev.deviceId}
              </option>
            ))}
          </select>
        </div>

        <div className="device-selector">
          <label>
            <input
              type="checkbox"
              id="iemMonoVocals"
              checked={settings.iemMonoVocals ?? true}
              onChange={(e) => onSettingChange && onSettingChange('iemMonoVocals', e.target.checked)}
            />
            IEM Vocals in Mono (for single earpiece)
          </label>
        </div>
      </div>

      {/* Mic Options */}
      <div className="audio-settings-section">
        <h3>Mic Options</h3>

        <div className="device-selector">
          <label>Mic Input:</label>
          <select
            id="inputDeviceSelect"
            value={selected.input || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('input', e.target.value)}
          >
            <option value="">Default</option>
            {devices.input && devices.input.map(dev => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label || dev.deviceId}
              </option>
            ))}
          </select>
        </div>

        <div className="waveform-controls">
          <label className="audio-checkbox">
            <input
              type="checkbox"
              id="micToSpeakers"
              checked={settings.micToSpeakers ?? true}
              onChange={(e) => onSettingChange && onSettingChange('micToSpeakers', e.target.checked)}
            />
            <span>Mic to Speakers</span>
          </label>

          <label className="audio-checkbox">
            <input
              type="checkbox"
              id="enableMic"
              checked={settings.enableMic ?? true}
              onChange={(e) => onSettingChange && onSettingChange('enableMic', e.target.checked)}
            />
            <span>Enable Mic</span>
          </label>
        </div>
      </div>
    </>
  );
}
