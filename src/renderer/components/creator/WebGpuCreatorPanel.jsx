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

// All word-timestamped (onnx-community *_timestamped). Word-level timing is what
// karaoke needs — we group the words into lyric LINES (groupWordsIntoLines), which
// also fixes line-timing drift since each line's start/end come from real word
// timings, not Whisper's coarse segment timestamps. Larger = more accurate, more VRAM.
const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny_timestamped', label: 'tiny · fastest, least accurate' },
  { id: 'onnx-community/whisper-base_timestamped', label: 'base · fast (default)' },
  { id: 'onnx-community/whisper-small_timestamped', label: 'small · more accurate' },
  {
    id: 'onnx-community/whisper-large-v3-turbo_timestamped',
    label: 'large-v3-turbo · best (needs ~2GB+ VRAM)',
  },
];

// Demucs separation models (in-browser WebGPU). 'kind' selects the runner:
//   'single' = one htdemucs ONNX (demucs-web) — fast (~8× realtime on a good GPU).
//   'ft'     = htdemucs_ft 4-model fine-tuned ensemble — PyTorch-grade, ~2-3×
//              realtime (4× the compute). Default to the fast single model.
const DEMUCS_MODELS = [
  { id: 'htdemucs', kind: 'single', label: 'htdemucs · fast (~8× realtime, default)' },
  {
    id: 'htdemucs_ft',
    kind: 'ft',
    label: 'htdemucs_ft · best quality, 4-model (~2-3× realtime)',
  },
];

