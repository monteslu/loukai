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

const ORT_URL = 'https://esm.sh/onnxruntime-web@1.27.0/webgpu';
const DEMUCS_URL = 'https://esm.sh/demucs-web@1.0.2';
const TRANSFORMERS_URL = 'https://esm.sh/@huggingface/transformers@3.8.1';

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
  const eps = () => (gpu === 'available' ? ['webgpu', 'wasm'] : ['wasm']);

  async function loadLibs() {
    if (!libs.current.ort) {
      log('loading onnxruntime-web + demucs-web + transformers.js from CDN …');
      const [ort, demucs, tf] = await Promise.all([
        import(/* @vite-ignore */ ORT_URL),
        import(/* @vite-ignore */ DEMUCS_URL),
        import(/* @vite-ignore */ TRANSFORMERS_URL),
      ]);
      libs.current = {
        ort,
        DemucsProcessor: demucs.DemucsProcessor,
        CONSTANTS: demucs.CONSTANTS,
        pipeline: tf.pipeline,
      };
      try {
        if (ort.env?.webgpu) ort.env.webgpu.powerPreference = 'high-performance';
      } catch {
        /* ignore */
      }
    }
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
      const { ort, DemucsProcessor, CONSTANTS, pipeline } = await loadLibs();

      log(`decoding ${file.name} …`);
      const audio = await decodeAudio(file);

      // --- Demucs stem separation (in-browser) ---
      log(`separating on ${backend()} …`);
      const proc = new DemucsProcessor({
        ort,
        sessionOptions: { executionProviders: eps() },
        onProgress: ({ progress }) => setSepProgress(progress || 0),
        onLog: (phase, m) => log(`[${phase}] ${m}`),
      });
      const modelBuf = await fetch(CONSTANTS.DEFAULT_MODEL_URL).then((r) => r.arrayBuffer());
      await proc.loadModel(modelBuf);
      const t0 = performance.now();
      const result = await proc.separate(audio.left, audio.right);
      const sec = (performance.now() - t0) / 1000;
      setRtf(audio.duration / sec);
      log(`separation done in ${sec.toFixed(1)}s — ${(audio.duration / sec).toFixed(2)}× realtime`);

      // --- Whisper transcription of the vocals stem (in-browser) ---
      setStatus('transcribing');
      const want = wordMode ? 'onnx-community/whisper-base_timestamped' : asrModel;
      const device = gpu === 'available' ? 'webgpu' : 'wasm';
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
