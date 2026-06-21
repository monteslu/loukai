import { useEffect, useRef, useState } from 'react';

/**
 * WebGPU Creator (experimental) — runs Demucs stem separation + Whisper
 * transcription FULLY IN-BROWSER, no Python/PyTorch. WebGPU primary, WASM/CPU
 * fallback. Stack (proven by the JIG bench):
 *   - demucs-web (DemucsProcessor) → htdemucs ONNX via onnxruntime-web webgpu
 *   - @huggingface/transformers (transformers.js) → Whisper via WebGPU
 * Goal: prove loukai can drop the native Python creator entirely.
 *
 * Libs load from CDN at runtime (kept out of the Vite bundle), exactly like the
 * standalone experiment; the browser caches the models after first run.
 */

// ALL assets (JS libs, WASM, models) are served SAME-ORIGIN by loukai's backend
// from /webgpu-assets/* — the UI never fetches from external sites (avoids
// CORS/COEP in the web admin; works offline once the backend has cached them).
// The backend (webgpuAssets.js) downloads + caches them on first request.
//
// The renderer (and the web admin) are BOTH served over http by loukai's own
// server, so assets are same-origin: just use relative paths. (If we ever end up
// on a file:// origin the fetch will fail loudly, which is the correct signal
// that the renderer wasn't served over http.)
function assetBase() {
  return '/webgpu-assets';
}

const WHISPER_MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'tiny.en · fast' },
  { id: 'Xenova/whisper-base.en', label: 'base.en · balanced' },
  { id: 'Xenova/whisper-small.en', label: 'small.en · best (slow)' },
  { id: 'Xenova/whisper-base', label: 'base · multilingual' },
];

