import { useEffect, useRef, useState } from 'react';
// Browser-safe submodules only (the 'stem-mp4' barrel pulls in the Node-only reader).
// These deep paths are aliased to the package's writer.js / atoms.js in vite.config.js.
import StemMp4Writer from 'stem-mp4/writer';
import * as Atoms from 'stem-mp4/atoms';
import { WHISPER_MODELS, DEMUCS_MODELS, encodeWav } from '../shared/creator/creatorAudio.js';
import { encodeWavToAac } from '../shared/creator/aacEncoder.js';
import { createKaraoke } from '../shared/creator/createKaraoke.js';
import { loadCreatorLibs, detectWebGpu } from '../shared/creator/creatorLibs.js';
import {
  STYLES,
  Spinner,
  ErrorDisplay,
  StemProgressBars,
} from '../shared/components/creatorUi.jsx';

/**
 * Offsite WebGPU creator (karaoke-creator.loukai.com). A STANDALONE static app: it runs
 * the SAME compute engine as the loukai desktop creator (createKaraoke + creatorLibs),
 * but with no Node backend — so instead of POSTing stems to a server, it muxes the
 * .stem.mp4 IN THE BROWSER (StemMp4Writer returns a buffer) and offers it as a download.
 * The user then imports that file into loukai's web admin ("Import a .stem.mp4").
 *
 * Why this exists: WebGPU needs a secure context. A phone on http://<LAN-IP> has none →
 * it commands the host instead (the in-app host-create path). This offsite app is the
 * OTHER escape hatch: an HTTPS page that runs WebGPU on the visitor's OWN device — handy
 * when there's no loukai host running, or to offload creation to a beefier machine.
 *
 * Asset hosting: createKaraoke/creatorLibs fetch /webgpu-assets/* + /webgpu-models/*
 * (same-origin). The offsite deployment must serve those paths too (see docs).
 */

