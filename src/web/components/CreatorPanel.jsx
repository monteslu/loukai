import { useEffect, useState, useRef } from 'react';

/**
 * CreatorPanel — web-admin song creation.
 *
 * Uses the bridge (never raw fetch) to: check component status, upload a NEW
 * file OR pick one from the songs folder, set metadata + processing device, and
 * start a conversion. Surfaces the SHARED job: if a conversion is already
 * running (from any surface, incl. the Electron app), it shows that live job and
 * blocks starting a second one — including when this page is opened mid-job.
 */
export default function CreatorPanel({ bridge }) {
  const [status, setStatus] = useState(null); // { components, job, ... }
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState(null); // {path,title,artist} or upload result
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [device, setDevice] = useState('auto');
  const [engine, setEngine] = useState('whisperx');
  const [uploadPct, setUploadPct] = useState(null);
  const [job, setJob] = useState(null);
  const [consoleLog, setConsoleLog] = useState([]);
  const [error, setError] = useState(null);
  const consoleEnd = useRef(null);

  const running = job?.status === 'running';

  // Pull-on-mount + subscribe so an already-running job (possibly started from
  // the Electron app or before this page opened) shows immediately.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        const st = await bridge.getCreatorStatus();
        setStatus(st);
        if (st?.job?.status === 'running') {
          setJob(st.job);
          if (Array.isArray(st.job.consoleTail)) setConsoleLog(st.job.consoleTail);
        }
      } catch (e) {
        setError(e.message);
      }
      try {
        const s = await bridge.getCreatorSources();
        setSources(s?.sources || []);
      } catch {
        /* sources optional */
      }
      unsub = bridge.onCreatorEvent?.((kind, payload) => {
        if (kind === 'job') setJob(payload);
        else if (kind === 'console' && payload?.line) {
          setConsoleLog((prev) => [...prev.slice(-200), payload.line]);
        } else if (kind === 'complete') {
          setJob((j) => (j ? { ...j, status: 'complete', progress: 100 } : j));
        } else if (kind === 'error') {
          setError(payload?.error || 'Conversion failed');
        }
      });
    })();
    return () => unsub();
  }, [bridge]);

  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLog]);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadPct(0);
    try {
      const res = await bridge.uploadCreatorFile(file, setUploadPct);
      setSelected({ path: res.path });
      const meta = res.info?.metadata || res.info || {};
      setTitle(meta.title || file.name.replace(/\.[^.]+$/, ''));
      setArtist(meta.artist || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadPct(null);
    }
  };

  const pickSource = (s) => {
    setSelected({ path: s.path });
    setTitle(s.title || '');
    setArtist(s.artist || '');
  };

  const start = async () => {
    if (!selected?.path) return;
    setError(null);
    setConsoleLog([]);
    try {
      const res = await bridge.startConversion({
        inputPath: selected.path,
        title,
        artist,
        device,
        transcriptionEngine: engine,
      });
      if (res.busy) {
        setJob(res.job);
        setError('A conversion is already running — showing its progress.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const cancel = async () => {
    try {
      await bridge.cancelConversion();
    } catch (err) {
      setError(err.message);
    }
  };

  const componentsReady = status?.components?.allInstalled ?? status?.allInstalled;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Create Karaoke</h2>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 px-4 py-2 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Already-running banner (cross-surface) */}
      {running && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 px-4 py-3 text-sm text-blue-900 dark:text-blue-100">
          <div className="font-medium">
            🎵 Conversion running
            {job.source && job.source !== 'web' ? ` (started from the ${job.source} app)` : ''}
            {job.title ? `: ${job.title}` : ''}
          </div>
          <div className="mt-1 h-2 w-full rounded bg-blue-200 dark:bg-blue-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-400 transition-all"
              style={{ width: `${job.progress || 0}%` }}
            />
          </div>
          <div className="mt-1 text-xs">
            {job.step || 'working'} — {job.progress || 0}%
          </div>
          <button
            onClick={cancel}
            className="mt-2 px-3 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700"
          >
            Cancel
          </button>
        </div>
      )}

      {!componentsReady && status && (
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 px-4 py-2 text-sm text-yellow-900 dark:text-yellow-100">
          Creator components are not installed on the server. Install them from the desktop app, or{' '}
          <button className="underline" onClick={() => bridge.installCreatorComponents()}>
            install now
          </button>
          .
        </div>
      )}

      {/* Source selection (hidden while a job runs) */}
      {!running && (
        <>
          <div className="rounded-lg border border-gray-300 dark:border-gray-600 p-4">
            <h3 className="font-medium mb-2 text-gray-900 dark:text-gray-100">1. Choose audio</h3>
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
              Upload a file:
              <input
                type="file"
                accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4,.mkv,.avi,.mov,.webm"
                onChange={onUpload}
                className="block mt-1 text-sm"
              />
            </label>
            {uploadPct !== null && (
              <div className="text-xs text-gray-500">Uploading… {uploadPct}%</div>
            )}
            {sources.length > 0 && (
              <div className="mt-3">
                <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                  …or pick from your library:
                </div>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                  onChange={(e) => {
                    const s = sources[Number(e.target.value)];
                    if (s) pickSource(s);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a source file…
                  </option>
                  {sources.map((s, i) => (
                    <option key={s.path} value={i}>
                      {s.artist ? `${s.artist} - ` : ''}
                      {s.title || s.path}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selected && (
              <div className="mt-2 text-xs text-green-700 dark:text-green-400">✓ File ready</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-300 dark:border-gray-600 p-4">
            <h3 className="font-medium mb-2 text-gray-900 dark:text-gray-100">2. Details</h3>
            <input
              className="w-full mb-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="w-full mb-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              placeholder="Artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
            />
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-2">
              Processing device:
              <select
                className="w-full mt-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="auto">Auto (recommended)</option>
                <option value="rocm">AMD GPU (ROCm)</option>
                <option value="cuda">NVIDIA GPU (CUDA)</option>
                <option value="mps">Apple GPU (Metal)</option>
                <option value="cpu">CPU (slowest)</option>
              </select>
            </label>
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Lyric timing:
              <select
                className="w-full mt-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
              >
                <option value="whisperx">Precise alignment (recommended)</option>
                <option value="whisper">Standard (faster)</option>
              </select>
            </label>
          </div>

          <button
            disabled={!selected?.path || !title}
            onClick={start}
            className="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Karaoke File
          </button>
        </>
      )}

      {/* Console output */}
      {consoleLog.length > 0 && (
        <div className="rounded-lg bg-gray-900 text-gray-100 p-3 text-xs font-mono h-48 overflow-auto">
          {consoleLog.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
          <div ref={consoleEnd} />
        </div>
      )}
    </div>
  );
}
