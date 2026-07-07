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
 * @param {('webgpu'|'wasm')} opts.device  inference EP
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
      modeLabel = 'htdemucs (fast)';
      onLog('loading htdemucs (single model) from loukai …');
      const modelBuf = await fetch('/webgpu-models/htdemucs.onnx').then((res) => {
        if (!res.ok) throw new Error(`model fetch ${res.status}`);
        return res.arrayBuffer();
      });
      const proc = new DemucsProcessor({
        ort,
        sessionOptions: { executionProviders: device === 'webgpu' ? ['webgpu'] : ['wasm'] },
        onProgress: ({ progress }) =>
          onStemProgress(STEMS.reduce((a, s) => ({ ...a, [s]: progress || 0 }), {})),
        onLog: (phase, m) => onLog(`[${phase}] ${m}`),
      });
      await proc.loadModel(modelBuf);
      onLog(`separating — htdemucs (single) on EP: ${device} …`);
      result = await proc.separate(audio.left, audio.right);
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
