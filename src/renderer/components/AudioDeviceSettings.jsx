/**
 * AudioDeviceSettings - Renderer-only audio device configuration
 *
 * This component is Electron-specific because it requires access to
 * native audio device enumeration via Web Audio API.
 *
 * NOT shared with web admin (browser can't access system audio devices).
 *
 * NOTE: Uses PortalSelect instead of native <select> due to Electron Wayland bug.
 * See PortalSelect.jsx for details.
 */

import React from 'react';
import { PortalSelect } from './PortalSelect.jsx';

export function AudioDeviceSettings({
  devices = { pa: [], iem: [], input: [] },
  selected = { pa: '', iem: '', input: '' },
  settings = { iemMonoVocals: true, micToSpeakers: true, enableMic: true },
  onDeviceChange,
  onSettingChange,
  onRefreshDevices,
}) {
  // Convert device arrays to PortalSelect options format
  const paOptions = [
    { value: '', label: 'Default' },
    ...(devices.pa || []).map((dev) => ({
      value: dev.deviceId,
      label: dev.label || dev.deviceId,
    })),
  ];

  const iemOptions = [
    { value: '', label: 'Default' },
    ...(devices.iem || []).map((dev) => ({
      value: dev.deviceId,
      label: dev.label || dev.deviceId,
    })),
  ];

  const inputOptions = [
    { value: '', label: 'Default' },
    ...(devices.input || []).map((dev) => ({
      value: dev.deviceId,
      label: dev.label || dev.deviceId,
    })),
  ];

  return (
    <>
      {/* Audio Device Settings */}
      <div className="my-5 p-5 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="flex items-center justify-between m-0 mb-4 text-lg text-gray-900 dark:text-gray-100">
          Audio Devices
          <button
            onClick={onRefreshDevices}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors text-base"
            title="Refresh device list"
          >
            ↻
          </button>
        </h3>

        <div className="my-3">
          <label className="block mb-2 text-gray-600 dark:text-gray-400 text-sm">PA Output:</label>
          <PortalSelect
            id="paDeviceSelect"
            value={selected.pa || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('pa', e.target.value)}
            options={paOptions}
            placeholder="Default"
          />
        </div>

        <div className="my-3">
          <label className="block mb-2 text-gray-600 dark:text-gray-400 text-sm">IEM Output:</label>
          <PortalSelect
            id="iemDeviceSelect"
            value={selected.iem || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('iem', e.target.value)}
            options={iemOptions}
            placeholder="Default"
          />
        </div>

        <div className="my-3">
          <label className="flex items-center cursor-pointer select-none text-gray-900 dark:text-gray-100">
            <input
              type="checkbox"
              id="iemMonoVocals"
              className="w-4 h-4 mr-2 cursor-pointer"
              checked={settings.iemMonoVocals ?? true}
              onChange={(e) =>
                onSettingChange && onSettingChange('iemMonoVocals', e.target.checked)
              }
            />
            IEM Vocals in Mono (for single earpiece)
          </label>
        </div>
      </div>

      {/* Mic Options */}
      <div className="my-5 p-5 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="m-0 mb-4 text-lg text-gray-900 dark:text-gray-100">Mic Options</h3>

        <div className="my-3">
          <label className="block mb-2 text-gray-600 dark:text-gray-400 text-sm">Mic Input:</label>
          <PortalSelect
            id="inputDeviceSelect"
            value={selected.input || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('input', e.target.value)}
            options={inputOptions}
            placeholder="Default"
          />
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex items-center cursor-pointer text-gray-900 dark:text-gray-100 select-none">
            <input
              type="checkbox"
              id="micToSpeakers"
              className="w-4 h-4 mr-2 cursor-pointer"
              checked={settings.micToSpeakers ?? true}
              onChange={(e) =>
                onSettingChange && onSettingChange('micToSpeakers', e.target.checked)
              }
            />
            <span>Mic to Speakers</span>
          </label>

          <label className="flex items-center cursor-pointer text-gray-900 dark:text-gray-100 select-none">
            <input
              type="checkbox"
              id="enableMic"
              className="w-4 h-4 mr-2 cursor-pointer"
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
