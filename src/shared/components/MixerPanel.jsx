/**
 * MixerPanel - Unified mixer control panel
 *
 * Based on renderer's mixer design
 * Works with both ElectronBridge and WebBridge via callbacks
 */

export function MixerPanel({
  mixer, // Support both 'mixer' (web) and 'mixerState' (renderer)
  mixerState,
  onSetMasterGain,
  onToggleMasterMute,
  onGainChange, // Alias for web compatibility
  onMuteToggle, // Alias for web compatibility
  className = '',
}) {
  // Support both prop names - prefer mixerState if provided, then mixer, then empty object
  const state = mixerState || mixer || {};
  const handleGainChange = onSetMasterGain || onGainChange;
  const handleMuteToggle = onToggleMasterMute || onMuteToggle;
  const buses = [
    { id: 'PA', label: 'PA (Main)', description: 'Music + Mic to audience' },
    { id: 'IEM', label: 'IEM (Monitors)', description: 'Vocals only (mono)' },
    { id: 'mic', label: 'Mic Input', description: 'Microphone gain' },
  ];

  const handleGainChangeLocal = (busId, value) => {
    if (handleGainChange) {
      handleGainChange(busId, parseFloat(value));
    }
  };

  const handleMuteToggleLocal = (busId) => {
    if (handleMuteToggle) {
      handleMuteToggle(busId);
    }
  };

  const handleDoubleClick = (busId, e) => {
    e.target.value = 0;
    handleGainChangeLocal(busId, 0);
  };

  return (
    <div className={`flex gap-4 p-4 ${className}`}>
      {buses.map((bus) => {
        const gain = state[bus.id]?.gain ?? 0;
        const muted = state[bus.id]?.muted ?? false;

        return (
          <div
            key={bus.id}
            className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col items-center gap-3"
            data-bus={bus.id}
          >
            <div className="text-center">
              <div className="font-semibold text-gray-900 dark:text-gray-100">{bus.label}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{bus.description}</div>
            </div>

            <div className="flex flex-col items-center gap-2 w-full">
              <input
                type="range"
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                min="-60"
                max="12"
                step="0.5"
                value={gain}
                onChange={(e) => handleGainChangeLocal(bus.id, e.target.value)}
                onDoubleClick={(e) => handleDoubleClick(bus.id, e)}
                data-bus={bus.id}
              />
              <div className="text-sm font-mono text-gray-700 dark:text-gray-300">
                {gain.toFixed(1)} dB
              </div>
            </div>

            <button
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                muted
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100'
              }`}
              onClick={() => handleMuteToggleLocal(bus.id)}
              data-bus={bus.id}
            >
              MUTE
            </button>
          </div>
        );
      })}
    </div>
  );
}
