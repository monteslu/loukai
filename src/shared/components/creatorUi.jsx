/**
 * Shared creator UI primitives — the design system for the WebGPU creator (cards,
 * inputs, buttons, error display, per-stem progress bars).
 */

// Shared Tailwind class strings (cards, inputs, buttons, section titles).
export const STYLES = {
  input:
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
  select:
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
  btnPrimary:
    'px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  btnSecondary:
    'px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50',
  btnSuccess:
    'px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors',
  sectionTitle: 'text-lg font-semibold text-gray-900 dark:text-white mb-4',
  card: 'bg-gray-100 dark:bg-gray-800 rounded-lg p-6',
  label: 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1',
};

export function Spinner({ message, size = 'md' }) {
  const sizeClasses = { sm: 'h-8 w-8', md: 'h-12 w-12' };
  return (
    <div className="text-center">
      <div
        className={`animate-spin rounded-full ${sizeClasses[size]} border-b-2 border-blue-500 mx-auto mb-3`}
      />
      {message && <p className="text-gray-600 dark:text-gray-400">{message}</p>}
    </div>
  );
}

export function ErrorDisplay({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 select-text">
      {onDismiss && (
        <button
          className="float-right text-red-700 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 text-xl leading-none"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
      <div className="font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-96">{error}</div>
    </div>
  );
}

export function MissingLinesDetails({ missingLines }) {
  if (!missingLines || missingLines.length === 0) return null;
  return (
    <details className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-2">
      <summary className="cursor-pointer font-semibold">
        💡 {missingLines.length} missing line{missingLines.length !== 1 ? 's' : ''} suggested (not
        applied)
      </summary>
      <ul className="mt-2 space-y-1 ml-4 list-disc max-h-40 overflow-y-auto">
        {missingLines.map((line, i) => (
          <li key={i}>
            <span className="text-blue-600 dark:text-blue-400">
              &quot;{line.suggested_text}&quot;
            </span>{' '}
            <span className="text-gray-500 dark:text-gray-400">
              ({line.start?.toFixed(1)}s-{line.end?.toFixed(1)}s, {line.confidence} confidence)
            </span>
            {line.reason && (
              <div className="text-gray-500 dark:text-gray-400 ml-2">→ {line.reason}</div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SongTitle({ artist, title }) {
  return artist ? `${artist} - ${title}` : title;
}

/**
 * Per-stem progress bars (drums/bass/other/vocals) — the WebGPU creator's nicer
 * separation progress, shared so it's reusable. `progress` is { stem: 0..1 }.
 */
export function StemProgressBars({ progress = {}, label }) {
  const stems = [
    { key: 'drums', emoji: '🥁' },
    { key: 'bass', emoji: '🎸' },
    { key: 'other', emoji: '🎹' },
    { key: 'vocals', emoji: '🎤' },
  ];
  return (
    <div>
      {label && <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">{label}</div>}
      <div className="flex flex-col gap-1.5">
        {stems.map(({ key, emoji }) => {
          const frac = progress[key] || 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-20 text-xs text-gray-600 dark:text-gray-400">
                {emoji} {key}
              </span>
              <div className="flex-1 h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${(frac * 100).toFixed(1)}%` }}
                />
              </div>
              <span className="w-9 text-right text-xs text-gray-500">
                {Math.round(frac * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
