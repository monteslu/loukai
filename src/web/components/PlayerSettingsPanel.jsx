import { useState, useEffect } from 'react';

export function PlayerSettingsPanel({ socket }) {
  const [waveformSettings, setWaveformSettings] = useState({
    enableWaveforms: true,
    enableEffects: true,
    randomEffectOnSong: false,
    overlayOpacity: 0.7,
    showUpcomingLyrics: true,
  });

  const [autoTuneSettings, setAutoTuneSettings] = useState({
    enabled: false,
    strength: 50,
    speed: 20,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch current settings
    Promise.all([
      fetch('/admin/settings/waveform', { credentials: 'include' }).then((res) => res.json()),
      fetch('/admin/settings/autotune', { credentials: 'include' }).then((res) => res.json()),
    ])
      .then(([waveform, autotune]) => {
        if (waveform.settings) setWaveformSettings(waveform.settings);
        if (autotune.settings) setAutoTuneSettings(autotune.settings);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch settings:', err);
        setLoading(false);
      });
  }, []);

  // Listen for settings changes from renderer
  useEffect(() => {
    if (!socket) return;

    const handleWaveformUpdate = (settings) => {
      console.log('📥 Received waveform settings from renderer:', settings);
      setWaveformSettings((prev) => ({ ...prev, ...settings }));
    };

    const handleAutoTuneUpdate = (settings) => {
      console.log('📥 Received autotune settings from renderer:', settings);
      setAutoTuneSettings((prev) => ({ ...prev, ...settings }));
    };

    socket.on('settings:waveform', handleWaveformUpdate);
    socket.on('settings:autotune', handleAutoTuneUpdate);

    return () => {
      socket.off('settings:waveform', handleWaveformUpdate);
      socket.off('settings:autotune', handleAutoTuneUpdate);
    };
  }, [socket]);

  const handleWaveformChange = async (key, value) => {
    const newSettings = { ...waveformSettings, [key]: value };
    setWaveformSettings(newSettings);

    try {
      await fetch('/admin/settings/waveform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: value }),
      });
    } catch (err) {
      console.error('Failed to update waveform setting:', err);
    }
  };

  const handleAutoTuneChange = async (key, value) => {
    const newSettings = { ...autoTuneSettings, [key]: value };
    setAutoTuneSettings(newSettings);

    try {
      await fetch('/admin/settings/autotune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: value }),
      });
    } catch (err) {
      console.error('Failed to update auto-tune setting:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-5 h-full overflow-y-auto flex items-center justify-center text-gray-600 dark:text-gray-400">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="p-5 h-full overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-5">
        <h3 className="m-0 mb-5 text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3">
          Waveform & Visual Options
        </h3>

        <label className="flex items-center py-3 gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={waveformSettings.enableWaveforms}
            onChange={(e) => handleWaveformChange('enableWaveforms', e.target.checked)}
            className="w-[18px] h-[18px] cursor-pointer"
          />
          <span className="flex-1 text-[15px] text-gray-900 dark:text-white">Enable Waveforms</span>
        </label>

        <label className="flex items-center py-3 gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={waveformSettings.enableEffects}
            onChange={(e) => handleWaveformChange('enableEffects', e.target.checked)}
            className="w-[18px] h-[18px] cursor-pointer"
          />
          <span className="flex-1 text-[15px] text-gray-900 dark:text-white">
            Enable Visual Effects
          </span>
        </label>

        <label className="flex items-center py-3 gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={waveformSettings.randomEffectOnSong}
            onChange={(e) => handleWaveformChange('randomEffectOnSong', e.target.checked)}
            className="w-[18px] h-[18px] cursor-pointer"
          />
          <span className="flex-1 text-[15px] text-gray-900 dark:text-white">
            Random Effect on Each Song
          </span>
        </label>

        <label className="flex items-center py-3 gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={waveformSettings.showUpcomingLyrics}
            onChange={(e) => handleWaveformChange('showUpcomingLyrics', e.target.checked)}
            className="w-[18px] h-[18px] cursor-pointer"
          />
          <span className="flex-1 text-[15px] text-gray-900 dark:text-white">
            Show Upcoming Lyrics
          </span>
        </label>

        <div className="flex flex-col items-stretch py-3 cursor-default">
          <label className="flex flex-col gap-2 w-full">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
              Overlay Opacity: {Math.round(waveformSettings.overlayOpacity * 100)}%
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={waveformSettings.overlayOpacity}
              onChange={(e) => handleWaveformChange('overlayOpacity', parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-sm outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 dark:[&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-600 dark:[&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
            />
          </label>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-5">
        <h3 className="m-0 mb-5 text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3">
          Auto-Tune
        </h3>

        <label className="flex items-center py-3 gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoTuneSettings.enabled}
            onChange={(e) => handleAutoTuneChange('enabled', e.target.checked)}
            className="w-[18px] h-[18px] cursor-pointer"
          />
          <span className="flex-1 text-[15px] text-gray-900 dark:text-white">Enable Auto-Tune</span>
        </label>

        <div className="flex flex-col items-stretch py-3 cursor-default">
          <label className="flex flex-col gap-2 w-full">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
              Strength: {autoTuneSettings.strength}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={autoTuneSettings.strength}
              onChange={(e) => handleAutoTuneChange('strength', parseInt(e.target.value))}
              disabled={!autoTuneSettings.enabled}
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-sm outline-none appearance-none disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 dark:[&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:disabled:cursor-not-allowed [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-600 dark:[&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:disabled:cursor-not-allowed"
            />
          </label>
        </div>

        <div className="flex flex-col items-stretch py-3 cursor-default">
          <label className="flex flex-col gap-2 w-full">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
              Speed: {autoTuneSettings.speed}ms
            </span>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={autoTuneSettings.speed}
              onChange={(e) => handleAutoTuneChange('speed', parseInt(e.target.value))}
              disabled={!autoTuneSettings.enabled}
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-sm outline-none appearance-none disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 dark:[&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:disabled:cursor-not-allowed [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-600 dark:[&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:disabled:cursor-not-allowed"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
