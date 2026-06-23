import { useEffect, useRef, useState } from 'react';
import * as StemExtractor from 'stem-mp4/extractor';
import { planVocalSegments, snapToVocalEnergy } from '../../../shared/creator/vocalSegmentation.js';
import {
  assetBase,
  WHISPER_MODELS,
  DEMUCS_MODELS,
  encodeWav,
  groupWordsIntoLines,
  cullOutroThanks,
} from '../../../shared/creator/creatorAudio.js';
import { encodeWavToAac } from '../../../shared/creator/aacEncoder.js';
import { STYLES, Spinner, ErrorDisplay, SongTitle, StemProgressBars } from './creatorUi.jsx';

/**
 * WebGPU Creator (experimental) — runs Demucs stem separation + Whisper
 * transcription FULLY IN-BROWSER, no Python/PyTorch. WebGPU primary, WASM/CPU
 * fallback. Stack (proven by the JIG bench):
 *   - demucs-web (DemucsProcessor) → htdemucs ONNX via onnxruntime-web webgpu
 *   - @huggingface/transformers (transformers.js) → Whisper via WebGPU
 * Goal: prove loukai can drop the native Python creator entirely.
 *
 * Libs load from CDN at runtime (kept out of the Vite bundle), exactly like the
 * standalone experiment; the browser caches the models after first run. All assets
 * (JS libs, WASM, models) are served SAME-ORIGIN by loukai's backend from
 * /webgpu-assets/* (see assetBase / creatorAudio.js).
 */

