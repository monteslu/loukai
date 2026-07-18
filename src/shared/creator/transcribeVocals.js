/**
 * transcribeVocals - the vocals→words stage of the creator, extracted from
 * createKaraoke so it is benchable and testable in isolation.
 *
 * Input: the separated vocals stem + a ready transformers.js ASR pipeline.
 * Output: hallucination-culled, time-ordered words (plus the vocals energy
 * profile, which later stages reuse for line snapping).
 *
 * Faithful move of the previous in-line implementation (energy profile,
 * silence-aware 20-30s dip-cut segmentation, no_speech capture, cull stack),
 * with three additions, each individually gated and all disabled by
 * opts.legacy (the pre-optimization behavior, kept for A/B benchmarking):
 *
 *  1. skipSilence: segments are planned over VOICED SPANS only. The old planner
 *     tiled the entire duration, so instrumental intros/solos/outros were
 *     transcribed too - pure waste (Whisper hallucinates on silence, which the
 *     cull stack then had to clean up). A fully instrumental track now skips
 *     Whisper entirely.
 *  2. noSpeechGate: a window whose captured no_speech probability exceeds the
 *     Whisper-conventional 0.6 is dropped wholesale (the capture already
 *     existed; it was never consulted).
 *  3. sincDownmix: 44.1k→16k via a windowed-sinc low-pass decimator. The old
 *     nearest-neighbor decimation aliased everything above 8kHz into the
 *     Whisper band, which degrades recognition and makes the decoder work
 *     harder on the noise floor.
 */

import { planVocalSegments } from './vocalSegmentation.js';
import { groupWordsIntoLines, cullOutroThanks } from './creatorAudio.js';
import { WasmStemsDsp } from './demucs/stemsdsp.js';

// The WASM decimator (same module the separation runner uses) does the
// downmix in C; the JS polyphase below is the reference and the fallback.
let dmWasm;
function wasmDsp() {
  if (dmWasm === undefined) {
    try {
      dmWasm = new WasmStemsDsp();
    } catch {
      dmWasm = null;
    }
  }
  return dmWasm;
}

// Downmix to mono 16k for Whisper - LEGACY nearest-neighbor decimation.
function toMono16kLegacy(left, right, sampleRate) {
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
 * Downmix to mono 16k via windowed-sinc (Blackman) low-pass decimation.
 * Anti-aliased: cuts at ~0.9x the 8kHz output Nyquist before decimating.
 *
 * Polyphase: for an integer source rate, the fractional kernel positions repeat
 * every U output samples where sr/16000 = D/U reduced (44.1k → 160 phases,
 * 48k → 1 phase), so the kernels are precomputed once and the per-sample work
 * is pure multiply-adds (computing sin/cos per tap per sample costs seconds on
 * a full track; this costs ~100ms).
 */
export function toMono16kSinc(left, right, sampleRate) {
  const n = left.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) * 0.5;
  if (sampleRate === 16000) return mono;

  const ratio = sampleRate / 16000;
  const outLen = Math.floor(n / ratio);
  const out = new Float32Array(outLen);
  const fc = (0.9 * 0.5) / ratio; // cycles/sample at the SOURCE rate
  const HALF = 16; // 32-tap kernel per output sample
  const twoPiFc = 2 * Math.PI * fc;

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = Number.isInteger(sampleRate) ? gcd(sampleRate, 16000) : 1;
  const D = Number.isInteger(sampleRate) ? sampleRate / g : 0; // center step numerator
  const U = Number.isInteger(sampleRate) ? 16000 / g : 0; // phase count

  const tapsFor = (frac) => {
    // Kernel for a center at (integer + frac): taps at x = k - frac, k in [-HALF+1? ..]
    const k0 = Math.ceil(frac - HALF);
    const k1 = Math.floor(frac + HALF);
    const taps = new Float32Array(k1 - k0 + 1);
    let wsum = 0;
    for (let k = k0; k <= k1; k++) {
      const x = k - frac;
      const sinc = x === 0 ? twoPiFc : Math.sin(twoPiFc * x) / x;
      const wArg = (Math.PI * (x + HALF)) / HALF;
      const win = 0.42 - 0.5 * Math.cos(wArg) + 0.08 * Math.cos(2 * wArg);
      taps[k - k0] = sinc * win;
      wsum += sinc * win;
    }
    if (wsum > 1e-12) for (let t = 0; t < taps.length; t++) taps[t] /= wsum;
    return { taps, k0 };
  };

  if (U > 0 && U <= 1024) {
    // Precompute one kernel per phase.
    const phases = new Array(U);
    for (let p = 0; p < U; p++) phases[p] = tapsFor((p * D) / U - Math.floor((p * D) / U));
    for (let i = 0; i < outLen; i++) {
      const num = i * D;
      const base = Math.floor(num / U);
      const { taps, k0 } = phases[num % U];
      let sum = 0;
      const kk0 = base + k0;
      const lo = Math.max(0, -kk0);
      const hi = Math.min(taps.length, n - kk0);
      for (let t = lo; t < hi; t++) sum += mono[kk0 + t] * taps[t];
      out[i] = sum;
    }
    return out;
  }

  // Arbitrary/fractional rates: per-sample kernel (slow path, rare).
  for (let i = 0; i < outLen; i++) {
    const center = i * ratio;
    const base = Math.floor(center);
    const { taps, k0 } = tapsFor(center - base);
    let sum = 0;
    const kk0 = base + k0;
    const lo = Math.max(0, -kk0);
    const hi = Math.min(taps.length, n - kk0);
    for (let t = lo; t < hi; t++) sum += mono[kk0 + t] * taps[t];
    out[i] = sum;
  }
  return out;
}

