import { useState, useRef, useEffect } from 'react';
import { CreatorJobBanner } from '../../shared/components/creatorUi.jsx';
import { useCreatorJob } from '../../shared/hooks/useCreatorJob.js';
import { WHISPER_LANGUAGES } from '../../shared/creator/creatorAudio.js';

/**
 * Web-admin "Create" tab. A browser only exposes WebGPU on a secure context
 * (localhost/HTTPS), and the admin is typically reached over plain http://<LAN-IP>,
 * so the heavy creation can't run here. Instead this tab offers, in order:
 *   1. Create on this host — upload audio; the desktop PLAYER runs the creation on its
 *      GPU and saves it to the library. Live progress streams back here. (Only shown
 *      when a player is running — hostAvailable.)
 *   2. Online creator — HTTPS WebGPU on your own machine, then import.
 *   3. Import a finished .stem.mp4 → optional lyric lookup + correction.
 *
 * It observes the single creator job so an in-flight creation (this phone's host job,
 * the desktop player's, or another admin's) shows live progress here.
 */

const ONLINE_CREATOR_URL = 'https://karaoke-creator.loukai.com';
const AUDIO_ACCEPT = '.mp3,.wav,.flac,.ogg,.m4a,.aac,.aif,.aiff,.mp4,.mkv,.mov,.webm';

export default function CreatorImportPanel({ bridge }) {
  // Live single-job descriptor + whether a host player is present to run creation.
  const { job: creatorJob, isRunning, hostAvailable } = useCreatorJob({ bridge });

  // ---- Host-create (command the player) ----
  const [srcFile, setSrcFile] = useState(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  // Whisper transcription language. Defaults to English; 'auto' runs real detection on
  // the host (the creator detects on the loudest vocals window).
  const [language, setLanguage] = useState('en');
  const [submitting, setSubmitting] = useState(false);
  const [hostError, setHostError] = useState(null);
  const [hostDone, setHostDone] = useState(null); // {fileName} once the job completes
  const srcInputRef = useRef(null);
  // Track the job we started so we can show this phone's own completion/failure.
  const ourJobIdRef = useRef(null);

  // Reflect our submitted job's terminal state into the local done/error UI.
  useEffect(() => {
    if (!ourJobIdRef.current || !creatorJob) return;
    if (creatorJob.id !== ourJobIdRef.current) return;
    if (creatorJob.status === 'complete') {
      setHostDone({ fileName: creatorJob.outputPath?.split(/[/\\]/).pop() || 'your song' });
      setSubmitting(false);
      ourJobIdRef.current = null;
    } else if (creatorJob.status === 'error') {
      setHostError(creatorJob.error || 'creation failed on the host');
      setSubmitting(false);
      ourJobIdRef.current = null;
    }
  }, [creatorJob]);

  const pickSource = (f) => {
    if (!f) return;
    setHostError(null);
    setHostDone(null);
    setSrcFile(f);
    // Prefill title/artist from "Artist - Title.ext" if not set.
    if (!title && !artist) {
      const base = f.name.replace(/\.[^.]+$/, '');
      const dash = base.match(/^(.+?)\s*-\s*(.+)$/);
      if (dash) {
        setArtist(dash[1].trim());
        setTitle(dash[2].trim());
      } else {
        setTitle(base);
      }
    }
  };

  const doHostCreate = async () => {
    if (!srcFile) return;
    setSubmitting(true);
    setHostError(null);
    setHostDone(null);
    try {
      const fd = new FormData();
      fd.append('file', srcFile, srcFile.name);
      if (title) fd.append('title', title);
      if (artist) fd.append('artist', artist);
      // creator options — the host-create endpoint parses this JSON into the job opts
      fd.append('opts', JSON.stringify({ language }));
      const res = await fetch('/admin/creator/host-create', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        throw new Error('A creation is already running — wait for it to finish.');
      }
      if (!res.ok || !data.accepted) {
        throw new Error(data.error || `request failed (${res.status})`);
      }
      // Accepted: the player is now creating. Watch the job (banner + our effect above).
      ourJobIdRef.current = data.jobId;
      setSrcFile(null);
      if (srcInputRef.current) srcInputRef.current.value = '';
    } catch (e) {
      setHostError(e.message || 'Failed to start creation');
      setSubmitting(false);
    }
  };

  // ---- Import a finished .stem.mp4 ----
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

  // Our host job is the running job iff its id matches.
  const ourJobRunning = isRunning && creatorJob?.id === ourJobIdRef.current;

  return (
    <div className="flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Live job. `own` when it's the host job THIS phone started (the banner is then
          its progress UI); otherwise a heads-up that another surface is creating. */}
      <CreatorJobBanner job={creatorJob} own={ourJobRunning} />

      {/* Create on this host — only when a player is running. */}
      {hostAvailable && (
        <div className={card}>
          <h3 className="text-lg font-semibold mb-1">Create on this host ⚡</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Pick a song and the Loukai desktop machine will create the karaoke file on its GPU and
            add it to the library. You&apos;ll see progress here.
          </p>

          <input
            ref={srcInputRef}
            type="file"
            accept={AUDIO_ACCEPT}
            disabled={submitting || isRunning}
            onChange={(e) => pickSource(e.target.files?.[0])}
            className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-200 dark:file:bg-gray-700 file:text-gray-800 dark:file:text-gray-100 hover:file:bg-gray-300 dark:hover:file:bg-gray-600"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting || isRunning}
              placeholder="Title"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            />
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              disabled={submitting || isRunning}
              placeholder="Artist"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            />
          </div>

          <label className="block mt-2 text-sm text-gray-700 dark:text-gray-300">
            Lyrics language:
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={submitting || isRunning}
              className="ml-2 px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            >
              <option value="auto">Auto-detect</option>
              {WHISPER_LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={doHostCreate}
            disabled={submitting || isRunning || !srcFile}
            className="mt-4 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {ourJobRunning
              ? 'Creating on host…'
              : isRunning
                ? 'Another creation is running…'
                : submitting
                  ? 'Starting…'
                  : 'Create on host ⚡'}
          </button>

          {hostError && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-sm">
              ⚠ {hostError}
            </div>
          )}
          {hostDone && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm">
              ✓ Created <strong>{hostDone.fileName}</strong> and added it to the library.
            </div>
          )}
        </div>
      )}

      {/* Online creator (alternative — runs on YOUR device via HTTPS WebGPU). */}
      <div className={card}>
        <h3 className="text-lg font-semibold mb-1">
          {hostAvailable ? 'Or use the online creator' : 'Create karaoke files'}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {hostAvailable
            ? 'Prefer to create on this device instead? Use the free online creator, then import the finished file below.'
            : 'Create new karaoke files in the Loukai desktop app for the best results, or use the free online creator and import the finished file below.'}
        </p>
        <a
          href={ONLINE_CREATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium"
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
