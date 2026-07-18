/**
 * StemStrip — one per-stem fader+mute for one bus (stem×bus mixer, #49).
 * Slider is 0-150% (100% = the authored mix, D3); double-click resets to 100%.
 * Mute is independent of the slider position. Purely presentational: value comes
 * from the shared mixer state, changes go out through the callbacks (no local
 * gain state — two mounted views of one fader must never diverge, §11.13).
 */

export function StemStrip({
  bus,
  name,
  gain = 1,
  muted = false,
  disabled = false,
  onGain,
  onMute,
}) {
  const pct = Math.round(gain * 100);
  return (
    <div
      className={`flex flex-col items-center gap-1 min-w-[64px] ${disabled ? 'opacity-40' : ''}`}
      data-bus={bus}
      data-stem={name}
    >
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[72px]">
        {name}
      </div>
      <input
        type="range"
        className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
        min="0"
        max="150"
        step="1"
        value={pct}
        disabled={disabled}
        onChange={(e) => onGain?.(bus, name, parseInt(e.target.value, 10) / 100)}
        onDoubleClick={() => onGain?.(bus, name, 1)}
        title={`${name} on ${bus}: ${pct}% (double-click = 100%)`}
      />
      <div className="text-[11px] font-mono text-gray-600 dark:text-gray-400">{pct}%</div>
      <button
        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
          muted
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100'
        }`}
        disabled={disabled}
        onClick={() => onMute?.(bus, name, !muted)}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? 'MUTED' : 'ON'}
      </button>
    </div>
  );
}