/**
 * Merge voiced RMS windows into padded spans (seconds). Gaps shorter than
 * mergeGapSec stay inside a span so short breaths don't fragment segments.
 */
function voicedSpans(rms, hopSec, silentThresh, { mergeGapSec = 3, padSec = 0.6 } = {}) {
  const spans = [];
  let start = null;
  let lastVoiced = null;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] > silentThresh) {
      if (start === null) start = i * hopSec;
      lastVoiced = i * hopSec + hopSec;
    } else if (start !== null && i * hopSec - lastVoiced > mergeGapSec) {
      spans.push({ start: Math.max(0, start - padSec), end: lastVoiced + padSec });
      start = null;
    }
  }
  if (start !== null) spans.push({ start: Math.max(0, start - padSec), end: lastVoiced + padSec });
  // Merge any pad-created overlaps.
  const merged = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && s.start <= prev.end) prev.end = Math.max(prev.end, s.end);
    else merged.push(s);
  }
  return merged;
}

/**
 * Transcribe the vocals stem into hallucination-culled words.
 *
 * @param {Object} input { vocals:{left,right}, sampleRate, duration, asr, tf }
 * @param {Object} opts { timestampMode, language, whisperPrompt, device,
 *   legacy?: boolean (pre-optimization behavior for A/B),
 *   skipSilence?, noSpeechGate?, sincDownmix? (individual gates, default on) }
 * @param {Object} emit { onLog, onTranscribeInfo, onLyricsPreview } (optional)
 * @returns {Promise<{words:Array, text:string, seconds:number, rms:Float32Array,
 *   hopSec:number, silentFrac:number, segmentsPlanned:number, transcribedSec:number}>}
 */
