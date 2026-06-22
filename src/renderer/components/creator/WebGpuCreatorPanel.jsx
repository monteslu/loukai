import { useEffect, useRef, useState } from 'react';
import * as StemExtractor from 'stem-mp4/extractor';

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
// `duration` (audio length) clamps the final line so a stretched trailing Whisper
// timestamp can't run a line 20+s past the song end. `maxLineDur` caps any single
// line's displayed length (the actual sung phrase is short even if Whisper's
// timestamp drifts).
function groupWordsIntoLines(
  words,
  { maxGap = 1.0, maxWords = 10, maxDur = 8, duration = Infinity, maxLineDur = 10 } = {}
) {
  const lines = [];
  const dropped = []; // lines removed by grouping (so the caller can report them)
  let cur = null;
  // A "word" with no letters/digits (e.g. ".." or "♪") is punctuation/noise, not a
  // lyric — Whisper emits these as hallucinations over fades/instrumental. Drop them.
  const hasContent = (s) => /[\p{L}\p{N}]/u.test(s);
  const push = (c) => {
    const text = c.text.trim();
    if (!hasContent(text)) {
      dropped.push({ text, start: c.start, reason: 'punctuation/symbol-only' });
      return; // skip punctuation/symbol-only lines
    }
    let end = Math.min(c.end, duration); // never past the song end
    if (end - c.start > maxLineDur) end = c.start + maxLineDur; // cap runaway length
    if (end <= c.start) end = c.start + 0.5;
    lines.push({ text, start: c.start, end });
  };
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
        push(cur);
        cur = { text, start, end, n: 1 };
      } else {
        // join (no space before clitics/punctuation)
        cur.text += /^[,.!?;:']/.test(text) ? text : ` ${text}`;
        cur.end = end;
        cur.n += 1;
      }
    }
  }
  if (cur) push(cur);
  lines.dropped = dropped; // non-breaking: expose what grouping culled
  return lines;
}