// Group word-level timestamps into lyric lines. Breaks on sentence punctuation,
// long pauses between words, or a max line length — each line's start/end is taken
// from its first/last word so line timing is accurate.
function groupWordsIntoLines(words, { maxGap = 1.0, maxWords = 10, maxDur = 8 } = {}) {
  const lines = [];
  let cur = null;
  for (const w of words) {
    const text = (w.text || '').trim();
    if (!text) continue;
    const [start, end] = w.timestamp || [w.start, w.end];
    if (start == null) continue;
    if (!cur) {
      cur = { text, start, end, n: 1 };
    } else {
      const gap = start - cur.end;
      const tooLong = cur.n >= maxWords || end - cur.start > maxDur;
      const endsSentence = /[.!?]$/.test(cur.text);
      if (gap > maxGap || tooLong || endsSentence) {
        lines.push({ text: cur.text.trim(), start: cur.start, end: cur.end });
        cur = { text, start, end, n: 1 };
      } else {
        // join (no space before clitics/punctuation)
        cur.text += /^[,.!?;:']/.test(text) ? text : ` ${text}`;
        cur.end = end;
        cur.n += 1;
      }
    }
  }
  if (cur) lines.push({ text: cur.text.trim(), start: cur.start, end: cur.end });
  return lines;
}

export default function WebGpuCreatorPanel() {
  const [gpu, setGpu] = useState('checking'); // checking | available | unavailable
  // Default to large-v3-turbo — most accurate; fits an 8GB GPU. Falls to a smaller
  // model only if the user picks one (e.g. low-VRAM machines).
  const [asrModel, setAsrModel] = useState('onnx-community/whisper-large-v3-turbo_timestamped');
  const [status, setStatus] = useState('idle'); // idle | separating | transcribing | done | error
  const [stemProgress, setStemProgress] = useState({}); // per-stem 0..1 (ft ensemble)
  // Demucs separation model — default to the fast single htdemucs.
  const [demucsModel, setDemucsModel] = useState('htdemucs');
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

  // transformers.js keys its environment detection off `typeof process`. In the
  // Electron renderer (nodeIntegration: true) `process` exists, so it WRONGLY
  // thinks it's Node.js → tries onnxruntime-node (not bundled) → its
  // InferenceSession is undefined → 'cannot read create' / 'Unsupported device'.
  // Fix: hide the Node globals for the duration of the import so it detects a
  // browser env (verified: enables the webgpu/wasm device branch + real inference).
  async function importTransformers(url) {
    const saved = {
      process: globalThis.process,
      module: globalThis.module,
      require: globalThis.require,
      global: globalThis.global,
    };
    try {
      delete globalThis.process;
      delete globalThis.module;
      delete globalThis.require;
      delete globalThis.global;
    } catch {
      /* ignore */
    }
    try {
      return await import(/* @vite-ignore */ url);
    } finally {
      globalThis.process = saved.process;
      globalThis.module = saved.module;
      globalThis.require = saved.require;
      globalThis.global = saved.global;
    }
  }

  async function loadLibs() {
    if (libs.current.ort) return libs.current;
    const base = assetBase();
    log('loading libraries from loukai (same-origin, backend-cached) …');
    // All from /webgpu-assets/* — never a CDN. Self-contained ESM bundles
    // (ort.webgpu.bundle.min.mjs has no sub-imports), so dynamic import works.
    // transformers.js is imported with Node globals hidden (see importTransformers).
    let ort, demucs, tf, ftEnsemble;
    try {
      [ort, demucs, tf, ftEnsemble] = await Promise.all([
        import(/* @vite-ignore */ `${base}/ort.webgpu.bundle.min.mjs`),
        import(/* @vite-ignore */ `${base}/demucs/index.js`),
        importTransformers(`${base}/transformers.min.js`),
        import(/* @vite-ignore */ `${base}/ft-ensemble.js`),
      ]);
    } catch (e) {
      throw new Error(
        `failed to load WebGPU libraries from loukai (${String(e.message).slice(0, 100)}). ` +
          `If the app was reloading, just try again.`
      );
    }
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
      demucs, // full module (prepareModelInput / standaloneMask / standaloneIspec)
      DemucsProcessor: demucs.DemucsProcessor,
      CONSTANTS: demucs.CONSTANTS,
      pipeline: tf.pipeline,
      ftEnsemble,
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
    setStemProgress({});
    setRtf(null);
    try {
      const { ort, demucs, ftEnsemble, pipeline, DemucsProcessor } = await loadLibs();
      const { STEMS, createEnsembleSessions, runEnsemble } = ftEnsemble;

      log(`decoding ${file.name} …`);
      const audio = await decodeAudio(file);

      // --- Demucs stem separation (in-browser, WebGPU) ---
      // The selected DEMUCS_MODELS entry's `kind` picks the runner:
      //   'single' = one htdemucs (demucs-web) — fast (~8× realtime).
      //   'ft'     = htdemucs_ft 4-model fine-tuned ensemble — PyTorch-grade, ~2-3×
      //              realtime (4× the compute); fp16 with the variance prologue pinned
      //              to CPU (forceCpuNodeNames) so fp16 doesn't NaN.
      const modelDef = DEMUCS_MODELS.find((m) => m.id === demucsModel) || DEMUCS_MODELS[0];
      setStemProgress({});
      const t0 = performance.now();
      let result;
      let modeLabel;
      if (modelDef.kind === 'ft') {
        modeLabel = 'htdemucs_ft (best)';
        log('loading htdemucs_ft ensemble (4 models) from loukai …');
        const cpuNodes = await fetch('/webgpu-models/ft_cpu_nodes.json')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const sessions = await createEnsembleSessions({
          ort,
          modelUrl: (stem) => `/webgpu-models/htdemucs_ft_${stem}_safe16.onnx`,
          cpuNodes,
          onLog: (m) => log(m),
        });
        log(`separating on webgpu — htdemucs_ft ensemble (${STEMS.length} stems) …`);
        const r = await runEnsemble({
          ort,
          sessions,
          proc: demucs,
          left: audio.left,
          right: audio.right,
          onStemProgress: (idx, frac) => setStemProgress((p) => ({ ...p, [STEMS[idx]]: frac })),
        });
        result = r.stems;
      } else {
        modeLabel = 'htdemucs (fast)';
        log('loading htdemucs (single model) from loukai …');
        const modelBuf = await fetch('/webgpu-models/htdemucs.onnx').then((res) => {
          if (!res.ok) throw new Error(`model fetch ${res.status}`);
          return res.arrayBuffer();
        });
        const proc = new DemucsProcessor({
          ort,
          sessionOptions: { executionProviders: gpu === 'available' ? ['webgpu'] : ['wasm'] },
          onProgress: ({ progress }) =>
            setStemProgress(STEMS.reduce((a, s) => ({ ...a, [s]: progress || 0 }), {})),
          onLog: (phase, m) => log(`[${phase}] ${m}`),
        });
        await proc.loadModel(modelBuf);
        log('separating on webgpu — htdemucs (single) …');
        result = await proc.separate(audio.left, audio.right);
      }
      const sec = (performance.now() - t0) / 1000;
      const realtime = audio.duration / sec;
      setRtf(realtime);
      log(
        `separation done in ${sec.toFixed(1)}s — ${realtime.toFixed(2)}× realtime [${modeLabel}]`
      );

      // --- Whisper transcription of the vocals stem (in-browser) ---
      setStatus('transcribing');
      const want = asrModel;
      // Device naming in transformers.js: 'webgpu' = GPU, 'cpu' = the WASM/CPU
      // backend ('wasm' is rejected). With the Node-globals fix above, the
      // timestamped models run on webgpu. Use GPU when available.
      const device = gpu === 'available' ? 'webgpu' : 'cpu';
      log(`loading Whisper model · ${want} · ${device} (first run downloads it) …`);
      // Surface model-download progress (v3-turbo is large) + fail loudly, so a
      // slow/large download or an OOM doesn't look like a frozen UI.
      const seenFiles = new Set();
      let asr;
      try {
        asr = await pipeline('automatic-speech-recognition', want, {
          device,
          progress_callback: (p) => {
            if (p.status === 'progress' && p.file && p.total) {
              const pct = Math.round((p.loaded / p.total) * 100);
              if (pct % 25 === 0 && !seenFiles.has(p.file + pct)) {
                seenFiles.add(p.file + pct);
                log(`  ↓ ${p.file} ${pct}%`);
              }
            }
          },
        });
      } catch (e) {
        throw new Error(
          `Whisper model "${want}" failed to load (${String(e.message).slice(0, 100)}). ` +
            `If it's large-v3-turbo, your GPU may be out of memory — try a smaller model.`
        );
      }
      log(`transcribing vocals · ${device} …`);
      const mono = toMono16k(result.vocals.left, result.vocals.right, audio.sampleRate);
      // Always get WORD-level timestamps, then group into lyric lines ourselves.
      const out = await asr(mono, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: 'word',
      });

      const words = out.chunks || [];
      const lines = words.length
        ? groupWordsIntoLines(words)
        : [{ text: (out.text || '').trim(), start: 0, end: audio.duration }];
      setLyrics(lines);
      setStatus('done');
      log(`done — ${words.length} words → ${lines.length} lyric lines`);
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
            Demucs model:
            <select
              className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              value={demucsModel}
              onChange={(e) => setDemucsModel(e.target.value)}
              disabled={busy}
            >
              {DEMUCS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Whisper model (word-timed → grouped into lines):
            <select
              className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
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
          <button
            onClick={run}
            disabled={busy}
            className="self-start px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Create (in-browser)'}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            First run downloads htdemucs (~172 MB) + the chosen Whisper model via loukai (cached
            locally afterwards). large-v3-turbo is most accurate but largest.
          </p>
        </div>

        {status === 'separating' && (
          <div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Separating stems ·{' '}
              {demucsModel === 'htdemucs_ft' ? 'htdemucs_ft (4 models)' : 'htdemucs'} on GPU…
            </div>
            <div className="flex flex-col gap-1.5">
              {['drums', 'bass', 'other', 'vocals'].map((stem) => {
                const frac = stemProgress[stem] || 0;
                const emoji = { drums: '🥁', bass: '🎸', other: '🎹', vocals: '🎤' }[stem];
                return (
                  <div key={stem} className="flex items-center gap-2">
                    <span className="w-20 text-xs text-gray-600 dark:text-gray-400">
                      {emoji} {stem}
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
        )}
        {status === 'transcribing' && (
          <div className="text-sm text-gray-600 dark:text-gray-400">Transcribing vocals…</div>
        )}
        {rtf !== null && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            separation: {rtf.toFixed(2)}× realtime · htdemucs_ft on WebGPU
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
