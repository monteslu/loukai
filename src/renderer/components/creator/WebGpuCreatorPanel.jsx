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
// All run via q4f16 on WebGPU (4-bit weights + fp16 compute) — fast even for
// large-v3-turbo (~13× realtime; fp32 was unusable). Bigger = more accurate.
const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny_timestamped', label: 'tiny · fastest' },
  { id: 'onnx-community/whisper-base_timestamped', label: 'base · fast' },
  { id: 'onnx-community/whisper-small_timestamped', label: 'small · more accurate' },
  {
    id: 'onnx-community/whisper-large-v3-turbo_timestamped',
    label: 'large-v3-turbo · best (q4f16, ~13× realtime)',
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

// Encode stereo Float32 channels → a 16-bit PCM WAV Blob (for upload to the
// backend, which transcodes to AAC + muxes the .stem.mp4).
function encodeWav(left, right, sampleRate = 44100) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4); // 16-bit stereo
  const v = new DataView(buf);
  const ws = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); // byte rate
  v.setUint16(32, 4, true); // block align
  v.setUint16(34, 16, true); // bits
  ws(36, 'data');
  v.setUint32(40, n * 4, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    v.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    v.setInt16(off + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    off += 4;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

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
  // Default to large-v3-turbo — most accurate AND fast via q4f16 on WebGPU
  // (~13× realtime). The earlier slowness was a dtype bug: WebGPU defaulted to the
  // 2.5GB fp32 ONNX; q4f16 fixes it. Smaller models stay available for low-VRAM.
  const [asrModel, setAsrModel] = useState('onnx-community/whisper-large-v3-turbo_timestamped');
  const [status, setStatus] = useState('idle'); // idle | separating | transcribing | done | error
  const [stemProgress, setStemProgress] = useState({}); // per-stem 0..1 (ft ensemble)
  // Demucs separation model — default to the fast single htdemucs.
  const [demucsModel, setDemucsModel] = useState('htdemucs');
  const [ftAvailable, setFtAvailable] = useState(true); // htdemucs_ft models present?
  const [transcribeInfo, setTranscribeInfo] = useState(''); // live transcription status
  const [logLines, setLogLines] = useState([]);
  const [lyrics, setLyrics] = useState([]);
  const [rtf, setRtf] = useState(null);
  // Lyric-assist (parity with native creator): title/artist for LRCLIB lookup,
  // reference lyrics (Whisper prompt + LLM correction source), correction stats.
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [referenceLyrics, setReferenceLyrics] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [llmStats, setLlmStats] = useState(null);
  // LLM settings (powers correction). Loaded from backend on mount; saved/tested
  // via the same dual-path (IPC in Electron, REST in web admin).
  const [llmSettings, setLlmSettings] = useState({
    enabled: true,
    provider: 'lmstudio',
    model: '',
    apiKey: '',
    baseUrl: 'http://localhost:1234/v1',
  });
  const [showLlm, setShowLlm] = useState(false);
  const [llmTest, setLlmTest] = useState(null);
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

  // Is the htdemucs_ft 'best quality' ensemble installed? (not hosted yet — absent
  // on fresh machines). If not, disable that option so 'best' never fails mid-run.
  useEffect(() => {
    fetch('/webgpu-assets/ft-available')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => setFtAvailable(Boolean(d.available)))
      .catch(() => setFtAvailable(false));
  }, []);

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
      tf, // full transformers.js module (for WhisperTextStreamer)
      ftEnsemble,
    };
    return libs.current;
  }

  // Dual-path call to a creator service: IPC in the Electron player (no admin HTTP
  // session there), authed REST in the web admin. ipcFn = (payload)=>Promise,
  // restPath = '/admin/creator/...'. Mirrors the save flow.
  async function creatorCall(ipcMethod, restPath, payload) {
    const api = window.kaiAPI?.creator;
    if (api?.[ipcMethod]) return api[ipcMethod](payload);
    const res = await fetch(restPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `request failed (${res.status})`);
    }
    return res.json();
  }

  // Look up reference lyrics from LRCLIB (title/artist) — fills the reference field,
  // which sharpens transcription (Whisper prompt) and powers LLM correction.
  async function lookupLyrics() {
    if (!songTitle) {
      log('enter a title (and artist) to look up lyrics');
      return;
    }
    setLookingUp(true);
    try {
      log(`looking up lyrics: ${songArtist ? songArtist + ' - ' : ''}${songTitle} …`);
      const r = await creatorCall('searchLyrics', '/admin/creator/search-lyrics', {
        title: songTitle,
        artist: songArtist,
      });
      const plain = r?.plainLyrics || r?.lyrics?.plainLyrics || '';
      if (plain) {
        setReferenceLyrics(plain);
        log(
          `found lyrics (${plain.split('\n').length} lines) — will guide transcription + correction`
        );
      } else {
        log('no lyrics found for that title/artist');
      }
    } catch (e) {
      log(`lyric lookup failed: ${e.message}`);
    } finally {
      setLookingUp(false);
    }
  }

  // Load LLM settings on mount (IPC or REST GET).
  useEffect(() => {
    (async () => {
      try {
        const api = window.kaiAPI?.creator;
        let s;
        if (api?.getLLMSettings) s = await api.getLLMSettings();
        else {
          const r = await fetch('/admin/creator/llm-settings', { credentials: 'include' });
          if (r.ok) s = await r.json();
        }
        if (s) setLlmSettings((prev) => ({ ...prev, ...s }));
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  async function saveLlmSettings() {
    try {
      const api = window.kaiAPI?.creator;
      if (api?.saveLLMSettings) await api.saveLLMSettings(llmSettings);
      else {
        await fetch('/admin/creator/llm-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(llmSettings),
          credentials: 'include',
        });
      }
      log('LLM settings saved');
    } catch (e) {
      log(`failed to save LLM settings: ${e.message}`);
    }
  }

  async function testLlm() {
    setLlmTest({ testing: true });
    try {
      const api = window.kaiAPI?.creator;
      let r;
      if (api?.testLLMConnection) r = await api.testLLMConnection(llmSettings);
      else {
        const res = await fetch('/admin/creator/llm-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(llmSettings),
          credentials: 'include',
        });
        r = await res.json();
      }
      setLlmTest(r);
      log(r?.success ? '✓ LLM connection OK' : `✗ LLM test failed: ${r?.error || ''}`);
    } catch (e) {
      setLlmTest({ success: false, error: e.message });
      log(`LLM test failed: ${e.message}`);
    }
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
      const { ort, demucs, ftEnsemble, pipeline, tf, DemucsProcessor } = await loadLibs();
      const { STEMS, createEnsembleSessions, runEnsemble } = ftEnsemble;

      log(`decoding ${file.name} …`);
      const audio = await decodeAudio(file);

      // --- Demucs stem separation (in-browser, WebGPU) ---
      // The selected DEMUCS_MODELS entry's `kind` picks the runner:
      //   'single' = one htdemucs (demucs-web) — fast (~8× realtime).
      //   'ft'     = htdemucs_ft 4-model fine-tuned ensemble — PyTorch-grade, ~2-3×
      //              realtime (4× the compute); fp16 with the variance prologue pinned
      //              to CPU (forceCpuNodeNames) so fp16 doesn't NaN.
      let modelDef = DEMUCS_MODELS.find((m) => m.id === demucsModel) || DEMUCS_MODELS[0];
      if (modelDef.kind === 'ft' && !ftAvailable) {
        log('htdemucs_ft (best) models not installed — using fast htdemucs');
        modelDef = DEMUCS_MODELS.find((m) => m.kind === 'single') || DEMUCS_MODELS[0];
      }
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
      const device = gpu === 'available' ? 'webgpu' : 'wasm';
      // CRITICAL dtype: transformers.js DEFAULTS WebGPU to fp32, which loads the
      // huge fp32 ONNX (v3-turbo's decoder is 2.5GB) → unusably slow / OOM. q4f16
      // is 4-bit weights + fp16 compute: tiny (v3-turbo ~564MB) and FAST on WebGPU
      // (measured ~13× realtime vs fp32 not finishing in 4 min). On wasm, q8.
      const dtype = device === 'webgpu' ? 'q4f16' : 'q8';
      log(`loading Whisper model · ${want} · ${device}/${dtype} (first run downloads it) …`);
      const seenFiles = new Set();
      let asr;
      try {
        asr = await pipeline('automatic-speech-recognition', want, {
          device,
          dtype,
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
      const mono = toMono16k(result.vocals.left, result.vocals.right, audio.sampleRate);
      const audioMin = (mono.length / 16000 / 60).toFixed(1);
      const tStart = performance.now();
      log(`transcribing ${audioMin} min of vocals on ${device} …`);
      // Live feedback (the native tab streams whisper progress; we do the same via
      // transformers.js's WhisperTextStreamer — VERIFIED to fire, unlike the plain
      // callback_function). on_chunk_start ticks per 30s chunk; the text callback
      // streams decoded words. A 1s heartbeat guarantees elapsed time always moves.
      let chunkIdx = 0;
      let partial = '';
      const totalChunks = Math.max(1, Math.ceil(mono.length / 16000 / 30));
      const hb = setInterval(() => {
        const el = ((performance.now() - tStart) / 1000).toFixed(0);
        setTranscribeInfo(
          `transcribing chunk ${Math.min(chunkIdx, totalChunks)}/${totalChunks} · ${el}s`
        );
      }, 1000);
      let streamer = null;
      try {
        if (tf?.WhisperTextStreamer) {
          streamer = new tf.WhisperTextStreamer(asr.tokenizer, {
            on_chunk_start: () => {
              chunkIdx += 1;
              partial = '';
              const el = ((performance.now() - tStart) / 1000).toFixed(0);
              log(`  …chunk ${chunkIdx}/${totalChunks} (${el}s)`);
            },
            callback_function: (text) => {
              partial += text;
              setTranscribeInfo(`chunk ${chunkIdx}/${totalChunks}: …${partial.slice(-48)}`);
            },
          });
        }
      } catch {
        streamer = null;
      }
      // Reference lyrics as a Whisper prompt nudges it toward the right words
      // (names, slang, rare words) — same idea as the native creator's hints.
      const promptText = referenceLyrics.trim()
        ? referenceLyrics.replace(/\s+/g, ' ').trim().slice(0, 200)
        : null;
      let out;
      try {
        out = await asr(mono, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: 'word',
          ...(promptText ? { prompt: promptText } : {}),
          ...(streamer ? { streamer } : {}),
        });
      } finally {
        clearInterval(hb);
        setTranscribeInfo('');
      }
      const tSec = (performance.now() - tStart) / 1000;

      const words = out.chunks || [];
      let lines = words.length
        ? groupWordsIntoLines(words)
        : [{ text: (out.text || '').trim(), start: 0, end: audio.duration }];
      setLyrics(lines);
      log(
        `transcription done in ${tSec.toFixed(1)}s ` +
          `(${((parseFloat(audioMin) * 60) / tSec).toFixed(2)}× realtime) — ` +
          `${words.length} words → ${lines.length} lyric lines`
      );

      // --- LLM correction (parity): auto-run when reference lyrics are present ---
      // Sends the transcription + reference lyrics to the configured LLM to fix
      // mis-heard words. No-ops gracefully if no LLM is configured.
      let correctedWords = words;
      setLlmStats(null);
      if (referenceLyrics.trim()) {
        setStatus('correcting');
        log('correcting lyrics with LLM (reference lyrics provided) …');
        try {
          const cr = await creatorCall('correctLyrics', '/admin/creator/correct', {
            whisperOutput: { lines, words },
            referenceLyrics,
          });
          if (cr?.success !== false && cr?.lines?.length) {
            lines = cr.lines;
            if (cr.words?.length) correctedWords = cr.words;
            setLyrics(lines);
            const st = cr.llmStats || cr.stats;
            if (st) setLlmStats(st);
            log(
              `LLM correction applied${st?.corrections_applied != null ? `: ${st.corrections_applied} lines changed` : ''}`
            );
          } else {
            log(`LLM correction skipped (${cr?.error || 'no LLM configured'})`);
          }
        } catch (e) {
          log(`LLM correction failed (${e.message}) — using raw transcription`);
        }
      }

      // --- Save as .stem.mp4 (encode 4 stems → POST → backend muxes via ffmpeg) ---
      setStatus('saving');
      log('encoding stems + saving .stem.mp4 …');
      // Title/artist: prefer the UI fields, else parse "Artist - Title.ext".
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const dash = baseName.match(/^(.+?)\s*-\s*(.+)$/);
      const artist = songArtist.trim() || (dash ? dash[1].trim() : '');
      const title = songTitle.trim() || (dash ? dash[2].trim() : baseName);
      // Normalize Whisper word objects → {start,end,text} for the kara atom.
      const wordObjs = correctedWords
        .map((w) => ({
          text: (w.text || '').trim(),
          start: w.timestamp?.[0] ?? w.start ?? null,
          end: w.timestamp?.[1] ?? w.end ?? null,
        }))
        .filter((w) => w.text && w.start != null);

      const sr = audio.sampleRate;
      const lyricsPayload = { lines, words: wordObjs };
      // master = the RAW original mix (NI-Stems track 0), not a sum of stems.
      const wavBlobs = {
        master: encodeWav(audio.left, audio.right, sr),
        drums: encodeWav(result.drums.left, result.drums.right, sr),
        bass: encodeWav(result.bass.left, result.bass.right, sr),
        other: encodeWav(result.other.left, result.other.right, sr),
        vocals: encodeWav(result.vocals.left, result.vocals.right, sr),
      };

      let saved;
      if (window.kaiAPI?.creator?.saveWebGpuStems) {
        // Electron player: IPC (no admin HTTP session here). Send WAVs as bytes.
        const stems = {};
        for (const k of Object.keys(wavBlobs)) {
          stems[k] = new Uint8Array(await wavBlobs[k].arrayBuffer());
        }
        const r = await window.kaiAPI.creator.saveWebGpuStems({
          stems,
          metadata: { title, artist, duration: audio.duration },
          lyrics: lyricsPayload,
        });
        if (!r?.success) throw new Error(`save failed: ${r?.error || 'unknown'}`);
        saved = r;
      } else {
        // Web admin (browser): authed HTTP. credentials:'include' sends the session.
        const fd = new FormData();
        fd.append('title', title);
        fd.append('artist', artist);
        fd.append('duration', String(audio.duration));
        fd.append('lyrics', JSON.stringify(lyricsPayload));
        for (const [k, blob] of Object.entries(wavBlobs)) fd.append(k, blob, `${k}.wav`);
        const saveRes = await fetch('/admin/webgpu-creator/save', {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        if (!saveRes.ok) {
          const err = await saveRes.json().catch(() => ({}));
          throw new Error(`save failed (${saveRes.status}): ${err.error || ''}`);
        }
        saved = await saveRes.json();
      }
      setStatus('done');
      log(`✅ saved to library: ${saved.fileName}`);
    } catch (e) {
      console.error(e);
      log(`ERROR: ${e.message}`);
      setStatus('error');
    }
  }

  const busy =
    status === 'separating' ||
    status === 'transcribing' ||
    status === 'correcting' ||
    status === 'saving';

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

          {/* Lyric assist: title/artist → LRCLIB lookup → reference lyrics, which
              guide transcription (Whisper prompt) + power LLM correction. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-600 dark:text-gray-400 flex flex-col">
              Title
              <input
                type="text"
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                disabled={busy}
                placeholder="Song title"
                className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400 flex flex-col">
              Artist
              <input
                type="text"
                value={songArtist}
                onChange={(e) => setSongArtist(e.target.value)}
                disabled={busy}
                placeholder="Artist"
                className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={lookupLyrics}
              disabled={busy || lookingUp || !songTitle}
              className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {lookingUp ? 'Looking…' : '🔎 Find lyrics'}
            </button>
          </div>
          <label className="text-xs text-gray-600 dark:text-gray-400 flex flex-col">
            Reference lyrics (optional — improves accuracy + enables LLM correction)
            <textarea
              value={referenceLyrics}
              onChange={(e) => setReferenceLyrics(e.target.value)}
              disabled={busy}
              rows={3}
              placeholder="Paste known lyrics, or use Find lyrics above"
              className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm font-mono"
            />
          </label>

          <label className="text-sm text-gray-700 dark:text-gray-300">
            Demucs model:
            <select
              className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              value={demucsModel}
              onChange={(e) => setDemucsModel(e.target.value)}
              disabled={busy}
            >
              {DEMUCS_MODELS.map((m) => {
                const unavail = m.kind === 'ft' && !ftAvailable;
                return (
                  <option key={m.id} value={m.id} disabled={unavail}>
                    {m.label}
                    {unavail ? ' — not installed' : ''}
                  </option>
                );
              })}
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

          {/* LLM settings (powers lyric correction). Collapsible — only needed to
              configure the provider/key once. */}
          <div className="text-sm">
            <button
              type="button"
              onClick={() => setShowLlm((v) => !v)}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showLlm ? '▾' : '▸'} LLM correction settings
            </button>
            {showLlm && (
              <div className="mt-2 flex flex-col gap-2 rounded border border-gray-200 dark:border-gray-700 p-3">
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={llmSettings.enabled}
                    onChange={(e) => setLlmSettings((p) => ({ ...p, enabled: e.target.checked }))}
                  />
                  Enable LLM correction (uses reference lyrics)
                </label>
                <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">
                  Provider
                  <select
                    value={llmSettings.provider}
                    onChange={(e) => setLlmSettings((p) => ({ ...p, provider: e.target.value }))}
                    className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
                  >
                    <option value="lmstudio">Local LLM Server (LM Studio / Ollama)</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google Gemini</option>
                  </select>
                </label>
                <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">
                  Base URL (local server)
                  <input
                    type="text"
                    value={llmSettings.baseUrl}
                    onChange={(e) => setLlmSettings((p) => ({ ...p, baseUrl: e.target.value }))}
                    className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 font-mono"
                  />
                </label>
                <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">
                  Model
                  <input
                    type="text"
                    value={llmSettings.model}
                    onChange={(e) => setLlmSettings((p) => ({ ...p, model: e.target.value }))}
                    placeholder="e.g. gpt-4o-mini, claude-…, or local model name"
                    className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 font-mono"
                  />
                </label>
                {llmSettings.provider !== 'lmstudio' && (
                  <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">
                    API key
                    <input
                      type="password"
                      value={llmSettings.apiKey}
                      onChange={(e) => setLlmSettings((p) => ({ ...p, apiKey: e.target.value }))}
                      className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 font-mono"
                    />
                  </label>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveLlmSettings}
                    className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-xs hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={testLlm}
                    disabled={llmTest?.testing}
                    className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-xs hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                  >
                    {llmTest?.testing ? 'Testing…' : 'Test connection'}
                  </button>
                  {llmTest && !llmTest.testing && (
                    <span
                      className={`text-xs ${llmTest.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {llmTest.success ? '✓ OK' : `✗ ${llmTest.error || 'failed'}`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

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
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-block animate-pulse">●</span>{' '}
            {transcribeInfo || 'Transcribing vocals…'}
          </div>
        )}
        {status === 'correcting' && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-block animate-pulse">●</span> Correcting lyrics with LLM…
          </div>
        )}
        {status === 'saving' && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-block animate-pulse">●</span> Encoding stems + saving .stem.mp4…
          </div>
        )}
        {rtf !== null && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            separation: {rtf.toFixed(2)}× realtime · htdemucs_ft on WebGPU
          </div>
        )}
        {llmStats && (
          <div className="text-xs text-green-700 dark:text-green-400">
            LLM correction: {llmStats.corrections_applied ?? 0} lines changed
            {llmStats.suggestions_made != null ? ` (${llmStats.suggestions_made} suggestions)` : ''}
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
