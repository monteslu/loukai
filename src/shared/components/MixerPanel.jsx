/**
 * MixerPanel - Unified mixer control panel
 *
 * Based on renderer's mixer design
 * Works with both ElectronBridge and WebBridge via callbacks
 */

import { StemStrip } from './StemStrip.jsx';
import { resolveStemEntry, orderStems, CANONICAL_STEMS } from '../utils/stemGain.js';
import { isMixdownStem } from '../utils/stemClassify.js';

export function MixerPanel({
  mixer, // Support both 'mixer' (web) and 'mixerState' (renderer)
  mixerState,
  onSetMasterGain,
  onToggleMasterMute,
  onGainChange, // Alias for web compatibility
  onMuteToggle, // Alias for web compatibility
  onSetStemGain, // (bus, stem, gain 0..1.5) — stem×bus mixer (#49)
  onSetStemMute, // (bus, stem, muted)
  songType, // 'cdg' renders the single-music-fader variant (§8)
  busExtras, // optional {PA?, IEM?, mic?} JSX per row (device pickers etc. — Electron only)
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
    <div className={`flex flex-col gap-4 p-4 ${className}`}>
      {buses.map((bus) => {
        const gain = state[bus.id]?.gain ?? 0;
        const muted = state[bus.id]?.muted ?? false;

        return (
          <div
            key={bus.id}
            className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-3"
            data-bus={bus.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-gray-900 dark:text-gray-100">{bus.label}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{bus.description}</div>
              </div>
              {busExtras?.[bus.id] || null}
            </div>

            {/* Compact master cluster on one line (a full-width slider + giant MUTE
                bar read as broken; the fader is a trim, not the star of the row). */}
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <span className="text-sm text-gray-600 dark:text-gray-400 w-14 shrink-0">Master</span>
              <input
                type="range"
                className="w-64 max-w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                min="-60"
                max="12"
                step="0.5"
                value={gain}
                onChange={(e) => handleGainChangeLocal(bus.id, e.target.value)}
                onDoubleClick={(e) => handleDoubleClick(bus.id, e)}
                data-bus={bus.id}
                title="Master (double-click = 0 dB)"
              />
              <span className="text-sm font-mono text-gray-700 dark:text-gray-300 w-16">
                {gain.toFixed(1)} dB
              </span>
              <button
                className={`px-3 py-1 rounded text-sm font-semibold transition ${
                  muted
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100'
                }`}
                onClick={() => handleMuteToggleLocal(bus.id)}
                data-bus={bus.id}
              >
                {muted ? 'MUTED' : 'MUTE'}
              </button>
            </div>

            {/* Per-stem strip (PA/IEM only). Stems come from the loaded song; with no
                song the canonical 4 render disabled, showing the persisted values. */}
            {(bus.id === 'PA' || bus.id === 'IEM') && onSetStemGain && (
              <div className="w-full border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
                <div className="flex gap-3 justify-center flex-wrap">
                  {(() => {
                    // CDG (single mixdown, PA-only): one "music" strip on PA; IEM has
                    // no stems to offer (§8).
                    if (songType === 'cdg') {
                      if (bus.id === 'IEM') {
                        return (
                          <div className="text-xs text-gray-500 dark:text-gray-400 py-2">
                            Stems available on M4A Stems songs
                          </div>
                        );
                      }
                      const entry = resolveStemEntry(state.stemMix, 'PA', 'music');
                      return (
                        <StemStrip
                          bus="PA"
                          name="music"
                          gain={entry.gain}
                          muted={entry.muted}
                          onGain={onSetStemGain}
                          onMute={onSetStemMute}
                        />
                      );
                    }
                    const songStems = (state.stems || [])
                      .map((st) => st.name)
                      .filter((n) => n && !isMixdownStem(n));
                    const names = songStems.length ? orderStems(songStems) : CANONICAL_STEMS;
                    const disabled = songStems.length === 0;
                    return names.map((name) => {
                      const entry = resolveStemEntry(state.stemMix, bus.id, name);
                      return (
                        <StemStrip
                          key={name}
                          bus={bus.id}
                          name={name}
                          gain={entry.gain}
                          muted={entry.muted}
                          disabled={disabled}
                          onGain={onSetStemGain}
                          onMute={onSetStemMute}
                        />
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
