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

import { planVocalSegments, snapToVocalEnergy } from './vocalSegmentation.js';
import { groupWordsIntoLines, cullOutroThanks } from './creatorAudio.js';

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
  // q4f16 on webgpu (small/fast, measured-equal accuracy); q8 on wasm.
  const dtype = device === 'webgpu' ? whisperDtype : 'q8';
  onLog(`loading Whisper model · ${want} · ${device}/${dtype} (first run downloads it) …`);
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
            onLog(`  ↓ ${p.file} ${pct}%`);
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
  const SILENT_FRAC = 0.08;
  const silentThresh = peakRms * SILENT_FRAC;
  const inSilentGap = (t, minGapSec = 1.5) => {
    const c = Math.min(nWin - 1, Math.max(0, Math.floor((t * 16000) / winLen)));
    if (rms[c] > silentThresh) return false;
    let lo = c;
    let hi = c;
    while (lo > 0 && rms[lo] <= silentThresh) lo--;
    while (hi < nWin - 1 && rms[hi] <= silentThresh) hi++;
    return (hi - lo) * WIN_SEC >= minGapSec;
  };
  onLog(
    `vocals energy profile: peak=${peakRms.toFixed(4)}, silence threshold=${silentThresh.toFixed(4)} (${Math.round(SILENT_FRAC * 100)}% of peak)`
  );

  const tStart = performance.now();
  onLog(`transcribing ${audioMin} min of vocals on ${device} …`);
  let chunkIdx = 0;
  const hb = setInterval(() => {
    const el = ((performance.now() - tStart) / 1000).toFixed(0);
    onTranscribeInfo(`transcribing window ${chunkIdx} · ${el}s`);
  }, 1000);

  const promptText = whisperPrompt;
  const useWordTs = timestampMode === 'word';
  let promptIds = null;
  if (promptText) {
    try {
      if (typeof asr.tokenizer?.get_prompt_ids === 'function') {
        promptIds = asr.tokenizer.get_prompt_ids(promptText);
      }
    } catch (e) {
      onLog(`prompt tokenize failed (${e.message}) — transcribing without prompt`);
    }
  }
  onLog(`transcribing with silence-aware vocal segmentation${promptText ? ', prompt ON' : ''}`);
  const SR16 = 16000;
  const totalSamples = mono.length;
  const allChunks = [];
  const baseOpts = {
    return_timestamps: useWordTs ? 'word' : true,
    ...(language && language !== 'auto' ? { language } : {}),
    ...(promptIds ? { prompt_ids: promptIds } : promptText ? { prompt: promptText } : {}),
    repetition_penalty: 1.2,
    no_repeat_ngram_size: 3,
  };

  // no_speech_prob capture (non-destructive logits processor).
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
        try {
          if (this.prob === null) {
            const row = logits.dims?.length === 2 ? logits[0] : logits;
            const data = row.data ?? row;
            const vocab = row.dims ? row.dims[row.dims.length - 1] : data.length;
            let mx = -Infinity;
            for (let i = 0; i < vocab; i++) if (data[i] > mx) mx = data[i];
            let sum = 0;
            for (let i = 0; i < vocab; i++) sum += Math.exp(data[i] - mx);
            this.prob = Math.exp(data[NO_SPEECH_TOKEN] - mx) / sum;
          }
        } catch {
          /* fail-safe: don't gate this window */
        }
        return logits;
      }
    })();
    return cap;
  };

  const transcribeWindow = async (window) => {
    const cap = makeNoSpeechCapture();
    const w = await asr(window, {
      ...baseOpts,
      ...(cap ? { logits_processor: [cap] } : {}),
    });
    return { chunks: w.chunks || [], text: w.text || '', noSpeech: cap?.prob ?? null };
  };

  const plan = planVocalSegments(rms, {
    hopSec: WIN_SEC,
    durationSec: audio.duration,
    minSegSec: 20,
    maxSegSec: 30,
    overlapSec: 0,
    dipSec: 0.5,
  });
  onLog(`planned ${plan.length} vocal-aware segment(s) (20s + best-dip cut, ≤30s, clean cuts)`);

  let out;
  try {
    for (let pi = 0; pi < plan.length; pi++) {
      const { start, end } = plan[pi];
      chunkIdx += 1;
      const s0 = Math.max(0, Math.floor(start * SR16));
      const s1 = Math.min(totalSamples, Math.ceil(end * SR16));
      const window = mono.subarray(s0, s1);
      onTranscribeInfo(`segment ${chunkIdx}/${plan.length} @ ${start.toFixed(0)}s …`);
      const w = await transcribeWindow(window);
      const segs = (w.chunks || []).filter((c) => (c.text || '').trim());
      for (const c of segs) {
        const ts = c.timestamp || [c.start, c.end];
        const a = ts[0] != null ? ts[0] + start : null;
        const b = ts[1] != null ? ts[1] + start : null;
        if (a == null) continue;
        allChunks.push({ text: c.text, timestamp: [a, b != null ? b : a + 0.4] });
      }
      if (allChunks.length) {
        const flat = allChunks.map((c) => ({
          text: c.text,
          start: c.timestamp[0],
          end: c.timestamp[1],
        }));
        onLyricsPreview(groupWordsIntoLines(flat, { duration: audio.duration }));
      }
      onLog(
        `  segment ${chunkIdx} @ ${start.toFixed(0)}-${end.toFixed(0)}s: ${segs.length} seg(s)`
      );
    }
    allChunks.sort((a, b) => (a.timestamp[0] ?? 0) - (b.timestamp[0] ?? 0));
    out = { chunks: allChunks, text: allChunks.map((c) => c.text).join('') };
  } finally {
    clearInterval(hb);
    onTranscribeInfo('');
  }
  const tSec = (performance.now() - tStart) / 1000;
  perf.transcription = tSec;

  // Expand segment-mode chunks into evenly-spaced pseudo-words.
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

  const lastWordT = words.length
    ? (words[words.length - 1].timestamp?.[1] ?? words[words.length - 1].end ?? 0)
    : 0;
  onLog(
    `Whisper raw: ${words.length} words, ${(out.text || '').length} chars, last word @ ${lastWordT.toFixed(0)}s of ${audio.duration.toFixed(0)}s${promptText ? ' (prompt ON)' : ''}`
  );

  // --- Hallucination cull stack (verbatim from the inline pipeline) ---
  const isAnnotation = (s) => /[*[\]#♪♫]/.test((s || '').trim());

  // (1) stuck-decoder time-collision cull
  {
    const minStartGap = 0.08;
    const startOf = (w) => (w.timestamp ? w.timestamp[0] : w.start) ?? null;
    const kept = [];
    let prevStart = null;
    let dropped = 0;
    for (const w of words) {
      const s = startOf(w);
      const collide = s != null && prevStart != null && s - prevStart < minStartGap;
      if (s != null) prevStart = s;
      if (collide) {
        dropped++;
        continue;
      }
      kept.push(w);
    }
    if (dropped) {
      onLog(
        `dropped ${dropped} time-collided word(s) (<${minStartGap}s apart → stuck decoder loop)`
      );
      words = kept;
    }
  }

  // (2) annotation strip + sustained-silence cull (skip mid-phrase words)
  {
    const culled = [];
    const startOf = (w) => (w.timestamp ? w.timestamp[0] : w.start) ?? null;
    const endOf = (w) => (w.timestamp ? w.timestamp[1] : w.end) ?? startOf(w);
    const NEIGHBOR = 1.2;
    words = words.filter((w, i, arr) => {
      const text = (w.text || '').trim();
      const ts = w.timestamp || [w.start, w.end];
      const mid = ts[0] != null && ts[1] != null ? (ts[0] + ts[1]) / 2 : ts[0];
      if (isAnnotation(text)) {
        culled.push({ text, t: mid == null ? -1 : Number(mid.toFixed(2)), why: 'annotation' });
        return false;
      }
      if (mid == null) return true;
      const s = startOf(w);
      const gapBefore = i > 0 ? s - endOf(arr[i - 1]) : Infinity;
      const gapAfter = i < arr.length - 1 ? startOf(arr[i + 1]) - endOf(w) : Infinity;
      const midPhrase = gapBefore <= NEIGHBOR && gapAfter <= NEIGHBOR;
      if (!midPhrase && inSilentGap(mid)) {
        culled.push({ text, t: Number(mid.toFixed(2)), why: 'instrumental gap' });
        return false;
      }
      return true;
    });
    if (culled.length) {
      onLog(`trimmed ${culled.length} hallucinated word(s) (annotation / instrumental gap)`);
    }
  }

  // (3) isolated-word-after-big-gap cull (fade ghost)
  {
    const isoGap = 8;
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
      onLog(
        `dropped ${stranded.length} stranded word(s) (isolated >${isoGap}s from neighbors → fade ghost)`
      );
    }
  }

  // (4) "thank you" outro cull (only outside the lyric body)
  {
    const r = cullOutroThanks(words);
    if (r.removed.length) {
      words = r.words;
      onLog(
        `dropped ${r.removed.length} "thank you" hallucination word(s) outside lyric body: ${r.removed.join(' ')}`
      );
    }
  }
  onLog(`after VAD: ${words.length} words`);

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