export default function WebGpuCreatorPanel() {
  const [gpu, setGpu] = useState('checking'); // checking | available | unavailable
  const [activeSubTab, setActiveSubTab] = useState('create'); // 'create' | 'settings'
  const [dragActive, setDragActive] = useState(false); // drop-zone hover state
  const [fileName, setFileName] = useState(''); // selected file name (drop or browse)
  const [fileLoading, setFileLoading] = useState(false); // reading tags + lyric lookup
  // Default to large-v3-turbo — most accurate AND fast via q4f16 on WebGPU
  // (~13× realtime). The earlier slowness was a dtype bug: WebGPU defaulted to the
  // 2.5GB fp32 ONNX; q4f16 fixes it. Smaller models stay available for low-VRAM.
  const [asrModel, setAsrModel] = useState('onnx-community/whisper-large-v3-turbo_timestamped');
  // Timestamp granularity. 'word' = per-word DTW timing (precise, but transformers.js
  // can DROP words/whole lines it can't align at chunk seams → missing lyrics).
  // 'segment' = per-line timing (coarser per-word, but far more robust — doesn't drop
  // audible lines). Default to segment for completeness; we re-derive per-word timing
  // by spreading each segment's words across its span, which is plenty for karaoke.
  const [timestampMode, setTimestampMode] = useState('segment');
  // Whisper weight precision on WebGPU. Default q4f16 — MEASURED equal accuracy to
  // fp16/fp32 (4-bit weights + fp16 compute), but ~2× faster transcription (6.5× vs
  // 3.4× rt) and a much smaller download (~564MB). The fp16 experiment confirmed no
  // quality gain for the perf hit. fp16/fp32 stay in the dropdown for the rare case.
  const [whisperDtype, setWhisperDtype] = useState('q4f16');
  const [status, setStatus] = useState('idle'); // idle | separating | transcribing | done | error
  const [stemProgress, setStemProgress] = useState({}); // per-stem 0..1 (ft ensemble)
  // Demucs separation model — default to the fast single htdemucs.
  const [demucsModel, setDemucsModel] = useState('htdemucs');
  const [ftAvailable, setFtAvailable] = useState(true); // htdemucs_ft models present?
  const [transcribeInfo, setTranscribeInfo] = useState(''); // live transcription status
  const [logLines, setLogLines] = useState([]);
  const [error, setError] = useState(null); // fatal error message → ErrorDisplay
  const [lyrics, setLyrics] = useState([]);
  const [rtf, setRtf] = useState(null);
  const [completedFile, setCompletedFile] = useState(null); // output .stem.mp4 path (done)
  const [enableCrepe, setEnableCrepe] = useState(true); // run CREPE pitch/key detection
  const [language, setLanguage] = useState('en'); // Whisper transcription language
  // Lyric-assist (parity with native creator): title/artist for LRCLIB lookup,
  // reference lyrics (Whisper prompt + LLM correction source), correction stats.
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [songAlbum, setSongAlbum] = useState('');
  // Extra ID3 tags carried through from the source file (parity with native creator,
  // which preserves year/genre/track/etc).
  const [songTags, setSongTags] = useState({});
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
  const selectedFileRef = useRef(null); // the chosen File (from input OR drop)
  // Separated stems from the LAST run, kept so "Re-transcribe" can re-run Whisper with
  // changed settings WITHOUT paying the ~50s Demucs separation again. { fileName, audio,
  // result } — result holds the {vocals,...} stems.
  const reuseStemsRef = useRef(null);
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
  // `droppedFile` lets the drag-and-drop zone pass a File directly (the <input> path
  // reads from fileRef instead).
  async function onFileSelect(droppedFile = null) {
    const file = droppedFile || fileRef.current?.files?.[0];
    if (!file) return;
    selectedFileRef.current = file;
    reuseStemsRef.current = null; // new file → old separated stems are stale
    setFileName(file.name);
    setFileLoading(true);
    let title = '';
    let artist = '';
    let album = '';
    try {
      const mm = await import(/* @vite-ignore */ 'music-metadata');
      const { common } = await mm.parseBlob(file);
      // Coerce to strings — music-metadata can return arrays/objects for some tags.
      // A plain OBJECT must NOT become "[object Object]" (that polluted the LRCLIB
      // query → matched the wrong song). Accept string/number/array only; drop objects.
      const str = (v) => {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
        if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ');
        return ''; // object/other → not a usable title/artist string
      };
      title = str(common?.title);
      artist = str(common?.artist || common?.artists);
      album = str(common?.album);
      // Carry through the full tag set (parity with native creator: year/genre/track/
      // albumartist/composer/disk). Stored + written into the output file's metadata.
      const num = (v) =>
        typeof v === 'number' ? v : (v?.no ?? (v ? Number(v) || undefined : undefined));
      setSongTags({
        year: common?.year,
        genre: str(common?.genre),
        track: num(common?.track),
        disk: num(common?.disk),
        albumartist: str(common?.albumartist),
        composer: str(common?.composer),
        date: str(common?.date),
      });
      if (title || artist) {
        log(
          `ID3 tags: ${artist || '?'} — ${title || '?'}${album ? ` (${album})` : ''}` +
            `${common?.year ? ` [${common.year}]` : ''}${common?.genre ? ` {${str(common.genre)}}` : ''}`
        );
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
    // finally{} guarantees the loading flag clears even if the lookup throws, so the
    // Create button never gets stuck disabled.
    try {
      if (title) await lookupLyrics(title, artist);
    } finally {
      setFileLoading(false);
    }
  }

  // Reset for the next song (after a completed create).
  function handleCreateAnother() {
    selectedFileRef.current = null;
    reuseStemsRef.current = null;
    if (fileRef.current) fileRef.current.value = '';
    setFileName('');
    setCompletedFile(null);
    setLyrics([]);
    setLlmStats(null);
    setRtf(null);
    setStemProgress({});
    setSongTitle('');
    setSongArtist('');
    setSongAlbum('');
    setSongTags({});
    setReferenceLyrics('');
    setLogLines([]);
    setError(null);
    setStatus('idle');
    setActiveSubTab('create');
  }

  // Open the just-created file in the editor (matches the native creator).
  async function handleOpenInEditor() {
    if (!completedFile) return;
    try {
      await window.kaiAPI?.editor?.loadKai?.(completedFile);
      // Switch to the editor tab (same DOM pattern as TabNavigation / CreateTab).
      document.querySelectorAll('[id$="-tab"]').forEach((pane) => {
        pane.classList.add('hidden');
        pane.classList.remove('block', 'flex');
      });
      const editorPane = document.getElementById('editor-tab');
      if (editorPane) {
        editorPane.classList.remove('hidden');
        editorPane.classList.add('block');
      }
    } catch (err) {
      setError(`Failed to open in editor: ${err.message}`);
    }
  }

  // Drag-and-drop onto the big drop zone — feeds the same onFileSelect.
  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFileSelect(file);
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

  // `reuseStems` (from the Re-transcribe button): reuse the previous run's separated
  // stems for THIS file and skip decode + Demucs, re-running only Whisper onward.
  async function run(reuseStems = false) {
    const file = selectedFileRef.current || fileRef.current?.files?.[0];
    if (!file) return;
    const canReuse =
      reuseStems && reuseStemsRef.current && reuseStemsRef.current.fileName === file.name;
    setStatus(canReuse ? 'transcribing' : 'separating');
    setError(null);
    setLyrics([]);
    setStemProgress({});
    setRtf(null);
    // ⏱️ per-stage timing (directly comparable to the Python/native creator's summary)
    const perf = { audioSec: 0, separation: 0, transcription: 0, pitch: 0 };
    const runT0 = performance.now();
    try {
      const { ort, demucs, ftEnsemble, pipeline, crepeMod, DemucsProcessor, tf } = await loadLibs();
      const { STEMS, createEnsembleSessions, runEnsemble } = ftEnsemble;

      // Lyrics-only mode: an existing .stem.mp4 → re-transcribe its vocals track and
      // rewrite the lyrics atom, skipping separation entirely.
      const lyricsOnly = /\.stem\.mp4$/i.test(file.name);

      let audio;
      let result;
      if (canReuse) {
        // Re-transcribe: reuse the previous run's decoded audio + separated stems.
        audio = reuseStemsRef.current.audio;
        result = reuseStemsRef.current.result;
        setRtf(null);
        log(
          `re-transcribe: reusing separated stems (${audio.duration.toFixed(0)}s) — skipping separation`
        );
      } else if (lyricsOnly) {
        log(`lyrics-only: extracting vocals from ${file.name} …`);
        audio = await extractVocalsFromStem(file);
        result = { vocals: { left: audio.left, right: audio.right } };
        setRtf(null);
        log(`vocals extracted (${audio.duration.toFixed(0)}s) — skipping separation`);
      } else {
        log(`decoding ${file.name} …`);
        audio = await decodeAudio(file);
      }

      // --- Demucs stem separation (in-browser, WebGPU) --- (skipped when reusing stems)
      if (!lyricsOnly && !canReuse) {
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
        perf.separation = sec;
        perf.audioSec = audio.duration;
        setRtf(realtime);
        log(
          `separation done in ${sec.toFixed(1)}s — ${realtime.toFixed(2)}× realtime [${modeLabel}]`
        );
      } // end separation (skipped when reusing stems)

      // Stash the decoded audio + separated stems so a later "Re-transcribe" can re-run
      // Whisper with changed settings without redoing the ~50s separation. (On a reuse
      // run this just re-points at the same objects.)
      reuseStemsRef.current = { fileName: file.name, audio, result };

      // --- Whisper transcription of the vocals stem (in-browser) ---
      setStatus('transcribing');
      const want = asrModel;
      const device = gpu === 'available' ? 'webgpu' : 'wasm';
      // CRITICAL dtype: transformers.js DEFAULTS WebGPU to fp32, which loads the
      // huge fp32 ONNX (v3-turbo's decoder is 2.5GB) → unusably slow / OOM. q4f16
      // is 4-bit weights + fp16 compute: tiny (v3-turbo ~564MB) and FAST on WebGPU
      // (measured ~13× realtime vs fp32 not finishing in 4 min). On wasm, q8.
      // fp16 matches PyTorch text quality (fp16==fp32 measured); q4f16 (4-bit) is
      // smaller/faster but loses accuracy. User-selectable. On wasm, q8.
      const dtype = device === 'webgpu' ? whisperDtype : 'q8';
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
      // True if time t sits inside a SUSTAINED instrumental gap — vocals below the
      // silence threshold continuously for >= minGapSec. This is how we drop Whisper's
      // hallucinations over instrumental breaks (e.g. a guitar solo) the way
      // openai-whisper naturally emits nothing there — WITHOUT touching real verses,
      // which stay well above threshold. Gold-validated: 1.5s catches the solo, never
      // nips a real line (brief breath gaps are < 1.5s). Loud non-lyrical vocal sounds
      // over a solo (~45% peak) are NOT silence and are left to LLM/reference correction.
      const inSilentGap = (t, minGapSec = 1.5) => {
        const c = Math.min(nWin - 1, Math.max(0, Math.floor((t * 16000) / winLen)));
        if (rms[c] > silentThresh) return false; // over audible vocals → keep
        let lo = c;
        let hi = c;
        while (lo > 0 && rms[lo] <= silentThresh) lo--;
        while (hi < nWin - 1 && rms[hi] <= silentThresh) hi++;
        return (hi - lo) * WIN_SEC >= minGapSec;
      };
      log(
        `vocals energy profile: peak=${peakRms.toFixed(4)}, silence threshold=${silentThresh.toFixed(4)} (${Math.round(SILENT_FRAC * 100)}% of peak)`
      );

      // Whisper context (vocab hints) — build the SAME initialPrompt the native
      // creator does (title + distinctive lyric words), via the shared backend
      // prepareWhisperContext, so the web transcription is prompted IDENTICALLY to
      // Python (for a fair comparison). Best-effort.
      let whisperPrompt = null;
      {
        const bn = file.name.replace(/\.[^.]+$/, '');
        const dm = bn.match(/^(.+?)\s*-\s*(.+)$/);
        const ctxArtist = songArtist.trim() || (dm ? dm[1].trim() : '');
        const ctxTitle = songTitle.trim() || (dm ? dm[2].trim() : bn);
        try {
          const ctx = await creatorCall('prepareWhisperContext', '/admin/creator/whisper-context', {
            title: ctxTitle,
            artist: ctxArtist,
            existingLyrics: referenceLyrics.trim() || null,
          });
          whisperPrompt = ctx?.initialPrompt || null;
          if (whisperPrompt)
            log(`whisper prompt (matches native): "${whisperPrompt.slice(0, 80)}…"`);
        } catch (e) {
          log(`whisper context skipped (${e.message})`);
        }
      }

      const tStart = performance.now();
      log(`transcribing ${audioMin} min of vocals on ${device} …`);
      // Live feedback (the native tab streams whisper progress; we do the same via
      // transformers.js's WhisperTextStreamer — VERIFIED to fire, unlike the plain
      // callback_function). on_chunk_start ticks per 30s chunk; the text callback
      // streams progress. The sequential seek-loop below drives its own per-window
      // progress (one asr() call per window), so no WhisperTextStreamer here. A 1s
      // heartbeat keeps elapsed time moving in the status line.
      let chunkIdx = 0;
      const hb = setInterval(() => {
        const el = ((performance.now() - tStart) / 1000).toFixed(0);
        setTranscribeInfo(`transcribing window ${chunkIdx} · ${el}s`);
      }, 1000);
      // NOTE: we do NOT pass a `prompt` to the chunked pipeline. transformers.js
      // expects tokenized `prompt_ids` (not a raw string), and feeding a string
      // prompt into the long-form/chunked decode destabilizes it — it can lock onto
      // the prompt and drop real lyrics mid-song. The reference lyrics still help via
      // the post-transcription LLM correction. (If we want true prompting later, do
      // it with tokenizer-produced prompt_ids.)
      const promptText = whisperPrompt;
      const useWordTs = timestampMode === 'word';
      // Prompt parity with the native creator: tokenize the SAME initialPrompt and pass
      // it as Whisper prompt_ids (the correct transformers.js mechanism — a raw string
      // is mishandled by the chunked decode). If tokenizing isn't supported we skip it
      // rather than risk destabilizing the decode.
      let promptIds = null;
      if (promptText) {
        try {
          if (typeof asr.tokenizer?.get_prompt_ids === 'function') {
            promptIds = asr.tokenizer.get_prompt_ids(promptText);
          } else if (typeof asr.tokenizer?._build_translation === 'undefined') {
            // No prompt tokenizer API — pass the string; transformers.js will tokenize
            // it internally if it supports `prompt`. (Logged so we can see the path.)
            promptIds = null;
          }
        } catch (e) {
          log(`prompt tokenize failed (${e.message}) — transcribing without prompt`);
        }
      }
      // SEQUENTIAL seek-loop transcription — matches openai-whisper's long-form
      // algorithm (what the Python creator uses), NOT transformers.js's fixed-grid
      // chunking. Each pass transcribes a 30s window, then advances the window start
      // to the model's PREDICTED last-segment-end (snapping to a phrase boundary) so
      // no lyric line ever straddles a chunk seam. Window content is fed to the model
      // un-chunked (≤30s → zero-padded internally).
      log(`transcribing with silence-aware vocal segmentation${promptText ? ', prompt ON' : ''}`);
      const SR16 = 16000;
      const totalSamples = mono.length;
      const allChunks = [];
      const baseOpts = {
        return_timestamps: useWordTs ? 'word' : true,
        ...(language && language !== 'auto' ? { language } : {}),
        ...(promptIds ? { prompt_ids: promptIds } : promptText ? { prompt: promptText } : {}),
        // Anti-loop: Whisper's decoder collapses on repetitive audio (the "Hey Jude"
        // coda → "na"×444 / "better"×220 stamped into a 0.4s window) — a model failure,
        // not a timing bug. openai-whisper guards this with a compression-ratio reject;
        // transformers.js doesn't, but it DOES honor these two logits processors
        // (verified present in the 3.8.1 bundle):
        //  • repetition_penalty downweights already-emitted tokens so it stops repeating;
        //  • no_repeat_ngram_size 3 forbids any 3-gram from recurring — this breaks the
        //    pathological loop while still allowing the REAL coda ("na-na-na-na, hey Jude"
        //    repeats fine because "hey Jude" changes the n-gram each phrase).
        repetition_penalty: 1.2,
        no_repeat_ngram_size: 3,
      };

      // no_speech_prob — Whisper's REAL "is anyone speaking?" signal, the same one the
      // Python runner uses to drop instrumental sections. The decoder ONNX outputs
      // `logits` every step; transformers.js's pipeline discards them, but it accepts a
      // `logits_processor` that is called per step with the live logits. We attach a
      // NON-DESTRUCTIVE processor that, at the FIRST decode step (the <|startoftranscript|>
      // position), reads softmax(logits)[<|nospeech|>] and stashes it — then returns the
      // logits UNCHANGED so transcription is unaffected. (Token ids are tokenizer-verified
      // for large-v3-turbo: SOT=50258, <|nospeech|>=50363.)
      const NO_SPEECH_TOKEN = 50363;
      const LogitsProcessor = tf?.LogitsProcessor;
      const makeNoSpeechCapture = () => {
        if (!LogitsProcessor) return null;
        const cap = new (class extends LogitsProcessor {
          constructor() {
            super();
            this.prob = null;
          }
          _call(inputIds, logits) {
            // Capture once, at the first decode step (the <|startoftranscript|>
            // position) — that's where Whisper computes no_speech. logits is a
            // Tensor [batch, vocab]; read row 0. Non-destructive (returns unchanged).
            try {
              if (this.prob === null) {
                const row = logits.dims?.length === 2 ? logits[0] : logits; // [vocab]
                const data = row.data ?? row;
                const vocab = row.dims ? row.dims[row.dims.length - 1] : data.length;
                let mx = -Infinity;
                for (let i = 0; i < vocab; i++) if (data[i] > mx) mx = data[i];
                let sum = 0;
                for (let i = 0; i < vocab; i++) sum += Math.exp(data[i] - mx);
                this.prob = Math.exp(data[NO_SPEECH_TOKEN] - mx) / sum;
              }
            } catch {
              /* if shape surprises us, just don't gate this window (fail-safe) */
            }
            return logits; // non-destructive
          }
        })();
        return cap;
      };

      // Transcribe ONE ≤30s window via the reliable pipeline call, with the no_speech
      // capture attached. Returns the decoded chunks + the window's no_speech_prob.
      const transcribeWindow = async (window) => {
        const cap = makeNoSpeechCapture();
        const w = await asr(window, {
          ...baseOpts,
          ...(cap ? { logits_processor: [cap] } : {}),
        });
        return { chunks: w.chunks || [], text: w.text || '', noSpeech: cap?.prob ?? null };
      };

      // Plan transcription segments on the VOCALS STEM's own silence (not a blind time
      // grid): cuts land at vocal-silence so a sung phrase is never split at a seam,
      // each segment is ≤30s, and consecutive segments step back `overlapSec` so
      // boundary words are seen in both (reconciled after). Uses the RMS profile above.
      const plan = planVocalSegments(rms, {
        hopSec: WIN_SEC,
        durationSec: audio.duration,
        minSegSec: 20, // always take 20s, then cut at the best dip in the next 10s
        maxSegSec: 30,
        overlapSec: 0, // cuts land in vocal DIPS → no word is split → no overlap needed
        dipSec: 0.5,
      });
      log(`planned ${plan.length} vocal-aware segment(s) (20s + best-dip cut, ≤30s, clean cuts)`);

      let out;
      try {
        for (let pi = 0; pi < plan.length; pi++) {
          const { start, end } = plan[pi];
          chunkIdx += 1;
          const s0 = Math.max(0, Math.floor(start * SR16));
          const s1 = Math.min(totalSamples, Math.ceil(end * SR16));
          const window = mono.subarray(s0, s1);
          setTranscribeInfo(`segment ${chunkIdx}/${plan.length} @ ${start.toFixed(0)}s …`);
          const w = await transcribeWindow(window);
          // Collect this segment's words in order (cuts land in vocal dips → no overlap,
          // no dedup needed). Hallucinations over instrumental gaps are removed below by
          // the annotation strip + sustained-silence cull.
          const segs = (w.chunks || []).filter((c) => (c.text || '').trim());
          for (const c of segs) {
            const ts = c.timestamp || [c.start, c.end];
            const a = ts[0] != null ? ts[0] + start : null;
            const b = ts[1] != null ? ts[1] + start : null;
            if (a == null) continue;
            allChunks.push({ text: c.text, timestamp: [a, b != null ? b : a + 0.4] });
          }

          // Live update from what we have so far.
          if (allChunks.length) {
            const flat = allChunks.map((c) => ({
              text: c.text,
              start: c.timestamp[0],
              end: c.timestamp[1],
            }));
            setLyrics(groupWordsIntoLines(flat, { duration: audio.duration }));
          }
          log(
            `  segment ${chunkIdx} @ ${start.toFixed(0)}-${end.toFixed(0)}s: ${segs.length} seg(s)`
          );
        }

        // allChunks already holds every segment's words in time order (no overlap → no
        // dedup needed). Sort defensively in case segment ordering ever changes.
        allChunks.sort((a, b) => (a.timestamp[0] ?? 0) - (b.timestamp[0] ?? 0));
        out = { chunks: allChunks, text: allChunks.map((c) => c.text).join('') };
      } finally {
        clearInterval(hb);
        setTranscribeInfo('');
      }
      const tSec = (performance.now() - tStart) / 1000;
      perf.transcription = tSec;
      if (!perf.audioSec) perf.audioSec = audio.duration;

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
        // Flat-TEXT dumps (loukai's console serializer flattens objects to
        // "[object Object]", so console.table/group are useless — print strings).

        console.log(
          '🎤 WHISPER DIAG | dur=' + audio.duration.toFixed(1) + 's words=' + words.length
        );
        console.log('🎤 FULL TEXT: ' + (out.text || ''));
        console.log('🎤 buckets/30s: ' + bucketStr);
        for (const g of gaps) {
          console.log(`🎤 GAP ${g.gapSec}s: ${g.from} -> ${g.to}`);
        }
        // Per-word timeline as one big string (chunked into 10s windows for readability).
        const byTen = {};
        for (const r of wordRows) {
          const b = Math.floor((r.start ?? 0) / 10) * 10;
          (byTen[b] ||= []).push(`${(r.start ?? 0).toFixed(1)}|${r.text}`);
        }
        for (const k of Object.keys(byTen)
          .map(Number)
          .sort((a, b) => a - b)) {
          console.log(`🎤 ${k}-${k + 10}s (${byTen[k].length}w): ${byTen[k].join('  ')}`);
        }
      }
      // Hallucination trim. Two gold-validated signals (no run lost a real lyric):
      //  (1) ANNOTATION strip, EVERYWHERE — Whisper marks non-lyrical audio with
      //      "*Music*"/"[Applause]"/♪/# tokens (incl. split "*Country" then "music*").
      //      Any word containing * [ ] # ♪ ♫ is dropped; real lyrics never have those.
      //  (2) SUSTAINED-SILENCE cull, EVERYWHERE — drop a word that falls inside an
      //      instrumental gap where the vocals stem is silent for >= 1.5s continuously
      //      (a guitar solo / long break / intro / outro fade). This is how
      //      openai-whisper naturally emits nothing there. Real verses sit far above
      //      the silence threshold, and brief breath gaps are < 1.5s, so neither is
      //      touched. (Loud NON-lyrical vocal sounds over a solo are not silence and
      //      survive here — those are left to LLM/reference correction.)
      const isAnnotation = (s) => /[*[\]#♪♫]/.test((s || '').trim());
      // Stuck-decoder loop cull — the strongest tell. Whisper can lock onto a repeated
      // word/phrase (the "Hey Jude" outro → "better, better, better…" ~400×) and emit it
      // until max-length, and the dead giveaway is the TIMESTAMPS: those words start only
      // ~0.02-0.1s apart, which is physically impossible for sung lyrics. openai-whisper
      // suppresses this via a compression-ratio threshold; transformers.js doesn't, so we
      // detect the collision directly: once words start arriving < minStartGap apart we're
      // in a loop — drop them until the timeline advances again. Energy/text-independent,
      // so it also catches loops where the repeated token drifts slightly.
      {
        const minStartGap = 0.08; // s; consecutive word starts closer than this = a loop
        const startOf = (w) => (w.timestamp ? w.timestamp[0] : w.start) ?? null;
        const kept = [];
        let prevStart = null; // start of the IMMEDIATELY previous word (kept or dropped)
        let dropped = 0;
        for (const w of words) {
          const s = startOf(w);
          // Compare to the previous word's start regardless of whether it was kept —
          // a stuck loop advances ~0.02s per token, so every step collides; comparing to
          // the last KEPT word would let one survivor through every minStartGap.
          const collide = s != null && prevStart != null && s - prevStart < minStartGap;
          if (s != null) prevStart = s;
          if (collide) {
            dropped++;
            continue;
          }
          kept.push(w);
        }
        if (dropped) {
          log(
            `dropped ${dropped} time-collided word(s) (<${minStartGap}s apart → stuck decoder loop)`
          );
          words = kept;
        }
      }
      {
        const before = words.length;
        const culled = [];
        words = words.filter((w) => {
          const text = (w.text || '').trim();
          const ts = w.timestamp || [w.start, w.end];
          const mid = ts[0] != null && ts[1] != null ? (ts[0] + ts[1]) / 2 : ts[0];
          if (isAnnotation(text)) {
            culled.push({ text, t: mid == null ? -1 : Number(mid.toFixed(2)), why: 'annotation' });
            return false;
          }
          if (mid == null) return true;
          if (inSilentGap(mid)) {
            culled.push({ text, t: Number(mid.toFixed(2)), why: 'instrumental gap' });
            return false;
          }
          return true;
        });
        if (culled.length) {
          log(`trimmed ${culled.length} hallucinated word(s) (annotation / instrumental gap):`);
          for (const c of culled) log(`    ✂ "${c.text}" @ ${c.t}s (${c.why})`);
        } else if (before) {
          log('no hallucinations to trim');
        }
      }
      // Isolated-word-after-big-gap cull — the outro fade tell. A word stranded by a
      // large gap (>= isoGap) on BOTH sides is almost always a stuck-decoder ghost over
      // the fade ("…Judas… …dude…" 14s apart, long after the song body). Real lyrics
      // arrive in phrases, never single words 8s+ from any neighbor. (First/last word
      // only needs one big side; energy-independent, so it works even if the outro choir
      // keeps the stem from going silent.)
      {
        const isoGap = 8; // s
        const startOf = (w) => (w.timestamp ? w.timestamp[0] : w.start) ?? null;
        const endOf = (w) => (w.timestamp ? w.timestamp[1] : w.end) ?? startOf(w);
        const stranded = [];
        words = words.filter((w, i) => {
          const s = startOf(w);
          if (s == null) return true;
          const prevEnd = i > 0 ? endOf(words[i - 1]) : null;
          const nextStart = i < words.length - 1 ? startOf(words[i + 1]) : null;
          const gapBefore = prevEnd != null ? s - prevEnd : Infinity;
          const gapAfter = nextStart != null ? nextStart - (endOf(w) ?? s) : Infinity;
          if (gapBefore >= isoGap && gapAfter >= isoGap) {
            stranded.push({ text: (w.text || '').trim(), t: Number(s.toFixed(1)) });
            return false;
          }
          return true;
        });
        if (stranded.length) {
          log(
            `dropped ${stranded.length} stranded word(s) (isolated >${isoGap}s from neighbors → fade ghost):`
          );
          for (const c of stranded) log(`    ✂ "${c.text}" @ ${c.t}s`);
        }
      }
      // "Thank you" / "thanks for watching" cull — Whisper's most common ghost,
      // clustering over the dead intro/outro. cullOutroThanks removes only the ones
      // OUTSIDE the lyric body, so songs that sing "thank you" within the body
      // (Alanis "Thank U") keep every one. (See creatorAudio.js for the rationale.)
      {
        const r = cullOutroThanks(words);
        if (r.removed.length) {
          words = r.words;
          log(
            `dropped ${r.removed.length} "thank you" hallucination word(s) outside lyric body: ${r.removed.join(' ')}`
          );
        }
      }
      log(`after VAD: ${words.length} words`);
      let lines = words.length
        ? groupWordsIntoLines(words, { duration: audio.duration })
        : [{ text: (out.text || '').trim(), start: 0, end: audio.duration }];
      // Final alignment pass: snap each line's start/end to the actual vocal onset/
      // offset (Whisper timestamps drift on singing). Preserves the `.dropped` marker.
      const droppedMark = lines.dropped;
      lines = snapToVocalEnergy(lines, rms, {
        hopSec: WIN_SEC,
        searchSec: 0.5,
        silentFrac: SILENT_FRAC,
      });
      if (droppedMark) lines.dropped = droppedMark;
      // Non-overlap invariant. Whisper is single-speaker — it can't transcribe two
      // simultaneous voices, so two lyric lines can NEVER legitimately occupy the same
      // instant. Any overlap is an artifact: a SMALL one is independent snapping of
      // adjacent line bounds (snapToVocalEnergy nudges line N's end forward and N+1's
      // start back until they cross by a few hundred ms); a LARGE one is a stretched
      // (maxLineDur) or residual-loop line. Both are wrong, so enforce the invariant as
      // the final step: sort by start, then clamp each line's end to where the next line
      // begins so exactly one line is active at a time (the karaoke invariant). Only fires
      // on REAL overlap (end > nextStart), never on lines that merely touch.
      {
        const dm = lines.dropped;
        lines.sort((a, b) => a.start - b.start);
        let small = 0;
        let large = 0;
        for (let i = 0; i < lines.length - 1; i++) {
          const next = lines[i + 1];
          const overlap = lines[i].end - next.start;
          if (overlap > 0) {
            lines[i].end = Math.max(lines[i].start + 0.1, next.start);
            if (overlap > 1) large++;
            else small++;
          }
        }
        if (dm) lines.dropped = dm;
        if (small || large) {
          log(
            `enforced non-overlap on ${small + large} line(s) (single-speaker → one line at a time` +
              `${large ? `; ${large} large >1s` : ''})`
          );
        }
      }
      // Junk-line filter — implausible line TIMING is a hallucination tell, at both
      // extremes. Real sung lines run ~1-8s at ~0.3-0.8s per word. Drop a line that is:
      //  • a sub-second flash (< minLineDur) AND not a lone short interjection
      //    ("Hey!"/"Yeah!" can be brief — keep a single short word), OR
      //  • too DENSE (> maxWordsPerSec — residual loop crammed into a moment), OR
      //  • too SPARSE (multi-word but > maxSecPerWord on average — the intro/outro
      //    garble where a few wrong words get smeared across many seconds).
      // Runs AFTER the non-overlap clamp so clamp-created shorties are caught too.
      {
        const minLineDur = 1.0;
        const maxWordsPerSec = 8;
        const maxSecPerWord = 3.0;
        const junked = [];
        lines = lines.filter((l) => {
          const dur = (l.end ?? l.start) - l.start;
          const nWords = (l.text || '').trim().split(/\s+/).filter(Boolean).length;
          if (nWords === 0) {
            junked.push({ text: l.text, t: l.start, why: 'empty' });
            return false;
          }
          if (dur < minLineDur && nWords > 1) {
            junked.push({ text: l.text, t: l.start, why: `flash ${dur.toFixed(2)}s` });
            return false;
          }
          if (dur > 0) {
            const wps = nWords / dur;
            if (wps > maxWordsPerSec) {
              junked.push({ text: l.text, t: l.start, why: `too dense ${wps.toFixed(1)} w/s` });
              return false;
            }
            if (nWords > 1 && dur / nWords > maxSecPerWord) {
              junked.push({
                text: l.text,
                t: l.start,
                why: `smeared ${(dur / nWords).toFixed(1)} s/word`,
              });
              return false;
            }
          }
          return true;
        });
        if (junked.length) {
          log(`dropped ${junked.length} junk line(s) (implausible timing):`);
          for (const j of junked) log(`    ✂ "${j.text}" @ ${j.t.toFixed(1)}s (${j.why})`);
        }
      }
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

      // NOTE: LLM lyric correction is NOT done here in the UI. The renderer sends the
      // RAW transcription + reference lyrics to the BACKEND save, which runs the
      // correction server-side (resolving LLM settings the same way the native creator
      // does). This keeps one code path identical to Python and avoids the web UI
      // touching LLM endpoints. We just gather the reference lyrics to send along.
      const correctedWords = words;
      setLlmStats(null);
      const refLyrics = referenceLyrics.trim(); // sent to backend; it looks up if empty

      // --- CREPE pitch → musical key (parity: native uses CREPE for key detection;
      // pitch track stored best-effort). Reuses the 16k mono vocals. Best-effort.
      // Skipped when the user disables pitch detection in Settings. ---
      let detectedKey = null;
      let pitchData = null;
      try {
        if (!enableCrepe) {
          log('pitch detection (CREPE) disabled in settings — skipping');
          throw new Error('crepe-disabled'); // jump to the catch, leaves pitch/key null
        }
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
        perf.pitch = (performance.now() - ct0) / 1000;
        log(`CREPE pitch done in ${perf.pitch.toFixed(1)}s`);
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

      // ⏱️ TIMING SUMMARY — directly comparable to the Python/native creator's.
      {
        const totalSec = (performance.now() - runT0) / 1000;
        const a = perf.audioSec || audio.duration || 0;
        const x = (s) => (s && a ? `${(a / s).toFixed(1)}× rt` : '—');
        const ep = gpu === 'available' ? 'webgpu' : 'wasm';
        log('⏱️ TIMING (WebGPU/in-browser creator):');
        log(`    audio length:   ${a ? a.toFixed(1) + 's' : '?'}`);
        if (perf.separation)
          log(
            `    separation:     ${perf.separation.toFixed(1)}s  (${x(perf.separation)})  [${demucsModel} on ${ep}]`
          );
        if (perf.transcription)
          log(
            `    transcription:  ${perf.transcription.toFixed(1)}s  (${x(perf.transcription)})  [${asrModel.split('/').pop()} ${whisperDtype} on ${ep}]`
          );
        if (perf.pitch)
          log(`    pitch (CREPE):  ${perf.pitch.toFixed(1)}s  (${x(perf.pitch)})  [${ep}]`);
        log(
          `    TOTAL:          ${totalSec.toFixed(1)}s  (${x(totalSec)})  (excludes encode/save)`
        );
        // Also as ONE copyable line (loukai console flattens objects → use a string),
        // so it's unmissable in DevTools or the Electron terminal next to 📋.

        console.log(
          '⏱️ TIMING_WEB ' +
            JSON.stringify({
              audioSec: Number(a.toFixed(1)),
              separation: Number(perf.separation.toFixed(1)),
              transcription: Number(perf.transcription.toFixed(1)),
              pitch: Number(perf.pitch.toFixed(1)),
              total: Number(totalSec.toFixed(1)),
              ep,
              demucs: demucsModel,
              whisper: asrModel.split('/').pop(),
              dtype: whisperDtype,
            })
        );
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

      // Encode each stem WAV -> AAC-in-MP4 here in the renderer (ffmpeg-wasm).
      // stem-mp4 0.5.x muxes PRE-ENCODED AAC tracks; it no longer encodes. All
      // stems use identical params so the multi-track sample tables align.
      log('encoding stems to AAC (ffmpeg-wasm)…');
      const aacBytes = {};
      for (const k of Object.keys(wavBlobs)) {
        aacBytes[k] = await encodeWavToAac(wavBlobs[k], { tag: k });
      }

      if (window.kaiAPI?.creator?.saveWebGpuStems) {
        // Electron player: IPC (no admin HTTP session here). Send AAC bytes.
        const stems = aacBytes;
        const r = await window.kaiAPI.creator.saveWebGpuStems({
          stems,
          metadata: {
            title,
            artist,
            album,
            duration: audio.duration,
            key: detectedKey,
            year: songTags.year,
            genre: songTags.genre,
            track: songTags.track,
            disk: songTags.disk,
            albumartist: songTags.albumartist,
            composer: songTags.composer,
          },
          lyrics: lyricsPayload,
          pitch: pitchData,
          referenceLyrics: refLyrics, // backend corrects server-side (looks up if empty)
        });
        if (!r?.success) throw new Error(`save failed: ${r?.error || 'unknown'}`);
        saved = r;
      } else {
        // Web admin (browser): authed HTTP. credentials:'include' sends the session.
        const fd = new FormData();
        fd.append('title', title);
        fd.append('artist', artist);
        if (album) fd.append('album', album);
        if (songTags.year) fd.append('year', String(songTags.year));
        if (songTags.genre) fd.append('genre', songTags.genre);
        if (songTags.track) fd.append('track', String(songTags.track));
        fd.append('duration', String(audio.duration));
        fd.append('lyrics', JSON.stringify(lyricsPayload));
        if (detectedKey) fd.append('key', detectedKey);
        if (pitchData) fd.append('pitch', JSON.stringify(pitchData));
        if (refLyrics) fd.append('referenceLyrics', refLyrics);
        for (const [k, bytes] of Object.entries(aacBytes)) {
          fd.append(k, new Blob([bytes], { type: 'audio/mp4' }), `${k}.m4a`);
        }
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
      // Report the backend's LLM correction result (it ran server-side during save).
      if (saved.llmStats) {
        setLlmStats(saved.llmStats);
        log(
          `LLM correction (backend): ${saved.llmStats.corrections_applied ?? 0} lines changed` +
            `${saved.llmStats.failed ? ' (failed: ' + (saved.llmStats.error || '') + ')' : ''}`
        );
      }
      setCompletedFile(saved.outputPath || null);
      setStatus('done');
      log(`✅ saved to library: ${saved.fileName}`);
    } catch (e) {
      console.error(e);
      log(`ERROR: ${e.message}`);
      setError(e.message || 'Conversion failed');
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
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create Karaoke ⚡</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Stem separation + transcription run entirely in your browser — no Python.
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
        </div>

        <ErrorDisplay error={error} onDismiss={() => setError(null)} />

        {/* Sub-tab navigation */}
        <div className="flex border-b border-gray-300 dark:border-gray-600">
          {['create', 'settings'].map((tab) => (
            <button
              key={tab}
              className={`px-4 py-2 font-medium transition-colors capitalize ${
                activeSubTab === tab
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              onClick={() => setActiveSubTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ===================== CREATE TAB ===================== */}
        {activeSubTab === 'create' && (
          <div className="flex flex-col gap-4">
            {/* Big drag-and-drop target */}
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
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {fileLoading ? (
                <Spinner size="sm" message="Reading file info & searching lyrics…" />
              ) : (
                <>
                  <div className="text-4xl">{fileName ? '🎵' : '⬆️'}</div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">
                    {fileName || 'Drop an audio file here, or click to browse'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    mp3 · wav · flac · m4a · mp4 · .stem.mp4
                  </div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.mp4,.stem.mp4"
                className="hidden"
                disabled={busy}
                onChange={() => onFileSelect()}
              />
            </label>

            {/* Song info + lyric assist */}
            <div className={`${STYLES.card} flex flex-col gap-3`}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                <label className={STYLES.label}>
                  Album
                  <input
                    type="text"
                    value={songAlbum}
                    onChange={(e) => setSongAlbum(e.target.value)}
                    disabled={busy}
                    placeholder="Album (optional)"
                    className={STYLES.input}
                  />
                </label>
              </div>
              <label className={STYLES.label}>
                Reference lyrics (optional — improves accuracy + enables LLM correction)
                <textarea
                  value={referenceLyrics}
                  onChange={(e) => setReferenceLyrics(e.target.value)}
                  disabled={busy}
                  rows={3}
                  placeholder="Paste known lyrics, or use Find lyrics →"
                  className={`${STYLES.input} font-mono`}
                />
              </label>
              <button
                type="button"
                onClick={() => lookupLyrics()}
                disabled={busy || lookingUp || !songTitle}
                className="self-start px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
              >
                {lookingUp ? <Spinner size="sm" /> : '🔎'}
                {lookingUp ? 'Searching lyrics…' : 'Find lyrics'}
              </button>
            </div>
          </div>
        )}

        {/* ===================== SETTINGS TAB ===================== */}
        {activeSubTab === 'settings' && (
          <div className={`${STYLES.card} flex flex-col gap-4`}>
            <h3 className={STYLES.sectionTitle}>Creator Settings</h3>
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
                <option value="segment">segment/line (robust, keeps all lines — default)</option>
                <option value="word">word-level (precise timing, may drop lines)</option>
              </select>
            </label>
            <label className="text-sm text-gray-700 dark:text-gray-300">
              Whisper precision (WebGPU):
              <select
                className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                value={whisperDtype}
                onChange={(e) => setWhisperDtype(e.target.value)}
                disabled={busy}
              >
                <option value="q4f16">
                  q4f16 — 4-bit, fastest/smallest (same accuracy — default)
                </option>
                <option value="fp16">fp16 — larger/slower, no measured accuracy gain</option>
                <option value="fp32">fp32 — full precision (largest, slow)</option>
              </select>
            </label>
            <label className="text-sm text-gray-700 dark:text-gray-300">
              Language:
              <select
                className="ml-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={busy}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
                <option value="auto">Auto-detect</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={enableCrepe}
                onChange={(e) => setEnableCrepe(e.target.checked)}
                disabled={busy}
                className="rounded"
              />
              Detect pitch + musical key (CREPE)
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
          </div>
        )}

        {/* Create button + status — always visible below the tabs. Disabled while a file
            is loading (reading tags) or a lyric lookup is in flight; lit once that
            finishes, whether or not lyrics were found (lyrics are optional — Whisper
            transcribes from the audio regardless). */}
        <div className="flex flex-col gap-2">
          <button
            onClick={run}
            disabled={busy || !fileName || fileLoading || lookingUp}
            className={STYLES.btnPrimary}
          >
            {busy
              ? 'Working…'
              : fileLoading || lookingUp
                ? 'Looking up lyrics…'
                : 'Create Karaoke ⚡'}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            First run downloads htdemucs (~172 MB) + the chosen Whisper model via loukai (cached
            locally afterwards).
          </p>
        </div>

        {status === 'separating' && (
          <div className={STYLES.card}>
            <StemProgressBars
              progress={stemProgress}
              label={`Separating stems · ${demucsModel === 'htdemucs_ft' ? 'htdemucs_ft (4 models)' : 'htdemucs'} on GPU…`}
            />
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

        {/* Completion card — Open in Editor / Create Another (matches native creator) */}
        {status === 'done' && (
          <div className={`${STYLES.card} flex flex-col gap-3`}>
            <div className="text-lg font-semibold text-green-700 dark:text-green-400">
              ✅ Karaoke file created!
            </div>
            {(songTitle || songArtist) && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <SongTitle artist={songArtist} title={songTitle} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {completedFile && (
                <button onClick={handleOpenInEditor} className={STYLES.btnPrimary}>
                  ✏️ Open in Editor
                </button>
              )}
              {/* Re-transcribe: re-run Whisper (+ culls + save) with the CURRENT settings,
                  reusing the already-separated stems — skips the ~50s Demucs step. Useful
                  to iterate on Whisper model / language / de-loop without re-separating. */}
              {reuseStemsRef.current && (
                <button onClick={() => run(true)} className={STYLES.btnSecondary} disabled={busy}>
                  🔁 Re-transcribe
                </button>
              )}
              <button onClick={handleCreateAnother} className={STYLES.btnSecondary}>
                ➕ Create Another
              </button>
            </div>
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
          <div className={`${STYLES.card} max-h-72 overflow-auto`}>
            <h3 className={STYLES.sectionTitle}>
              Lyrics
              {(songTitle || songArtist) && (
                <span className="ml-2 font-normal text-sm text-gray-500 dark:text-gray-400">
                  <SongTitle artist={songArtist} title={songTitle} />
                </span>
              )}
            </h3>
            <div className="text-sm space-y-0.5 font-mono">
              {lyrics.map((l, i) => (
                <div key={i} className="text-gray-700 dark:text-gray-300">
                  {l.start != null && (
                    <span className="text-gray-400 mr-2">
                      [{l.start.toFixed(2)}
                      {l.end != null ? `→${l.end.toFixed(2)}` : ''}]
                    </span>
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
