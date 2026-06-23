import { useState, useRef } from 'react';

/**
 * Web-admin "Create" tab. The full WebGPU creator can't run here: a browser only
 * exposes WebGPU on a secure context (localhost/HTTPS), and the admin is typically
 * reached over a plain http://<LAN-IP> origin, which falls back to painfully slow
 * WASM. So this tab is a signpost + import:
 *   1. Best results → create in the desktop app (localhost = WebGPU works).
 *   2. Or use the hosted online creator (HTTPS → WebGPU on your machine).
 *   3. Import the resulting .stem.mp4 here → optional lyric lookup + correction.
 */

const ONLINE_CREATOR_URL = 'https://karaoke-creator.loukai.com';

export default function CreatorImportPanel() {
  const [file, setFile] = useState(null);
  const [correct, setCorrect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const pick = (f) => {
    if (!f) return;
    if (!/\.mp4$/i.test(f.name)) {
      setError('Please choose a .stem.mp4 file.');
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
  };

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('correctLyrics', String(correct));
      const res = await fetch('/admin/library/import-stem', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `import failed (${res.status})`);
      setResult(data);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const card =
    'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5';

  return (
    <div className="flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Recommended path */}
      <div className={card}>
        <h3 className="text-lg font-semibold mb-1">Create karaoke files</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          For best results, create karaoke files in the <strong>Loukai desktop app</strong> — it
          runs the GPU-accelerated creator locally for the fastest, most reliable results.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
          No desktop app? Use the free online creator (it runs on your machine&apos;s GPU in the
          browser), then import the finished file below.
        </p>
        <a
          href={ONLINE_CREATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          <span className="material-icons text-base">open_in_new</span>
          Open online creator
        </a>
      </div>

      {/* Import */}
      <div className={card}>
        <h3 className="text-lg font-semibold mb-1">Import a .stem.mp4</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Add a karaoke file (created in the app or online) to your library.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".mp4,.stem.mp4,video/mp4"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
          className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-200 dark:file:bg-gray-700 file:text-gray-800 dark:file:text-gray-100 hover:file:bg-gray-300 dark:hover:file:bg-gray-600"
        />

        <label className="flex items-center gap-2 mt-4 text-sm text-gray-700 dark:text-gray-300 select-none">
          <input
            type="checkbox"
            checked={correct}
            disabled={busy}
            onChange={(e) => setCorrect(e.target.checked)}
            className="w-4 h-4"
          />
          Look up lyrics and make corrections
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 ml-6 mt-1">
          Matches the song against an online lyrics database and cleans up the transcription. Leave
          on unless you want the lyrics exactly as created.
        </p>

        <button
          type="button"
          onClick={doImport}
          disabled={busy || !file}
          className="mt-4 px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {busy ? 'Importing…' : 'Add to library'}
        </button>

        {error && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-sm">
            ⚠ {error}
          </div>
        )}
        {result?.success && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm">
            ✓ Added <strong>{result.fileName}</strong> to your library
            {result.corrected ? ' (lyrics corrected)' : ''}.
          </div>
        )}
      </div>
    </div>
  );
}
