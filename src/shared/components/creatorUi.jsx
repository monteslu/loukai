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
 * Live creator-job banner — fed by the single creatorJob descriptor (see
 * useCreatorJob). Shows on ANY admin surface when a job is active. `selfActive` is true
 * when THIS surface runs the compute itself (the player panel) → suppressed, since that
 * surface shows its own richer progress. `own` is true when this surface STARTED the
 * job but the compute runs elsewhere (a phone that commanded the host) → the banner IS
 * its progress UI, so it's styled as "your song" rather than "running elsewhere".
 */
export function CreatorJobBanner({ job, selfActive = false, own = false }) {
  if (!job || job.status !== 'running' || selfActive) return null;
  const who =
    job.source === 'electron'
      ? 'the desktop player'
      : job.source === 'web'
        ? 'a web admin'
        : 'another device';
  const pct = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
  const label = [job.artist, job.title].filter(Boolean).join(' - ');
  // Two palettes: blue = your job (in progress, good); amber = someone else's (heads-up).
  const c = own
    ? {
        box: 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30',
        head: 'text-blue-800 dark:text-blue-200',
        sub: 'text-blue-700 dark:text-blue-300',
        track: 'bg-blue-200 dark:bg-blue-800',
        bar: 'bg-blue-500',
      }
    : {
        box: 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30',
        head: 'text-amber-800 dark:text-amber-200',
        sub: 'text-amber-700 dark:text-amber-300',
        track: 'bg-amber-200 dark:bg-amber-800',
        bar: 'bg-amber-500',
      };
  const headline = own
    ? 'Creating your song on the host…'
    : `A creation is already running on ${who}`;
  return (
    <div className={`rounded-lg border ${c.box} p-4 select-text`}>
      <div className={`flex items-center gap-2 ${c.head} font-medium`}>
        <span className="inline-block animate-pulse">●</span>
        {headline}
      </div>
      {label && <div className={`mt-1 text-sm ${c.sub}`}>{label}</div>}
      <div className="mt-2 flex items-center gap-2">
        <div className={`flex-1 h-2 rounded ${c.track} overflow-hidden`}>
          <div className={`h-full ${c.bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`w-9 text-right text-xs ${c.sub}`}>{pct}%</span>
      </div>
      {job.step && <div className={`mt-1 text-xs ${c.sub}`}>Step: {job.step}</div>}
      {job.consoleTail?.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className={`cursor-pointer ${c.sub}`}>show progress log</summary>
          <div className={`mt-1 max-h-32 overflow-auto font-mono ${c.head} whitespace-pre-wrap`}>
            {job.consoleTail.slice(-20).join('\n')}
          </div>
        </details>
      )}
    </div>
  );
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
