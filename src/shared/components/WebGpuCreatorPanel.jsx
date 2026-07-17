import { useEffect, useRef, useState } from 'react';
import * as StemExtractor from 'stem-mp4/extractor';
import {
  WHISPER_MODELS,
  WHISPER_LANGUAGES,
  DEMUCS_MODELS,
  encodeWav,
} from '../creator/creatorAudio.js';
import { encodeWavToAac } from '../creator/aacEncoder.js';
import { createKaraokeInWorker } from '../creator/createKaraokeClient.js';
import {
  STYLES,
  Spinner,
  ErrorDisplay,
  SongTitle,
  StemProgressBars,
  CreatorJobBanner,
} from './creatorUi.jsx';
import { useCreatorJob } from '../hooks/useCreatorJob.js';

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
  // Outcome of the last reference-lyrics lookup, surfaced in the UI so a failed /
  // empty lookup is obvious (lyrics are optional — this never blocks Create, but
  // the user should SEE that none were found before they create without them).
  // 'idle' | 'found' | 'none' | 'error'
  const [lyricStatus, setLyricStatus] = useState('idle');
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
  const logEnd = useRef(null);

  // Observe the single creator job (broadcast by main on every surface). In the
  // player this compute runs locally, so we only use the job to show a banner when
  // ANOTHER surface (a web admin / phone) is creating, and to block starting a
  // second one. `bridge` is omitted → the hook uses IPC (window.kaiAPI).
  const { job: creatorJob } = useCreatorJob();

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

  // The WebGPU creator runtime loads INSIDE the creator worker now (see
  // createKaraokeClient.js) - its load logs stream back through onLog. Nothing
  // heavy loads or runs on this (UI) thread anymore.

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
        setLyricStatus('found');
        log(
          `found lyrics (${plain.split('\n').length} lines) — will guide transcription + correction`
        );
      } else {
        setLyricStatus('none');
        log('no lyrics found for that title/artist');
      }
    } catch (e) {
      setLyricStatus('error');
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
    setLyricStatus('idle');
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
  // OfflineAudioContext pinned to 44.1k: decodeAudioData resamples to the
  // context rate, and htdemucs is trained at 44.1k — a device-rate (48k)
  // AudioContext fed the model ~9% slow audio and degraded every stem. It also
  // leaked a real AudioContext per decode (Chromium caps ~6 live).
  async function decodeAudio(file) {
    const arr = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 1, 44100);
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
    // 44.1k offline decode (see decodeAudio) — no leaked AudioContext.
    const ctx = new OfflineAudioContext(2, 1, 44100);
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
    try {
      // Lyrics-only mode: an existing .stem.mp4 → re-transcribe its vocals track and
      // rewrite the lyrics atom, skipping separation entirely.
      const lyricsOnly = /\.stem\.mp4$/i.test(file.name);

      let audio;
      let reuseInput = null;
      if (canReuse) {
        // Re-transcribe: reuse the previous run's decoded audio + separated stems.
        audio = reuseStemsRef.current.audio;
        reuseInput = reuseStemsRef.current.result;
        setRtf(null);
        log(
          `re-transcribe: reusing separated stems (${audio.duration.toFixed(0)}s) — skipping separation`
        );
      } else if (lyricsOnly) {
        log(`lyrics-only: extracting vocals from ${file.name} …`);
        audio = await extractVocalsFromStem(file);
        reuseInput = { vocals: { left: audio.left, right: audio.right } };
        setRtf(null);
        log(`vocals extracted (${audio.duration.toFixed(0)}s) — skipping separation`);
      } else {
        log(`decoding ${file.name} …`);
        audio = await decodeAudio(file);
      }

      // Whisper context (vocab hints) — build the SAME initialPrompt the native creator
      // does (title + distinctive lyric words), via the shared backend
      // prepareWhisperContext. Built HERE in the panel (it needs the UI's title/artist
      // + reference lyrics) and passed into the compute. Best-effort.
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

      // Run the compute in the creator WORKER (separation + Whisper + CREPE all
      // off the UI thread). The panel just maps its callbacks to React state; the
      // SAME worker runs headlessly when a phone commands the host.
      const created = await createKaraokeInWorker(
        { audio, stems: reuseInput, lyricsOnly },
        {
          asrModel,
          demucsModel,
          ftAvailable,
          device: gpu === 'available' ? 'webgpu' : 'wasm',
          whisperDtype,
          timestampMode,
          language,
          enableCrepe,
          whisperPrompt,
        },
        {
          onPhase: (p) => setStatus(p),
          onLog: (m) => log(m),
          onStemProgress: (p) => setStemProgress((prev) => ({ ...prev, ...p })),
          onTranscribeInfo: (info) => setTranscribeInfo(info),
          onLyricsPreview: (ls) => setLyrics(ls),
          onRtf: (x) => setRtf(x),
        }
      );

      const result = created.stems;
      const lines = created.lyrics.lines;
      const correctedWords = created.lyrics.words;
      const detectedKey = created.key;
      const pitchData = created.pitch;
      setLlmStats(null);
      const refLyrics = referenceLyrics.trim(); // sent to backend; it looks up if empty

      // Stash decoded audio + separated stems so a later "Re-transcribe" can re-run
      // Whisper with changed settings without redoing the ~50s separation.
      reuseStemsRef.current = { fileName: file.name, audio, result };

      // ⏱️ TIMING summary (one copyable line for DevTools / Electron terminal).
      {
        const t = created.timing;
        console.log(
          '⏱️ TIMING_WEB ' +
            JSON.stringify({
              audioSec: Number((t.audioSec || 0).toFixed(1)),
              separation: Number((t.separation || 0).toFixed(1)),
              transcription: Number((t.transcription || 0).toFixed(1)),
              pitch: Number((t.pitch || 0).toFixed(1)),
              total: Number((t.total || 0).toFixed(1)),
              ep: gpu === 'available' ? 'webgpu' : 'wasm',
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
      // CONCURRENT on the encoder worker pool: sequential encoding pinned one
      // core 5x as long as needed.
      log('encoding stems to AAC (ffmpeg-wasm, parallel)…');
      const stemKeys = Object.keys(wavBlobs);
      const encoded = await Promise.all(
        stemKeys.map((k) => encodeWavToAac(wavBlobs[k], { tag: k }))
      );
      const aacBytes = {};
      stemKeys.forEach((k, i) => {
        aacBytes[k] = encoded[i];
      });

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

  // A creation is running on ANOTHER surface (web admin / phone). We don't own it,
  // so block starting a second one (single-job contract) and show the banner.
  const remoteBusy = creatorJob?.status === 'running' && !busy;

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

        {/* A creation running on another surface (web admin / phone). selfActive when
            this panel is busy → suppressed (we show our own richer progress below). */}
        <CreatorJobBanner job={creatorJob} selfActive={busy} />

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
                accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.aif,.aiff,.mp4,.stem.mp4"
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
                <span className="flex items-center gap-2 flex-wrap">
                  Reference lyrics (optional — improves accuracy + enables LLM correction)
                  {lyricStatus === 'found' && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      ✓ lyrics found
                    </span>
                  )}
                  {lyricStatus === 'none' && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      ⚠ no lyrics found — will transcribe without a reference
                    </span>
                  )}
                  {lyricStatus === 'error' && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                      ⚠ lyric lookup failed — will transcribe without a reference
                    </span>
                  )}
                </span>
                <textarea
                  value={referenceLyrics}
                  onChange={(e) => {
                    setReferenceLyrics(e.target.value);
                    // Typed-in lyrics count as "have a reference"; clear a stale warning.
                    setLyricStatus(e.target.value.trim() ? 'found' : 'idle');
                  }}
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
                <option value="auto">Auto-detect</option>
                {WHISPER_LANGUAGES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
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
            disabled={busy || remoteBusy || !fileName || fileLoading || lookingUp}
            className={STYLES.btnPrimary}
          >
            {busy
              ? 'Working…'
              : remoteBusy
                ? 'Another creation is running…'
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