export async function transcribeVocals(input, opts = {}, emit = {}) {
  const { vocals, sampleRate, duration, asr, tf } = input;
  const onLog = emit.onLog || (() => {});
  const onTranscribeInfo = emit.onTranscribeInfo || (() => {});
  const onLyricsPreview = emit.onLyricsPreview || (() => {});
  const legacy = Boolean(opts.legacy);
  const skipSilence = legacy ? false : (opts.skipSilence ?? true);
  const noSpeechGate = legacy ? false : (opts.noSpeechGate ?? true);
  const sincDownmix = legacy ? false : (opts.sincDownmix ?? true);
  const { timestampMode, language, whisperPrompt } = opts;

  let mono;
  if (!sincDownmix) {
    mono = toMono16kLegacy(vocals.left, vocals.right, sampleRate);
  } else {
    try {
      mono = wasmDsp()?.downmixTo16k(vocals.left, vocals.right, sampleRate) ?? null;
    } catch {
      mono = null;
    }
    if (!mono) mono = toMono16kSinc(vocals.left, vocals.right, sampleRate);
  }
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

  // --- Language: resolve 'auto' by ACTUALLY detecting it ---------------------------
  // transformers.js does not implement Whisper language detection (it silently
  // force-defaults to English when no language is passed — "auto" was a lie). We do it
  // the way openai-whisper does: one encoder pass + one decoder step from
  // <|startoftranscript|>, argmax over the language tokens. Runs on the most-voiced
  // 30s window (from the RMS profile above) so we detect on singing, not intro.
  let effectiveLanguage = language;
  if (!language || language === 'auto') {
    try {
      const detWin = Math.round(30 / WIN_SEC); // 30s in rms bins
      let bestStart = 0;
      let bestSum = -1;
      let winSum = 0;
      for (let w = 0; w < nWin; w++) {
        winSum += rms[w];
        if (w >= detWin) winSum -= rms[w - detWin];
        if (w >= detWin - 1 && winSum > bestSum) {
          bestSum = winSum;
          bestStart = w - detWin + 1;
        }
      }
      const s0 = Math.min(mono.length, Math.round(bestStart * WIN_SEC * 16000));
      const detAudio = mono.subarray(s0, Math.min(mono.length, s0 + 30 * 16000));
      const feats = await asr.processor(detAudio);
      const sot = asr.model.config.decoder_start_token_id; // <|startoftranscript|>
      const decoderIds = new tf.Tensor('int64', new BigInt64Array([BigInt(sot)]), [1, 1]);
      const fwd = await asr.model({ ...feats, decoder_input_ids: decoderIds });
      const logits = fwd.logits.data; // [1,1,vocab]
      const ranked = Object.entries(asr.model.generation_config.lang_to_id)
        .map(([tok, id]) => [tok.slice(2, -2), logits[id]]) // '<|es|>' → 'es'
        .sort((a, b) => b[1] - a[1]);
      // Only accept codes transformers.js can force back through generate(): its
      // language map holds the 99 two-letter codes plus 'haw'. large-v3-turbo's model
      // config ALSO lists 'yue' (Cantonese), which transformers.js 3.8.1 throws on —
      // walk the ranking and take the first acceptable code (Cantonese falls through
      // to its runner-up, typically zh).
      const acceptable = ([code]) => code.length === 2 || code === 'haw';
      effectiveLanguage = ranked.find(acceptable)?.[0] ?? 'en';
      onLog(
        `language auto-detect: ${effectiveLanguage} (on the loudest 30s of vocals @ ${(s0 / 16000).toFixed(0)}s)`
      );
    } catch (e) {
      effectiveLanguage = 'en';
      onLog(`language auto-detect failed (${String(e.message).slice(0, 80)}) - using English`);
    }
  }

  const tStart = performance.now();
  onLog(`transcribing ${audioMin} min of vocals …`);
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
      onLog(`prompt tokenize failed (${e.message}) - transcribing without prompt`);
    }
  }
  const SR16 = 16000;
  const totalSamples = mono.length;
  const allChunks = [];
  // English-only models (whisper-*.en) REJECT language/task outright
  // ('Cannot specify `task` or `language` for an English-only model'), while
  // multilingual models need the resolved language passed explicitly (omitting
  // it silently forces English). Pass it only where it is accepted.
  const multilingual = Boolean(
    asr?.model?.generation_config?.is_multilingual ?? asr?.model?.generation_config?.lang_to_id
  );
  if (!multilingual && effectiveLanguage && effectiveLanguage !== 'en') {
    onLog(
      `model is English-only but language is '${effectiveLanguage}' - pick a multilingual whisper model for non-English lyrics`
    );
  }
  const baseOpts = {
    return_timestamps: useWordTs ? 'word' : true,
    ...(effectiveLanguage && multilingual ? { language: effectiveLanguage } : {}),
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

  // --- Segment planning ---
  const segOpts = {
    hopSec: WIN_SEC,
    minSegSec: 20,
    maxSegSec: 30,
    overlapSec: 0,
    dipSec: 0.5,
  };
  let plan;
  let voicedSec = duration;
  if (skipSilence) {
    // Plan 20-30s dip-cut segments WITHIN each voiced span; silence between
    // spans is never sent to Whisper.
    const spans = voicedSpans(rms, WIN_SEC, silentThresh);
    voicedSec = spans.reduce((a, s) => a + (s.end - s.start), 0);
    plan = [];
    for (const span of spans) {
      const lo = Math.floor(span.start / WIN_SEC);
      const hi = Math.min(nWin, Math.ceil(span.end / WIN_SEC));
      const sub = planVocalSegments(rms.subarray(lo, hi), {
        ...segOpts,
        durationSec: span.end - span.start,
      });
      for (const seg of sub)
        plan.push({ start: seg.start + span.start, end: seg.end + span.start });
    }
    onLog(
      `planned ${plan.length} segment(s) over ${voicedSec.toFixed(0)}s of voiced audio ` +
        `(skipping ${(duration - voicedSec).toFixed(0)}s of instrumental/silence)`
    );
    if (!plan.length) {
      clearInterval(hb);
      onTranscribeInfo('');
      onLog('no voiced audio detected - skipping transcription entirely');
      return {
        words: [],
        text: '',
        seconds: (performance.now() - tStart) / 1000,
        mono,
        rms,
        hopSec: WIN_SEC,
        silentFrac: SILENT_FRAC,
        inSilentGap,
        segmentsPlanned: 0,
        transcribedSec: 0,
      };
    }
  } else {
    plan = planVocalSegments(rms, { ...segOpts, durationSec: duration });
    onLog(`planned ${plan.length} vocal-aware segment(s) (20s + best-dip cut, ≤30s, clean cuts)`);
  }
  const transcribedSec = plan.reduce((a, s) => a + (s.end - s.start), 0);

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
      if (noSpeechGate && w.noSpeech != null && w.noSpeech > 0.6) {
        onLog(
          `  segment ${chunkIdx} @ ${start.toFixed(0)}-${end.toFixed(0)}s: gated ` +
            `(no_speech ${w.noSpeech.toFixed(2)})`
        );
        continue;
      }
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
        onLyricsPreview(groupWordsIntoLines(flat, { duration }));
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
    `Whisper raw: ${words.length} words, ${(out.text || '').length} chars, last word @ ${lastWordT.toFixed(0)}s of ${duration.toFixed(0)}s${promptText ? ' (prompt ON)' : ''}`
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

  return {
    words,
    text: out.text || '',
    seconds: tSec,
    mono, // 16k mono vocals - CREPE pitch detection reuses it
    rms,
    hopSec: WIN_SEC,
    silentFrac: SILENT_FRAC,
    inSilentGap,
    segmentsPlanned: plan.length,
    transcribedSec,
    language: effectiveLanguage, // the RESOLVED language ('auto' → detected code)
  };
}
