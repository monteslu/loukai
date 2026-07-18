/**
 * createKaraoke — framework-free karaoke creation compute, extracted from
 * WebGpuCreatorPanel.run() so the SAME pipeline can run:
 *   - inline in the player's Create tab (React maps the callbacks to UI state), and
 *   - headlessly in the player renderer when a phone admin commands the host (main
 *     drives it over IPC; callbacks stream progress back to the phone).
 *
 * It owns ONLY the compute: Demucs separation → Whisper transcription (silence-aware
 * segmentation + the full hallucination-cull stack) → group into lyric lines →
 * (optional) CREPE pitch/key. It does NOT touch the DOM, React, files, encoding, or
 * saving — the caller decodes the input to PCM, then encodes/saves the returned
 * stems. All progress is reported through the `emit` callbacks.
 *
 * Returns: { stems:{master,drums,bass,other,vocals:{left,right}}, sampleRate,
 *   duration, lyrics:{lines, words}, key, pitch, timing }.
 */

import { snapToVocalEnergy } from './vocalSegmentation.js';
import { groupWordsIntoLines } from './creatorAudio.js';
import { transcribeVocals } from './transcribeVocals.js';

// The chained split model's piece 0 must pin its fp16 normalization prologue to the
// CPU (forceCpuNodeNames) or the graph is all-NaN on WebGPU. Identical to the lists in
// static/webgpu/ft_cpu_nodes.json (every htdemucs export shares this prologue). Only
// piece 0 gets this; the other pieces must NOT (gpu-separator applies it to piece 0).
const FP16_CPU_NODES = [
  '/ReduceMean',
  '/Sub',
  '/Pow',
  '/ReduceMean_1',
  '/Clip',
  '/Sqrt',
  '/Add',
  '/Div',
  '/ReduceMean_2',
  '/Sub_1',
  '/Pow_1',
  '/ReduceMean_3',
  '/Clip_1',
  '/Sqrt_1',
  '/Add_1',
  '/Div_1',
];

/**
 * @param {Object} input
 * @param {{left:Float32Array,right:Float32Array,sampleRate:number,duration:number}} input.audio
 *   decoded source audio (full mix). Required.
 * @param {Object} [input.stems] previously separated stems to REUSE (skips Demucs).
 *   Shape { vocals:{left,right}, drums, bass, other } — when present, separation is
 *   skipped. For lyrics-only mode pass { vocals } only and set lyricsOnly:true.
 * @param {boolean} [input.lyricsOnly=false] transcribe the provided vocals only; do
 *   not separate, and the caller will rewrite an existing file's lyrics atom.
 * @param {Object} opts pipeline options
 * @param {string} opts.asrModel  Whisper model id
 * @param {string} opts.demucsModel  'htdemucs' | 'htdemucs_ft'
 * @param {boolean} opts.ftAvailable  whether the ft ensemble is installed
 * @param {('webgpu'|'wasm')} opts.device  inference EP (wasm only valid for lyrics-only/stem-reuse runs; separation requires webgpu)
 * @param {string} opts.whisperDtype
 * @param {('segment'|'word')} opts.timestampMode
 * @param {string} opts.language
 * @param {boolean} opts.enableCrepe
 * @param {string} [opts.whisperPrompt]  pre-built initialPrompt (caller resolves it)
 * @param {Object} libs  the loaded WebGPU libraries (from loadLibs) — ort, demucs,
 *   ftEnsemble, pipeline, crepeMod, DemucsProcessor, tf
 * @param {Object} emit  progress callbacks (all optional)
 * @param {(phase:string)=>void} [emit.onPhase]  'separating'|'transcribing'|'pitch'
 * @param {(msg:string)=>void} [emit.onLog]
 * @param {(p:{[stem:string]:number})=>void} [emit.onStemProgress]
 * @param {(info:string)=>void} [emit.onTranscribeInfo]
 * @param {(lines:Array)=>void} [emit.onLyricsPreview]
 * @param {(x:number)=>void} [emit.onRtf]
 * @returns {Promise<Object>}
 */