export default function WebGpuCreatorPanel() {
  const [gpu, setGpu] = useState('checking'); // checking | available | unavailable
  // Default to large-v3-turbo — most accurate AND fast via q4f16 on WebGPU
  // (~13× realtime). The earlier slowness was a dtype bug: WebGPU defaulted to the
  // 2.5GB fp32 ONNX; q4f16 fixes it. Smaller models stay available for low-VRAM.
  const [asrModel, setAsrModel] = useState('onnx-community/whisper-large-v3-turbo_timestamped');
  // Timestamp granularity. 'word' = per-word DTW timing (precise, but transformers.js
  // can DROP words it can't align at chunk seams → missing mid-song lyrics). 'segment'
  // = per-line timing (coarser, but far more robust about not losing content). A/B-able.
  const [timestampMode, setTimestampMode] = useState('word');
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
  const [songAlbum, setSongAlbum] = useState('');
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
        if (adapter) {
          // Log WHICH adapter so we can tell a real discrete GPU from a fallback /
          // integrated one (explains separation speed). adapter.info is the modern
          // field; requestAdapterInfo() the older one.
          let info = adapter.info;
          if (!info && adapter.requestAdapterInfo) {
            try {
              info = await adapter.requestAdapterInfo();
            } catch {
              /* not supported */
            }
          }
          const desc = info
            ? [info.vendor, info.architecture, info.device, info.description]
                .filter(Boolean)
                .join(' / ')
            : '(adapter info unavailable)';
          log(`WebGPU available ✓ — adapter: ${desc}`);
          const feats = adapter.features ? [...adapter.features].length : 0;
          log(
            `WebGPU limits: maxBufferSize=${adapter.limits?.maxBufferSize ?? '?'}, features=${feats}`
          );
        } else {
          log('WebGPU adapter null — WASM fallback');
        }
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
    let ort, demucs, tf, ftEnsemble, crepeMod;
    try {
      [ort, demucs, tf, ftEnsemble, crepeMod] = await Promise.all([
        import(/* @vite-ignore */ `${base}/ort.webgpu.bundle.min.mjs`),
        import(/* @vite-ignore */ `${base}/demucs/index.js`),
        importTransformers(`${base}/transformers.min.js`),
        import(/* @vite-ignore */ `${base}/ft-ensemble.js`),
        import(/* @vite-ignore */ `${base}/crepe-pitch.js`),
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
      crepeMod,
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
  async function lookupLyrics(title = songTitle, artist = songArtist) {
    if (!title) {
      log('enter a title (and artist) to look up lyrics');
      return;
    }
    setLookingUp(true);
    try {
      log(`looking up lyrics: ${artist ? artist + ' - ' : ''}${title} …`);
      const r = await creatorCall('searchLyrics', '/admin/creator/search-lyrics', {
        title,
        artist,
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

  // On file select: read ID3/metadata tags in-browser (music-metadata parseBlob),
  // prefill title/artist/album, then AUTO-search LRCLIB — matching the native
  // creator's getFileInfo behaviour (ID3 → fields → auto lyric lookup). Falls back
  // to "Artist - Title.ext" filename parsing when there are no tags.
  async function onFileSelect() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    let title = '';
    let artist = '';
    let album = '';
    try {
      const mm = await import(/* @vite-ignore */ 'music-metadata');
      const { common } = await mm.parseBlob(file);
      title = common?.title || '';
      artist = common?.artist || '';
      album = common?.album || '';
      if (title || artist) {
        log(`ID3 tags: ${artist || '?'} — ${title || '?'}${album ? ` (${album})` : ''}`);
      }
    } catch {
      /* no/unreadable tags → filename fallback below */
    }
    if (!title) {
      // "Artist - Title.ext" filename fallback (skip for already-made stem files).
      const base = file.name.replace(/\.[^.]+$/, '');
      const dash = base.match(/^(.+?)\s*-\s*(.+)$/);
      if (dash) {
        artist = artist || dash[1].trim();
        title = dash[2].trim();
      } else {
        title = base;
      }
    }
    setSongTitle(title);
    setSongArtist(artist);
    setSongAlbum(album);
    // Auto lyric lookup (don't auto-lookup for a .stem.mp4 re-transcribe unless empty).
    if (title) await lookupLyrics(title, artist);
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

  // Lyrics-only mode: pull the VOCALS track out of an existing .stem.mp4 (in-browser
  // via stem-mp4's isomorphic extractor), decode it to stereo Float32. NI-Stems track
  // order: 0=master,1=drums,2=bass,3=other,4=vocals — pick vocals by index, falling
  // back to the last track. Returns the same shape as decodeAudio().
  async function extractVocalsFromStem(file) {
    const arr = await file.arrayBuffer();
    let vocalsIdx = 4;
    try {
      const info = StemExtractor.getTrackInfo(arr);
      const count = StemExtractor.getTrackCount(arr);
      if (count && vocalsIdx >= count) vocalsIdx = count - 1; // last track = vocals
      if (Array.isArray(info) && info.length) vocalsIdx = Math.min(vocalsIdx, info.length - 1);
    } catch {
      /* use default index 4 */
    }
    const trackBuf = StemExtractor.extractTrack(arr, vocalsIdx);
    if (!trackBuf) throw new Error('could not extract vocals track');
    const u8 = trackBuf instanceof Uint8Array ? trackBuf : new Uint8Array(trackBuf);
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(
      u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    );
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
      const { ort, demucs, ftEnsemble, pipeline, tf, crepeMod, DemucsProcessor } = await loadLibs();
      const { STEMS, createEnsembleSessions, runEnsemble } = ftEnsemble;

      // Lyrics-only mode: an existing .stem.mp4 → re-transcribe its vocals track and
      // rewrite the lyrics atom, skipping separation entirely.
      const lyricsOnly = /\.stem\.mp4$/i.test(file.name);

      let audio;
      let result;
      if (lyricsOnly) {
        log(`lyrics-only: extracting vocals from ${file.name} …`);
        audio = await extractVocalsFromStem(file);
        result = { vocals: { left: audio.left, right: audio.right } };
        setRtf(null);
        log(`vocals extracted (${audio.duration.toFixed(0)}s) — skipping separation`);
      } else {
        log(`decoding ${file.name} …`);
        audio = await decodeAudio(file);
      }

      // --- Demucs stem separation (in-browser, WebGPU) --- (skipped in lyrics-only)
      if (!lyricsOnly) {
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
        let modeLabel;
        if (modelDef.kind === 'ft') {
          // Try the ft ensemble; if its models can't be fetched (e.g. the HF repo
          // isn't reachable), fall back to fast htdemucs rather than failing the run.
          try {
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
            modeLabel = 'htdemucs_ft (best)';
          } catch (e) {
            log(`htdemucs_ft unavailable (${e.message}) — falling back to fast htdemucs`);
            modelDef = DEMUCS_MODELS.find((m) => m.kind === 'single') || DEMUCS_MODELS[0];
          }
        }
        if (modelDef.kind !== 'ft' && !result) {
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
          log(`separating — htdemucs (single) on EP: ${gpu === 'available' ? 'webgpu' : 'wasm'} …`);
          result = await proc.separate(audio.left, audio.right);
        }
        const sec = (performance.now() - t0) / 1000;
        const realtime = audio.duration / sec;
        setRtf(realtime);
        log(
          `separation done in ${sec.toFixed(1)}s — ${realtime.toFixed(2)}× realtime [${modeLabel}]`
        );
      } // end separation (skipped in lyrics-only)

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

      // --- Vocals energy profile (replaces Silero VAD) ---
      // To suppress Whisper hallucinations in the instrumental intro/outro, we need
      // an honest "is anyone actually singing here?" signal. For SUNG audio the best
      // signal is the VOCALS STEM's own loudness: it's near-silent during
      // instrumentals (only Demucs bleed), loud during singing. A speech VAD
      // (Silero) under-detects singing; raw RMS energy of the vocals stem doesn't.
      // Build a coarse RMS-per-100ms profile once; the edge filter queries it.
      const WIN_SEC = 0.1;
      const winLen = Math.max(1, Math.round(WIN_SEC * 16000));
      const nWin = Math.ceil(mono.length / winLen);
      const rms = new Float32Array(nWin);
      let peakRms = 1e-9;
      for (let w = 0; w < nWin; w++) {
        let sum = 0;
        const s = w * winLen;
        const e = Math.min(mono.length, s + winLen);
        for (let i = s; i < e; i++) sum += mono[i] * mono[i];
        const r = Math.sqrt(sum / Math.max(1, e - s));
        rms[w] = r;
        if (r > peakRms) peakRms = r;
      }
      // "silent" = below a small fraction of the track's peak vocal level (relative,
      // so it adapts to quiet vs loud masters). Returns true if vocals are audibly
      // present at time t (seconds).
      const SILENT_FRAC = 0.08;
      const silentThresh = peakRms * SILENT_FRAC;
      const vocalsAudibleAt = (t) => {
        const w = Math.min(nWin - 1, Math.max(0, Math.floor((t * 16000) / winLen)));
        return rms[w] > silentThresh;
      };
      log(
        `vocals energy profile: peak=${peakRms.toFixed(4)}, silence threshold=${silentThresh.toFixed(4)} (${Math.round(SILENT_FRAC * 100)}% of peak)`
      );

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
      // NOTE: we do NOT pass a `prompt` to the chunked pipeline. transformers.js
      // expects tokenized `prompt_ids` (not a raw string), and feeding a string
      // prompt into the long-form/chunked decode destabilizes it — it can lock onto
      // the prompt and drop real lyrics mid-song. The reference lyrics still help via
      // the post-transcription LLM correction. (If we want true prompting later, do
      // it with tokenizer-produced prompt_ids.)
      const promptText = null;
      const useWordTs = timestampMode === 'word';
      log(`timestamp mode: ${timestampMode}`);
      let out;
      try {
        out = await asr(mono, {
          chunk_length_s: 30,
          stride_length_s: 5,
          // 'word' → per-word DTW timing; true → per-segment (line) timing.
          return_timestamps: useWordTs ? 'word' : true,
          ...(streamer ? { streamer } : {}),
        });
      } finally {
        clearInterval(hb);
        setTranscribeInfo('');
      }
      const tSec = (performance.now() - tStart) / 1000;

      // In segment mode, each chunk is {text:'a whole line', timestamp:[s,e]}. Split it
      // into pseudo-words (evenly spaced across the segment) so the line-grouper +
      // word-timed kara atom still work. Word mode passes chunks through unchanged.
      let words = out.chunks || [];
      if (!useWordTs) {
        const expanded = [];
        for (const seg of words) {
          const [s, e] = seg.timestamp || [seg.start, seg.end];
          const toks = (seg.text || '').trim().split(/\s+/).filter(Boolean);
          if (s == null || !toks.length) continue;
          const dur = (e ?? s) - s;
          const step = toks.length > 0 ? dur / toks.length : 0;
          toks.forEach((tok, i) => {
            expanded.push({
              text: (i ? ' ' : '') + tok,
              timestamp: [s + i * step, s + (i + 1) * step],
            });
          });
        }
        words = expanded;
      }
      // DIAGNOSTIC: where do lyrics disappear? Log counts at each stage.
      const rawWordCount = words.length;
      const rawTextLen = (out.text || '').length;
      const lastWordT = words.length
        ? (words[words.length - 1].timestamp?.[1] ?? words[words.length - 1].end ?? 0)
        : 0;
      log(
        `Whisper raw: ${rawWordCount} words, ${rawTextLen} chars, last word @ ${lastWordT.toFixed(0)}s of ${audio.duration.toFixed(0)}s${promptText ? ' (prompt ON)' : ''}`
      );
      // ========================================================================
      // FULL DIAGNOSTIC DUMP to devtools console (open DevTools to inspect).
      // This is the ground truth of what Whisper actually returned, so we can see
      // WHERE lyrics go missing.
      // ========================================================================
      {
        const CH = 30; // Whisper's hard 30s chunk size
        const nb = Math.ceil(audio.duration / CH);
        const buckets = new Array(nb).fill(0);
        const wordRows = words.map((w, i) => {
          const t0 = w.timestamp?.[0] ?? w.start ?? null;
          const t1 = w.timestamp?.[1] ?? w.end ?? null;
          if (t0 != null) buckets[Math.min(nb - 1, Math.floor(t0 / CH))]++;
          return { i, text: (w.text || '').trim(), start: t0, end: t1 };
        });
        // Gaps > 4s between consecutive words = where transcription went silent.
        const gaps = [];
        for (let i = 1; i < wordRows.length; i++) {
          const g = (wordRows[i].start ?? 0) - (wordRows[i - 1].end ?? 0);
          if (g > 4) {
            gaps.push({
              gapSec: Number(g.toFixed(1)),
              from: `${(wordRows[i - 1].end ?? 0).toFixed(1)}s "${wordRows[i - 1].text}"`,
              to: `${(wordRows[i].start ?? 0).toFixed(1)}s "${wordRows[i].text}"`,
            });
          }
        }
        const bucketStr = buckets.map((b, i) => `${i * CH}s:${b}`).join(' ');
        log(`words per 30s chunk: [${bucketStr}]`);
        if (gaps.length) {
          log(`⚠ ${gaps.length} large gap(s) (>4s) in transcription — possible dropped sections:`);
          for (const g of gaps) log(`    ↔ ${g.gapSec}s gap: ${g.from} → ${g.to}`);
        }
        // Full structured dumps to console (not screen-log).

        console.group('🎤 Whisper transcription diagnostics');
        console.log('audio duration (s):', audio.duration, '| sampleRate:', audio.sampleRate);
        console.log('raw word count:', words.length, '| text chars:', (out.text || '').length);
        console.log('full text:', out.text);
        console.log('words/30s buckets:', buckets);
        console.table(gaps.length ? gaps : [{ note: 'no gaps >4s' }]);
        console.log('ALL words (text/start/end):');
        console.table(wordRows);
        console.log('raw out object:', out);
        console.groupEnd();
      }
      // Hallucination trim — ONLY at the song's instrumental bookends. Whisper
      // invents phrases ("thank you", "..") over the intro + outro/fade. We drop a
      // word in the first/last EDGE_FRAC (3%) of the track ONLY IF the vocals stem is
      // actually near-silent at that moment (no one's singing → it's a hallucination).
      // The entire middle is kept untouched, and a word in the edge zone DURING real
      // singing is kept. Uses the vocals RMS profile (honest for sung audio).
      const EDGE_FRAC = 0.03;
      {
        const dur = audio.duration;
        const headEnd = dur * EDGE_FRAC;
        const tailStart = dur * (1 - EDGE_FRAC);
        const before = words.length;
        const culled = [];
        words = words.filter((w) => {
          const ts = w.timestamp || [w.start, w.end];
          const mid = ts[0] != null && ts[1] != null ? (ts[0] + ts[1]) / 2 : ts[0];
          if (mid == null) return true;
          // Only the edges are gated; the middle is always kept.
          if (mid > headEnd && mid < tailStart) return true;
          // In the edge zone: keep if vocals are audible, cull if near-silent.
          if (vocalsAudibleAt(mid)) return true;
          culled.push({ text: (w.text || '').trim(), t: Number(mid.toFixed(2)) });
          return false;
        });
        if (culled.length) {
          log(
            `trimmed ${culled.length} hallucinated word(s) in the intro/outro (first/last ${Math.round(EDGE_FRAC * 100)}%, vocals silent):`
          );
          for (const c of culled) log(`    ✂ "${c.text}" @ ${c.t}s`);
          console.table(culled);
        } else if (before) {
          log('no intro/outro hallucinations to trim (vocals audible throughout edges)');
        }
      }
      log(`after VAD: ${words.length} words`);
      let lines = words.length
        ? groupWordsIntoLines(words, { duration: audio.duration })
        : [{ text: (out.text || '').trim(), start: 0, end: audio.duration }];
      const groupedWordCount = lines.reduce(
        (n, l) => n + l.text.split(/\s+/).filter(Boolean).length,
        0
      );
      log(
        `after grouping: ${lines.length} lines, ${groupedWordCount} words (last line ends @ ${(lines[lines.length - 1]?.end ?? 0).toFixed(0)}s)`
      );
      if (lines.dropped?.length) {
        log(`grouping dropped ${lines.dropped.length} non-lyric line(s):`);
        for (const d of lines.dropped)
          log(`    ✂ "${d.text}" @ ${d.start.toFixed(1)}s (${d.reason})`);
        console.table(lines.dropped);
      }
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

      // --- CREPE pitch → musical key (parity: native uses CREPE for key detection;
      // pitch track stored best-effort). Reuses the 16k mono vocals. Best-effort. ---
      let detectedKey = null;
      let pitchData = null;
      try {
        const { detectPitch, detectKey } = crepeMod;
        if (!libs.current.crepeSession) {
          log('loading CREPE (pitch) …');
          const cbuf = await fetch('/webgpu-models/crepe_tiny.onnx').then((r) =>
            r.ok ? r.arrayBuffer() : Promise.reject(new Error(`crepe ${r.status}`))
          );
          libs.current.crepeSession = await ort.InferenceSession.create(new Uint8Array(cbuf), {
            executionProviders: gpu === 'available' ? ['webgpu'] : ['wasm'],
            graphOptimizationLevel: 'all',
          });
        }
        setStatus('pitch');
        log(`detecting pitch + key (CREPE on EP: ${gpu === 'available' ? 'webgpu' : 'wasm'}) …`);
        const ct0 = performance.now();
        const pitch = await detectPitch(ort, libs.current.crepeSession, mono, {
          onProgress: (f) => setTranscribeInfo(`pitch ${Math.round(f * 100)}%`),
        });
        setTranscribeInfo('');
        log(`CREPE pitch done in ${((performance.now() - ct0) / 1000).toFixed(1)}s`);
        const k = detectKey(pitch);
        detectedKey = k.key;
        pitchData = {
          sampleRate: Math.round(1 / pitch.hopSec),
          data: Array.from(pitch.frequency, (f, i) => ({
            time: pitch.times[i],
            frequency: f,
            confidence: pitch.confidence[i],
          })),
        };
        log(`detected key: ${detectedKey} (confidence ${k.confidence.toFixed(2)})`);
      } catch (e) {
        log(`pitch/key detection skipped (${e.message})`);
      }

      // --- Save as .stem.mp4 (encode 4 stems → POST → backend muxes via ffmpeg) ---
      setStatus('saving');
      log('encoding stems + saving .stem.mp4 …');
      // Title/artist: prefer the UI fields, else parse "Artist - Title.ext".
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const dash = baseName.match(/^(.+?)\s*-\s*(.+)$/);
      const artist = songArtist.trim() || (dash ? dash[1].trim() : '');
      const title = songTitle.trim() || (dash ? dash[2].trim() : baseName);
      const album = songAlbum.trim();
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

      let saved;
      if (lyricsOnly) {
        // Lyrics-only: rewrite the kara atom (+key) on the existing file — no re-encode.
        log('updating lyrics on existing .stem.mp4 …');
        if (window.kaiAPI?.creator?.updateStemLyrics) {
          const r = await window.kaiAPI.creator.updateStemLyrics({
            inputPath: file.path, // Electron File exposes the disk path
            lyrics: lyricsPayload,
            key: detectedKey,
            pitch: pitchData,
          });
          if (!r?.success) throw new Error(`update failed: ${r?.error || 'unknown'}`);
          saved = r;
        } else {
          const res = await fetch('/admin/webgpu-creator/update-lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file: file.name,
              lyrics: lyricsPayload,
              key: detectedKey,
              pitch: pitchData,
            }),
            credentials: 'include',
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`update failed (${res.status}): ${err.error || ''}`);
          }
          saved = await res.json();
        }
        setStatus('done');
        log(`✅ lyrics updated: ${saved.fileName}`);
        return;
      }

      // master = the RAW original mix (NI-Stems track 0), not a sum of stems.
      const wavBlobs = {
        master: encodeWav(audio.left, audio.right, sr),
        drums: encodeWav(result.drums.left, result.drums.right, sr),
        bass: encodeWav(result.bass.left, result.bass.right, sr),
        other: encodeWav(result.other.left, result.other.right, sr),
        vocals: encodeWav(result.vocals.left, result.vocals.right, sr),
      };

      if (window.kaiAPI?.creator?.saveWebGpuStems) {
        // Electron player: IPC (no admin HTTP session here). Send WAVs as bytes.
        const stems = {};
        for (const k of Object.keys(wavBlobs)) {
          stems[k] = new Uint8Array(await wavBlobs[k].arrayBuffer());
        }
        const r = await window.kaiAPI.creator.saveWebGpuStems({
          stems,
          metadata: { title, artist, album, duration: audio.duration, key: detectedKey },
          lyrics: lyricsPayload,
          pitch: pitchData,
        });
        if (!r?.success) throw new Error(`save failed: ${r?.error || 'unknown'}`);
        saved = r;
      } else {
        // Web admin (browser): authed HTTP. credentials:'include' sends the session.
        const fd = new FormData();
        fd.append('title', title);
        fd.append('artist', artist);
        if (album) fd.append('album', album);
        fd.append('duration', String(audio.duration));
        fd.append('lyrics', JSON.stringify(lyricsPayload));
        if (detectedKey) fd.append('key', detectedKey);
        if (pitchData) fd.append('pitch', JSON.stringify(pitchData));
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
    status === 'pitch' ||
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
            accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4,.stem.mp4"
            className="text-sm"
            disabled={busy}
            onChange={onFileSelect}
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
            <label className="text-xs text-gray-600 dark:text-gray-400 flex flex-col">
              Album
              <input
                type="text"
                value={songAlbum}
                onChange={(e) => setSongAlbum(e.target.value)}
                disabled={busy}
                placeholder="Album (optional)"
                className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => lookupLyrics()}
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
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Lyric timing:
            <select
              className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              value={timestampMode}
              onChange={(e) => setTimestampMode(e.target.value)}
              disabled={busy}
            >
              <option value="word">word-level (precise, may drop some words)</option>
              <option value="segment">segment/line (robust, keeps more lyrics)</option>
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
        {status === 'pitch' && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-block animate-pulse">●</span> Detecting pitch + key (CREPE)…
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