export default function OffsiteCreator() {
  const [gpu, setGpu] = useState('checking'); // checking | available | unavailable
  const [fileName, setFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState('idle'); // idle|separating|transcribing|pitch|saving|done|error
  const [stemProgress, setStemProgress] = useState({});
  const [transcribeInfo, setTranscribeInfo] = useState('');
  const [lyrics, setLyrics] = useState([]);
  const [logLines, setLogLines] = useState([]);
  const [error, setError] = useState(null);
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadName, setDownloadName] = useState('');
  // Settings (subset of the in-app creator — sane defaults; this audience is casual).
  const [asrModel, setAsrModel] = useState('onnx-community/whisper-large-v3-turbo_timestamped');
  const [demucsModel, setDemucsModel] = useState('htdemucs');
  const [language, setLanguage] = useState('en');
  const [enableCrepe, setEnableCrepe] = useState(true);

  const fileRef = useRef(null);
  const selectedFileRef = useRef(null);
  const logEnd = useRef(null);

  const log = (m) =>
    setLogLines((p) => [...p.slice(-150), `${new Date().toLocaleTimeString()}  ${m}`]);

  useEffect(() => {
    detectWebGpu().then((ok) => {
      setGpu(ok ? 'available' : 'unavailable');
      log(ok ? 'WebGPU available ✓' : 'navigator.gpu unavailable — will use WASM (much slower)');
    });
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  // Revoke any object URL when it changes/unmounts (avoid leaking blobs).
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  async function decodeAudio(file) {
    const arr = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(arr);
    const left = buf.getChannelData(0);
    const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0);
    return {
      left: Float32Array.from(left),
      right: Float32Array.from(right),
      sampleRate: buf.sampleRate,
      duration: buf.duration,
    };
  }

  function onFileSelect(dropped = null) {
    const file = dropped || fileRef.current?.files?.[0];
    if (!file) return;
    selectedFileRef.current = file;
    setFileName(file.name);
    setDownloadUrl(null);
    setError(null);
    setStatus('idle');
    setLyrics([]);
    // Prefill title/artist from "Artist - Title.ext".
    const base = file.name.replace(/\.[^.]+$/, '');
    const dash = base.match(/^(.+?)\s*-\s*(.+)$/);
    if (dash) {
      setArtistIfEmpty(dash[1].trim());
      setTitleIfEmpty(dash[2].trim());
    } else {
      setTitleIfEmpty(base);
    }
  }
  const setTitleIfEmpty = (v) => setSongTitle((cur) => cur || v);
  const setArtistIfEmpty = (v) => setSongArtist((cur) => cur || v);

  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) onFileSelect(f);
  }

  async function run() {
    const file = selectedFileRef.current || fileRef.current?.files?.[0];
    if (!file) return;
    setStatus('separating');
    setError(null);
    setLyrics([]);
    setStemProgress({});
    setDownloadUrl(null);
    try {
      const libs = await loadCreatorLibs(log);
      log(`decoding ${file.name} …`);
      const audio = await decodeAudio(file);
      const device = gpu === 'available' ? 'webgpu' : 'wasm';

      const created = await createKaraoke(
        { audio },
        { asrModel, demucsModel, ftAvailable: false, device, language, enableCrepe },
        libs,
        {
          onPhase: (p) => setStatus(p),
          onLog: log,
          onStemProgress: (p) => setStemProgress((prev) => ({ ...prev, ...p })),
          onTranscribeInfo: setTranscribeInfo,
          onLyricsPreview: setLyrics,
          onRtf: () => {},
        }
      );

      // --- Encode stems → AAC, mux the .stem.mp4 IN-BROWSER, offer a download. ---
      setStatus('saving');
      log('encoding stems to AAC (ffmpeg-wasm) …');
      const result = created.stems;
      const sr = audio.sampleRate;
      const wavBlobs = {
        master: encodeWav(audio.left, audio.right, sr),
        drums: encodeWav(result.drums.left, result.drums.right, sr),
        bass: encodeWav(result.bass.left, result.bass.right, sr),
        other: encodeWav(result.other.left, result.other.right, sr),
        vocals: encodeWav(result.vocals.left, result.vocals.right, sr),
      };
      const aac = {};
      for (const k of Object.keys(wavBlobs)) {
        aac[k] = await encodeWavToAac(wavBlobs[k]);
      }

      const artist = songArtist.trim();
      const title = songTitle.trim() || file.name.replace(/\.[^.]+$/, '');
      log('muxing .stem.mp4 in the browser …');
      const written = await StemMp4Writer.write({
        stemsAac: { drums: aac.drums, bass: aac.bass, other: aac.other, vocals: aac.vocals },
        mixdownAac: aac.master,
        metadata: { title, artist, key: created.key || undefined },
        lyricsData: created.lyrics?.lines?.length ? { lines: created.lyrics.lines } : undefined,
        encoderDelaySamples: 1024, // ffmpeg-wasm aac priming
      });
      let bytes = written.data;

      // Pitch track (best-effort; key already went in via metadata). Browser buffer API.
      if (created.pitch?.data?.length) {
        try {
          bytes = Atoms.writeVpchAtomBuffer(bytes, created.pitch);
        } catch (e) {
          log(`pitch atom skipped (${e.message})`);
        }
      }

      const safe = (artist ? `${artist} - ${title}` : title).replace(/[<>:"/\\|?*]/g, '_');
      const name = `${safe}.stem.mp4`;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      setDownloadUrl(url);
      setDownloadName(name);
      setStatus('done');
      log(
        `✅ done — ${name} (${(bytes.length / 1e6).toFixed(1)} MB). Download + import into Loukai.`
      );
    } catch (e) {
      console.error(e);
      log(`ERROR: ${e.message}`);
      setError(e.message || 'Creation failed');
      setStatus('error');
    }
  }

  const busy = ['separating', 'transcribing', 'pitch', 'saving'].includes(status);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <div className="max-w-3xl mx-auto p-6 flex flex-col gap-6">
        <header className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">Loukai Karaoke Creator ⚡</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Make a karaoke file in your browser — runs entirely on your device. Download it, then
              import into Loukai.
            </p>
          </div>
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              gpu === 'available'
                ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300'
                : gpu === 'unavailable'
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}
          >
            {gpu === 'available'
              ? '⚡ WebGPU'
              : gpu === 'unavailable'
                ? 'WASM (slower)'
                : 'checking…'}
          </span>
        </header>

        <ErrorDisplay error={error} onDismiss={() => setError(null)} />

        {/* Drop zone */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={busy ? (e) => e.preventDefault() : onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
            dragActive
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'
          } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div className="text-4xl">{fileName ? '🎵' : '⬆️'}</div>
          <div className="font-medium">
            {fileName || 'Drop an audio file here, or click to browse'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            mp3 · wav · flac · m4a · mp4
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4,.mkv,.mov,.webm"
            className="hidden"
            disabled={busy}
            onChange={() => onFileSelect()}
          />
        </label>

        {/* Title / Artist */}
        <div className={`${STYLES.card} grid grid-cols-1 sm:grid-cols-2 gap-2`}>
          <label className={STYLES.label}>
            Title
            <input
              type="text"
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              disabled={busy}
              placeholder="Song title"
              className={STYLES.input}
            />
          </label>
          <label className={STYLES.label}>
            Artist
            <input
              type="text"
              value={songArtist}
              onChange={(e) => setSongArtist(e.target.value)}
              disabled={busy}
              placeholder="Artist"
              className={STYLES.input}
            />
          </label>
        </div>

        {/* Settings (compact) */}
        <details className={STYLES.card}>
          <summary className="cursor-pointer font-medium">Settings</summary>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <label>
              Separation model:
              <select
                className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
                value={demucsModel}
                onChange={(e) => setDemucsModel(e.target.value)}
                disabled={busy}
              >
                {DEMUCS_MODELS.filter((m) => m.kind !== 'ft').map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transcription model:
              <select
                className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
                value={asrModel}
                onChange={(e) => setAsrModel(e.target.value)}
                disabled={busy}
              >
                {WHISPER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Language:
              <select
                className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={busy}
              >
                {['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'auto'].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={enableCrepe}
                onChange={(e) => setEnableCrepe(e.target.checked)}
                disabled={busy}
              />
              Detect pitch + musical key
            </label>
          </div>
        </details>

        <button onClick={run} disabled={busy || !fileName} className={STYLES.btnPrimary}>
          {busy ? 'Working…' : 'Create Karaoke ⚡'}
        </button>

        {busy && (
          <div className={STYLES.card}>
            {status === 'separating' && (
              <StemProgressBars progress={stemProgress} label="Separating stems…" />
            )}
            {status !== 'separating' && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <span className="inline-block animate-pulse">●</span>{' '}
                {status === 'transcribing'
                  ? transcribeInfo || 'Transcribing vocals…'
                  : status === 'pitch'
                    ? 'Detecting pitch + key…'
                    : 'Encoding + muxing .stem.mp4…'}
              </div>
            )}
          </div>
        )}

        {status === 'done' && downloadUrl && (
          <div className={`${STYLES.card} flex flex-col gap-3`}>
            <div className="text-lg font-semibold text-green-700 dark:text-green-400">
              ✅ Karaoke file ready
            </div>
            <a href={downloadUrl} download={downloadName} className={STYLES.btnPrimary}>
              ⬇️ Download {downloadName}
            </a>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Open Loukai → web admin → <strong>Create</strong> tab →{' '}
              <strong>Import a .stem.mp4</strong>, and choose this file to add it to your library.
            </p>
          </div>
        )}

        {lyrics.length > 0 && (
          <div className={`${STYLES.card} max-h-72 overflow-auto`}>
            <h3 className={STYLES.sectionTitle}>Lyrics</h3>
            <div className="text-sm space-y-0.5 font-mono">
              {lyrics.map((l, i) => (
                <div key={i} className="text-gray-700 dark:text-gray-300">
                  {l.start != null && (
                    <span className="text-gray-400 mr-2">[{l.start.toFixed(1)}]</span>
                  )}
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {logLines.length > 0 && (
          <div className="rounded-lg bg-gray-900 text-gray-100 p-3 text-xs font-mono h-40 overflow-auto">
            {logLines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {l}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        )}

        {gpu === 'checking' && <Spinner message="Checking your GPU…" />}
      </div>
    </div>
  );
}