export async function createKaraoke(
  { audio, stems: reuseStems = null, lyricsOnly = false },
  opts,
  libs,
  emit = {}
) {
  const onPhase = emit.onPhase || (() => {});
  const onLog = emit.onLog || (() => {});
  const onStemProgress = emit.onStemProgress || (() => {});
  const onTranscribeInfo = emit.onTranscribeInfo || (() => {});
  const onLyricsPreview = emit.onLyricsPreview || (() => {});
  const onRtf = emit.onRtf || (() => {});

  const {
    asrModel,
    demucsModel,
    ftAvailable = true,
    device = 'wasm',
    whisperDtype = 'q4f16',
    timestampMode = 'segment',
    language = 'en',
    enableCrepe = true,
    whisperPrompt = null,
    // Gentle duty (~50% GPU + per-piece drains on the chained model): set when the
    // SAME GPU is rendering something a human is watching (host playing mid-set).
    gentle = false,
  } = opts || {};

  const { ort, demucs, ftEnsemble, pipeline, crepeMod, DemucsProcessor, tf } = libs;
  const { STEMS, createEnsembleSessions, runEnsemble } = ftEnsemble;

  // ⏱️ per-stage timing (directly comparable to the prior inline version's summary)
  const perf = { audioSec: audio.duration || 0, separation: 0, transcription: 0, pitch: 0 };
  const runT0 = performance.now();

  let result = reuseStems;

  // --- Demucs stem separation (in-browser) --- (skipped when reusing / lyrics-only)
  if (!lyricsOnly && !reuseStems) {
    onPhase('separating');
    // Product rule: stem separation runs on WebGPU or not at all. The WASM DSP
    // is orders of magnitude slower and produces support tickets, not stems.
    if (device !== 'webgpu') {
      throw new Error(
        'WebGPU is required for stem separation (no real GPU adapter available). ' +
          'Refusing the CPU/WASM demucs path.'
      );
    }
    let modelDef = [
      { id: 'htdemucs', kind: 'single' },
      { id: 'htdemucs_ft', kind: 'ft' },
    ].find((m) => m.id === demucsModel) || { id: 'htdemucs', kind: 'single' };
    if (modelDef.kind === 'ft' && !ftAvailable) {
      onLog('htdemucs_ft (best) models not installed — using fast htdemucs');
      modelDef = { id: 'htdemucs', kind: 'single' };
    }
    onStemProgress({});
    const t0 = performance.now();
    let modeLabel;
    if (modelDef.kind === 'ft') {
      try {
        onLog('loading htdemucs_ft ensemble (4 models) from loukai …');
        const cpuNodes = await fetch('/webgpu-models/ft_cpu_nodes.json')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const sessions = await createEnsembleSessions({
          ort,
          modelUrl: (stem) => `/webgpu-models/htdemucs_ft_${stem}_safe16.onnx`,
          cpuNodes,
          onLog: (m) => onLog(m),
        });
        onLog(`separating on webgpu — htdemucs_ft ensemble (${STEMS.length} stems) …`);
        const r = await runEnsemble({
          ort,
          sessions,
          proc: demucs,
          left: audio.left,
          right: audio.right,
          onStemProgress: (idx, frac) => onStemProgress({ [STEMS[idx]]: frac }),
        });
        result = r.stems;
        modeLabel = 'htdemucs_ft (best)';
      } catch (e) {
        onLog(`htdemucs_ft unavailable (${e.message}) — falling back to fast htdemucs`);
        modelDef = { id: 'htdemucs', kind: 'single' };
      }
    }
    if (modelDef.kind !== 'ft' && !result) {
      // Preferred: the 21-piece chained split (mixed precision fp16/convs-fp32,
      // 126MB, ~2.4x faster). Each piece is a ~10-30ms GPU submission instead of one
      // monolithic ~200-330ms burst, so the HOST's rendering (karaoke video mid-set)
      // keeps its frame rate while stems generate — the entire point of the split.
      // Chain requires the full-GPU path; on wasm (or if the pieces aren't
      // reachable) fall back to the old fp32 monolith.
      let chain = null;
      // The chained split is MIXED PRECISION (fp16): it requires the WebGPU device
      // to support shader-f16, or ORT fails at the first Cast node ('Program Cast
      // requires f16 but the device does not support it'). Real GPUs without f16
      // (some iGPUs/older drivers) and software adapters must use the fp32 monolith.
      let deviceHasF16 = false;
      if (device === 'webgpu') {
        try {
          const adapter = await navigator.gpu?.requestAdapter({
            powerPreference: 'high-performance',
          });
          deviceHasF16 = Boolean(adapter?.features?.has('shader-f16'));
        } catch {
          deviceHasF16 = false;
        }
        if (!deviceHasF16) {
          onLog('GPU has no shader-f16 — using the fp32 monolith instead of the fp16 chain');
        }
      }
      if (device === 'webgpu' && deviceHasF16) {
        try {
          const manifest = await fetch('/webgpu-models/htdemucs_split_manifest.json').then((r) => {
            if (!r.ok) throw new Error(`manifest fetch ${r.status}`);
            return r.json();
          });
          onLog(
            `loading htdemucs model (mixed precision, chained ${manifest.pieces.length} pieces) …`
          );
          // Aggregate download progress across all pieces (report total only once
          // every content-length is known, so the numbers don't lie).
          const received = new Array(manifest.pieces.length).fill(0);
          const totals = new Array(manifest.pieces.length).fill(-1);
          let lastPct = -25;
          const report = () => {
            if (totals.some((t) => t < 0)) return;
            const total = totals.reduce((a, b) => a + b, 0);
            const got = received.reduce((a, b) => a + b, 0);
            const pct = Math.floor(((got / total) * 100) / 25) * 25;
            if (pct > lastPct) {
              lastPct = pct;
              onLog(
                `  ↓ model pieces ${Math.round((got / total) * 100)}% (${(got / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)}MB)`
              );
            }
          };
          const fetchPiece = async (name, i) => {
            const res = await fetch(`/webgpu-models/${name}`);
            if (!res.ok) throw new Error(`model fetch ${name} ${res.status}`);
            totals[i] = Number(res.headers.get('content-length')) || 0;
            if (!res.body || !totals[i]) {
              const buf = await res.arrayBuffer();
              totals[i] = buf.byteLength;
              received[i] = buf.byteLength;
              report();
              return buf;
            }
            const reader = res.body.getReader();
            const chunks = [];
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              received[i] += value.byteLength;
              report();
            }
            const out = new Uint8Array(received[i]);
            let off = 0;
            for (const c of chunks) {
              out.set(c, off);
              off += c.byteLength;
            }
            return out.buffer;
          };
          const buffers = await Promise.all(manifest.pieces.map((p, i) => fetchPiece(p.file, i)));
          chain = {
            pieces: manifest.pieces.map((p, i) => ({
              buf: buffers[i],
              inputs: p.inputs,
              outputs: p.outputs,
            })),
            outputs: manifest.outputs,
          };
        } catch (e) {
          onLog(
            `chained model unavailable (${String(e.message).slice(0, 120)}) — using the fp32 monolith`
          );
          chain = null;
        }
      }
      let modelInput = chain;
      if (!modelInput) {
        onLog('loading htdemucs (single model) from loukai …');
        modelInput = await fetch('/webgpu-models/htdemucs.onnx').then((res) => {
          if (!res.ok) throw new Error(`model fetch ${res.status}`);
          return res.arrayBuffer();
        });
      }
      modeLabel = chain ? 'htdemucs (chained, mixed precision)' : 'htdemucs (fast)';
      const proc = new DemucsProcessor({
        ort,
        // The chain's piece 0 carries the CPU-pinned fp16 normalization prologue
        // (same 16 node names as ft_cpu_nodes.json); without the pin the fp16
        // graph is all-NaN on WebGPU. Monolith keeps the plain EP list.
        sessionOptions: {
          executionProviders: chain
            ? [{ name: 'webgpu', forceCpuNodeNames: FP16_CPU_NODES }]
            : ['webgpu'],
        },
        gentle,
        shouldCancel: emit.shouldCancel,
        onProgress: ({ progress }) =>
          onStemProgress(STEMS.reduce((a, s) => ({ ...a, [s]: progress || 0 }), {})),
        onLog: (phase, m) => onLog(`[${phase}] ${m}`),
      });
      // Hand the live processor to the caller (the worker uses this to flip
      // gentle mid-run when playback starts/stops, and to signal cancel).
      emit.onSeparator?.(proc);
      await proc.loadModel(modelInput);
      onLog(
        `separating — ${chain ? `htdemucs chain (${chain.pieces.length} pieces${gentle ? ', gentle' : ''})` : 'htdemucs (single)'} on EP: ${device} …`
      );
      try {
        result = await proc.separate(audio.left, audio.right);
      } catch (e) {
        if (!chain) throw e;
        // Chain died at RUNTIME (driver/f16 quirks the probe missed). Recover with
        // the fp32 monolith rather than failing the whole job.
        onLog(
          `chained model failed at runtime (${String(e.message).slice(0, 160)}) — retrying with the fp32 monolith`
        );
        const monoBuf = await fetch('/webgpu-models/htdemucs.onnx').then((res) => {
          if (!res.ok) throw new Error(`model fetch ${res.status}`);
          return res.arrayBuffer();
        });
        const proc2 = new DemucsProcessor({
          ort,
          sessionOptions: { executionProviders: ['webgpu'] },
          gentle,
          shouldCancel: emit.shouldCancel,
          onProgress: ({ progress }) =>
            onStemProgress(STEMS.reduce((a, s) => ({ ...a, [s]: progress || 0 }), {})),
          onLog: (phase, m) => onLog(`[${phase}] ${m}`),
        });
        emit.onSeparator?.(proc2);
        await proc2.loadModel(monoBuf);
        modeLabel = 'htdemucs (fp32 fallback)';
        result = await proc2.separate(audio.left, audio.right);
      }
    }
    const sec = (performance.now() - t0) / 1000;
    const realtime = audio.duration / sec;
    perf.separation = sec;
    onRtf(realtime);
    onLog(
      `separation done in ${sec.toFixed(1)}s — ${realtime.toFixed(2)}× realtime [${modeLabel}]`
    );
  }

  // --- Whisper transcription of the vocals stem (in-browser) ---
  onPhase('transcribing');
  const want = asrModel;
  // q4f16 on webgpu (small/fast, measured-equal accuracy); q8 on wasm. NOT every
  // onnx-community repo ships every dtype though - e.g. whisper-base_timestamped
  // has a q4f16 DECODER but no q4f16 ENCODER, and transformers.js surfaces that
  // as a misleading "Unsupported model type: whisper" (it fell through its model
  // class chain). Fall through a dtype chain instead: uniform preferred → mixed
  // (fp16 encoder + quantized decoder) → fp16 → q8.
  const preferred = device === 'webgpu' ? whisperDtype : 'q8';
  const dtypeCandidates =
    device === 'webgpu'
      ? [preferred, { encoder_model: 'fp16', decoder_model_merged: preferred }, 'fp16', 'q8']
      : ['q8'];
  const seenFiles = new Set();
  let asr;
  let lastErr;
  for (const dtype of dtypeCandidates) {
    const label = typeof dtype === 'string' ? dtype : JSON.stringify(dtype);
    onLog(`loading Whisper model · ${want} · ${device}/${label} (first run downloads it) …`);
    try {
      asr = await pipeline('automatic-speech-recognition', want, {
        device,
        dtype,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file && p.total) {
            const pct = Math.round((p.loaded / p.total) * 100);
            if (pct % 25 === 0 && !seenFiles.has(p.file + pct)) {
              seenFiles.add(p.file + pct);
              onLog(`  ↓ ${p.file} ${pct}%`);
            }
          }
        },
      });
      break;
    } catch (e) {
      lastErr = e;
      onLog(`  dtype ${label} unavailable for this model - trying the next option`);
    }
  }
  if (!asr) {
    throw new Error(
      `Whisper model "${want}" failed to load (${String(lastErr?.message).slice(0, 100)}). ` +
        `If it's large-v3-turbo, your GPU may be out of memory — try a smaller model.`
    );
  }
  // --- Vocals → words (transcribeVocals module: silence-skipping segmentation,
  // no_speech gating, anti-aliased 16k downmix; see transcribeVocals.js) ---
  const {
    words: vadWords,
    text: rawText,
    seconds: tSec,
    mono,
    rms,
    hopSec: WIN_SEC,
    silentFrac: SILENT_FRAC,
  } = await transcribeVocals(
    { vocals: result.vocals, sampleRate: audio.sampleRate, duration: audio.duration, asr, tf },
    { timestampMode, language, whisperPrompt, device },
    { onLog, onTranscribeInfo, onLyricsPreview }
  );
  perf.transcription = tSec;
  const audioMin = (mono.length / 16000 / 60).toFixed(1);
  const words = vadWords;
  const out = { text: rawText };

  // --- Group into lines + snap + non-overlap invariant + junk-line filter ---
  let lines = words.length
    ? groupWordsIntoLines(words, { duration: audio.duration })
    : [{ text: (out.text || '').trim(), start: 0, end: audio.duration }];
  const droppedMark = lines.dropped;
  lines = snapToVocalEnergy(lines, rms, {
    hopSec: WIN_SEC,
    searchSec: 0.5,
    silentFrac: SILENT_FRAC,
  });
  if (droppedMark) lines.dropped = droppedMark;

  // Non-overlap (single-speaker invariant)
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
      onLog(
        `enforced non-overlap on ${small + large} line(s) (single-speaker → one line at a time${large ? `; ${large} large >1s` : ''})`
      );
    }
  }

  // Junk-line filter (implausible timing)
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
    if (junked.length) onLog(`dropped ${junked.length} junk line(s) (implausible timing)`);
  }

  onLyricsPreview(lines);
  onLog(
    `transcription done in ${tSec.toFixed(1)}s (${((parseFloat(audioMin) * 60) / tSec).toFixed(2)}× realtime) — ${words.length} words → ${lines.length} lyric lines`
  );

  // Normalize words for the kara atom.
  const wordObjs = words
    .map((w) => ({
      text: (w.text || '').trim(),
      start: w.timestamp?.[0] ?? w.start ?? null,
      end: w.timestamp?.[1] ?? w.end ?? null,
    }))
    .filter((w) => w.text && w.start != null);

  // --- CREPE pitch → musical key (best-effort) ---
  let detectedKey = null;
  let pitchData = null;
  try {
    if (!enableCrepe) {
      onLog('pitch detection (CREPE) disabled in settings — skipping');
      throw new Error('crepe-disabled');
    }
    const { detectPitch, detectKey } = crepeMod;
    if (!libs.crepeSession) {
      onLog('loading CREPE (pitch) …');
      const cbuf = await fetch('/webgpu-models/crepe_tiny.onnx').then((r) =>
        r.ok ? r.arrayBuffer() : Promise.reject(new Error(`crepe ${r.status}`))
      );
      libs.crepeSession = await ort.InferenceSession.create(new Uint8Array(cbuf), {
        executionProviders: device === 'webgpu' ? ['webgpu'] : ['wasm'],
        graphOptimizationLevel: 'all',
      });
    }
    onPhase('pitch');
    onLog(`detecting pitch + key (CREPE on EP: ${device}) …`);
    const ct0 = performance.now();
    const pitch = await detectPitch(ort, libs.crepeSession, mono, {
      onProgress: (f) => onTranscribeInfo(`pitch ${Math.round(f * 100)}%`),
    });
    onTranscribeInfo('');
    perf.pitch = (performance.now() - ct0) / 1000;
    onLog(`CREPE pitch done in ${perf.pitch.toFixed(1)}s`);
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
    onLog(`detected key: ${detectedKey} (confidence ${k.confidence.toFixed(2)})`);
  } catch (e) {
    onLog(`pitch/key detection skipped (${e.message})`);
  }

  const totalSec = (performance.now() - runT0) / 1000;

  return {
    stems: result, // {master?,drums,bass,other,vocals:{left,right}} (master from caller's audio)
    sampleRate: audio.sampleRate,
    duration: audio.duration,
    lyrics: { lines, words: wordObjs },
    key: detectedKey,
    pitch: pitchData,
    timing: { ...perf, total: totalSec },
  };
}
