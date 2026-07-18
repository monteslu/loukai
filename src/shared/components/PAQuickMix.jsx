/**
 * PAQuickMix — compact PA mixer for the player drawer (stem×bus mixer #49, §10.1):
 * PA master fader/mute + one compact strip per stem, so the host can tweak the mix
 * mid-song without leaving the Player tab. No device pickers here (Audio tab only).
 *
 * A second VIEW of the same state, not a second owner: everything renders from the
 * mixer broadcast (bridge.onMixerChanged) and every change goes out through the
 * bridge — the Mixer tab, this drawer, and any web admin stay in sync by
 * construction (§11.13). Collapse state persists with the app's UI settings.
 */

import { useEffect, useState } from 'react';
import { StemStrip } from './StemStrip.jsx';
import { resolveStemEntry, orderStems, CANONICAL_STEMS } from '../utils/stemGain.js';
import { isMixdownStem } from '../utils/stemClassify.js';

export function PAQuickMix({ bridge }) {
  const [mixer, setMixer] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    const unsubscribe = bridge.onMixerChanged?.((m) => setMixer(m));
    bridge
      .getMixerState?.()
      .then((m) => setMixer(m))
      .catch(() => {});
    bridge.settingsGet?.('paQuickMixCollapsed').then?.(
      (v) => setCollapsed(v === '1'),
      () => {}
    );
    return () => unsubscribe && unsubscribe();
  }, [bridge]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    bridge.settingsSet?.('paQuickMixCollapsed', next ? '1' : '0');
  };

  const pa = mixer?.PA || { gain: 0, muted: false };
  const songStems = (mixer?.stems || []).map((s) => s.name).filter((n) => n && !isMixdownStem(n));
  const names = songStems.length ? orderStems(songStems) : CANONICAL_STEMS;
  const disabled = songStems.length === 0;

  return (
    <div className="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
      <button
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2"
        onClick={toggleCollapsed}
      >
        <span>PA Mix</span>
        <span className="material-icons text-base">
          {collapsed ? 'expand_more' : 'expand_less'}
        </span>
      </button>
      {!collapsed && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-600 dark:text-gray-400 w-12">Master</span>
            <input
              type="range"
              className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              min="-60"
              max="12"
              step="0.5"
              value={pa.gain ?? 0}
              onChange={(e) => bridge.setMasterGain?.('PA', parseFloat(e.target.value))}
              onDoubleClick={() => bridge.setMasterGain?.('PA', 0)}
            />
            <button
              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                pa.muted
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              }`}
              onClick={() => bridge.toggleMasterMute?.('PA')}
            >
              {pa.muted ? 'MUTED' : 'ON'}
            </button>
          </div>
          <div className="flex gap-1.5 justify-center flex-wrap">
            {names.map((name) => {
              const entry = resolveStemEntry(mixer?.stemMix, 'PA', name);
              return (
                <StemStrip
                  key={name}
                  bus="PA"
                  name={name}
                  gain={entry.gain}
                  muted={entry.muted}
                  disabled={disabled}
                  onGain={(bus, stem, gain) => bridge.setStemGain?.(bus, stem, gain)}
                  onMute={(bus, stem, muted) => bridge.setStemMute?.(bus, stem, muted)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