export default function WebGpuCreatorPanel() {
  const [gpu, setGpu] = useState('checking'); // checking | available | unavailable
  const [asrModel, setAsrModel] = useState('Xenova/whisper-base.en');
  const [wordMode, setWordMode] = useState(true);
  const [status, setStatus] = useState('idle'); // idle | separating | transcribing | done | error
  const [sepProgress, setSepProgress] = useState(0);
  const [logLines, setLogLines] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [rtf, setRtf] = useState(null);
  const fileRef = useRef(null);
  const libs = useRef({}); // cached dynamic imports
  const logEnd = useRef(null);

  const log = (m) =>
    setLogLines((p) => [...p.slice(-150), `${new Date().toLocaleTimeString()}  ${m}`]);

  useEffect(() => {
    (async () => {
      try {
        if (!navigator.gpu) {
          setGpu('unavailable');
          log('navigator.gpu not present — will use WASM (much slower)');
          return;
        }
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        setGpu(adapter ? 'available' : 'unavailable');
        log(adapter ? 'WebGPU available ✓' : 'WebGPU adapter null — WASM fallback');
      } catch (e) {
        setGpu('unavailable');
        log(`WebGPU check failed: ${e.message}`);
      }
    })();
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  const backend = () => (gpu === 'available' ? 'webgpu' : 'wasm');
  // When the GPU is available, request WebGPU ONLY (no wasm fallback in the list).
  // ORT-web silently drops to wasm if 'webgpu','wasm' are both listed and webgpu
  // init fails — which hides whether the GPU was actually used. Forcing
  // ['webgpu'] makes a real failure throw, so we KNOW. We retry on wasm in run().
  const eps = () => (gpu === 'available' ? ['webgpu'] : ['wasm']);

  async function loadLibs() {
    if (libs.current.ort) return libs.current;
    const base = assetBase();
    log('loading libraries from loukai (same-origin, backend-cached) …');
    // All from /webgpu-assets/* — never a CDN. Self-contained ESM bundles
    // (ort.webgpu.bundle.min.mjs has no sub-imports), so dynamic import works.
    const [ort, demucs, tf] = await Promise.all([
      import(/* @vite-ignore */ `${base}/ort.webgpu.bundle.min.mjs`),
      import(/* @vite-ignore */ `${base}/demucs/index.js`),
      import(/* @vite-ignore */ `${base}/transformers.min.js`),
    ]);
    try {
      // WASM artifacts also served by us.
      if (ort.env?.wasm) {
        ort.env.wasm.wasmPaths = `${base}/`;
        // SIMD is built into the artifact we serve (ort-wasm-simd-threaded). THREADS
        // additionally require cross-origin isolation (COOP+COEP → SharedArrayBuffer);
        // otherwise fall back to a single thread. Mirror the JIG bench.
        const isolated = self.crossOriginIsolated === true;
        const threads = isolated ? navigator.hardwareConcurrency || 4 : 1;
        ort.env.wasm.numThreads = threads;
        log(
          `WASM: SIMD on, ${threads} thread${threads === 1 ? '' : 's'}` +
            (isolated ? '' : ' (not cross-origin-isolated → single-threaded)')
        );
      }
      if (ort.env?.webgpu) ort.env.webgpu.powerPreference = 'high-performance';
      // Verbose ORT logging so the devtools console shows the real EP/device init
      // (e.g. "[WebGPU] ..."), confirming whether the GPU was actually used.
      try {
        ort.env.logLevel = 'info';
        if (ort.env.webgpu) ort.env.webgpu.profiling = { mode: 'off' };
      } catch {
        /* ignore */
      }
      // transformers.js: pull models through loukai too (no HuggingFace from UI).
      if (tf.env) {
        tf.env.allowRemoteModels = true;
        // transformers.js requests {remoteHost}{model}/resolve/{revision}/{file};
        // our /webgpu-models/* proxy passes that whole path through to HuggingFace.
        tf.env.remoteHost = '/webgpu-models/';
        tf.env.remotePathTemplate = '{model}/resolve/{revision}/';
        // transformers.js bundles its OWN onnxruntime-web → point its wasm at us too.
        if (tf.env.backends?.onnx?.wasm) tf.env.backends.onnx.wasm.wasmPaths = `${base}/`;
      }
    } catch {
      /* ignore */
    }
    libs.current = {
      ort,
      base,
      DemucsProcessor: demucs.DemucsProcessor,
      CONSTANTS: demucs.CONSTANTS,
      pipeline: tf.pipeline,
    };
    return libs.current;
  }

  // Decode an uploaded file into stereo Float32 channel data via WebAudio.
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

  // Downmix to mono 16k for Whisper.
  function toMono16k(left, right, sampleRate) {
    const n = left.length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) * 0.5;
    if (sampleRate === 16000) return mono;
    const ratio = sampleRate / 16000;
    const outLen = Math.floor(n / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = mono[Math.floor(i * ratio)] || 0;
    return out;
  }

  async function run() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setStatus('separating');
    setLyrics([]);
    setSepProgress(0);
    setRtf(null);
    try {
      const { ort, DemucsProcessor, pipeline } = await loadLibs();

      log(`decoding ${file.name} …`);
      const audio = await decodeAudio(file);

      // Demucs ONNX weights via loukai's backend (cached), not the CDN/HF.
      log('fetching htdemucs model from loukai (cached) …');
      const modelBuf = await fetch('/webgpu-models/htdemucs.onnx').then((r) => {
        if (!r.ok) throw new Error(`model fetch ${r.status}`);
        return r.arrayBuffer();
      });

      // --- Demucs stem separation (in-browser) ---
      // Try WebGPU first with NO wasm fallback in the EP list, so a GPU failure
      // throws here (instead of ORT silently running on CPU and us claiming GPU).
      // Only if that throws do we fall back to wasm, and we SAY so.
      let usedBackend = backend();
      const makeProc = (executionProviders) =>
        new DemucsProcessor({
          ort,
          sessionOptions: { executionProviders },
          onProgress: ({ progress }) => setSepProgress(progress || 0),
          onLog: (phase, m) => log(`[${phase}] ${m}`),
        });
      let proc;
      try {
        log(`separating on ${usedBackend} (verifying EP) …`);
        proc = makeProc(eps());
        await proc.loadModel(modelBuf);
      } catch (e) {
        if (usedBackend === 'webgpu') {
          log(`⚠️ WebGPU EP failed (${String(e.message).slice(0, 80)}) — falling back to WASM/CPU`);
          usedBackend = 'wasm';
          setSepProgress(0);
          proc = makeProc(['wasm']);
          await proc.loadModel(modelBuf);
        } else {
          throw e;
        }
      }
      const t0 = performance.now();
      const result = await proc.separate(audio.left, audio.right);
      const sec = (performance.now() - t0) / 1000;
      setRtf(audio.duration / sec);
      log(
        `separation done in ${sec.toFixed(1)}s — ${(audio.duration / sec).toFixed(2)}× realtime` +
          ` [ran on: ${usedBackend.toUpperCase()}]`
      );

      // --- Whisper transcription of the vocals stem (in-browser) ---
      setStatus('transcribing');
      const want = wordMode ? 'onnx-community/whisper-base_timestamped' : asrModel;
      // Device naming in transformers.js: 'webgpu' runs on the GPU; 'cpu' is the
      // WASM/CPU backend (NOT 'wasm' — that's rejected). The whisper_timestamped
      // model only offers cuda/cpu variants → use 'cpu'. Regular Xenova/whisper-*
      // support 'webgpu'.
      const device = wordMode ? 'cpu' : gpu === 'available' ? 'webgpu' : 'cpu';
      log(`transcribing vocals · ${want} · ${device} …`);
      const asr = await pipeline('automatic-speech-recognition', want, { device });
      const mono = toMono16k(result.vocals.left, result.vocals.right, audio.sampleRate);
      const out = await asr(mono, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: wordMode ? 'word' : true,
      });

      // Normalize to lines with timing.
      const chunks = out.chunks || [];
      const lines = chunks.length
        ? chunks.map((c) => ({
            text: c.text?.trim() || '',
            start: c.timestamp?.[0] ?? null,
            end: c.timestamp?.[1] ?? null,
          }))
        : [{ text: (out.text || '').trim(), start: 0, end: audio.duration }];
      setLyrics(lines);
      setStatus('done');
      log(`done — ${lines.length} ${wordMode ? 'words' : 'lines'}`);
    } catch (e) {
      console.error(e);
      log(`ERROR: ${e.message}`);
      setStatus('error');
    }
  }

  const busy = status === 'separating' || status === 'transcribing';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Creator (WebGPU) — experimental
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Stem separation + transcription run entirely in your browser. No Python.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600 dark:text-gray-400">WebGPU:</span>
          <span
            className={
              gpu === 'available'
                ? 'text-teal-600 dark:text-teal-400 font-medium'
                : gpu === 'unavailable'
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-gray-400'
            }
          >
            {gpu}
            {gpu === 'unavailable' ? ' (WASM fallback — slower)' : ''}
          </span>
        </div>

        <div className="rounded-lg border border-gray-300 dark:border-gray-600 p-4 flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4"
            className="text-sm"
            disabled={busy}
          />
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Whisper model:
            <select
              className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              value={asrModel}
              onChange={(e) => setAsrModel(e.target.value)}
              disabled={busy || wordMode}
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={wordMode}
              onChange={(e) => setWordMode(e.target.checked)}
              disabled={busy}
            />
            Word-level timing (whisper-base_timestamped)
          </label>
          <button
            onClick={run}
            disabled={busy}
            className="self-start px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Create (in-browser)'}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            First run downloads htdemucs (~172 MB) + the whisper model from CDN/HuggingFace, then
            the browser caches them.
          </p>
        </div>

        {status === 'separating' && (
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Separating stems…</div>
            <div className="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${(sepProgress * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
        {status === 'transcribing' && (
          <div className="text-sm text-gray-600 dark:text-gray-400">Transcribing vocals…</div>
        )}
        {rtf !== null && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            separation: {rtf.toFixed(2)}× realtime ({backend()})
          </div>
        )}

        {lyrics.length > 0 && (
          <div className="rounded-lg border border-gray-300 dark:border-gray-600 p-4 max-h-64 overflow-auto">
            <h3 className="font-medium mb-2 text-gray-900 dark:text-gray-100">Lyrics</h3>
            <div className="text-sm space-y-0.5 font-mono">
              {lyrics.map((l, i) => (
                <div key={i} className="text-gray-700 dark:text-gray-300">
                  {l.start != null && (
                    <span className="text-gray-400 mr-2">[{l.start.toFixed(2)}]</span>
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
      </div>
    </div>
  );
}
