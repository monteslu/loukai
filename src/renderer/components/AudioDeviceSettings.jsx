/**
 * AudioDeviceSettings - Renderer-only audio device configuration
 *
 * This component is Electron-specific because it requires access to
 * native audio device enumeration via Web Audio API.
 *
 * NOT shared with web admin (browser can't access system audio devices).
 */

import React from 'react';

export function AudioDeviceSettings({
  devices = { pa: [], iem: [], input: [] },
  selected = { pa: '', iem: '', input: '' },
  settings = { iemMonoVocals: true, micToSpeakers: true, enableMic: true },
  onDeviceChange,
  onSettingChange,
  onRefreshDevices,
}) {
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
          <select
            id="paDeviceSelect"
            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selected.pa || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('pa', e.target.value)}
          >
            <option value="">Default</option>
            {devices.pa &&
              devices.pa.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || dev.deviceId}
                </option>
              ))}
          </select>
        </div>

        <div className="my-3">
          <label className="block mb-2 text-gray-600 dark:text-gray-400 text-sm">IEM Output:</label>
          <select
            id="iemDeviceSelect"
            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selected.iem || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('iem', e.target.value)}
          >
            <option value="">Default</option>
            {devices.iem &&
              devices.iem.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || dev.deviceId}
                </option>
              ))}
          </select>
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
          <select
            id="inputDeviceSelect"
            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selected.input || ''}
            onChange={(e) => onDeviceChange && onDeviceChange('input', e.target.value)}
          >
            <option value="">Default</option>
            {devices.input &&
              devices.input.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || dev.deviceId}
                </option>
              ))}
          </select>
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
