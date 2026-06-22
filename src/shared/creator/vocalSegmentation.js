/**
 * Silence-aware vocal segmentation + overlap reconciliation.
 *
 * Shared, model-independent audio analysis used by BOTH creators (WebGPU + Python via
 * a port) to chunk transcription on the VOCALS STEM's own silence rather than a blind
 * time grid. Cutting at vocal silence means a sung phrase is never split across a
 * Whisper window — which is the root cause of dropped/garbled lyrics at chunk seams.
 *
 * Two pure functions, both unit-testable without a model:
 *   - planVocalSegments(rms, opts) → segment spans (with step-back overlap)
 *   - reconcileOverlaps(segments) → merged word list, deduped ONLY within overlap zones
 *
 * Everything is in SECONDS. `rms` is an array of per-window RMS energy of the vocals
 * stem; `hopSec` is the seconds-per-RMS-window.
 */

/**
 * Plan transcription segments: guaranteed-minimum + best-dip cut.
 *
 * Algorithm:
 *  1. Take a guaranteed `minSegSec` (e.g. 20s) of audio — never cut before this, so
 *     no tiny fragments.
 *  2. Scan the window from minSegSec..maxSegSec (e.g. 20→30s) for the best SUSTAINED
 *     dip in vocal energy (the quietest short run) — cut there. Bounded by maxSegSec,
 *     so the segment is always ≤30s and the cut lands in a quiet spot (unlikely to
 *     split a word).
 *  3. The next segment starts at that cut, stepping back `overlapSec` so boundary words
 *     are transcribed in both segments (reconciled later).
 *  4. Repeat until the audio is consumed.
 *
 * Much simpler than global silence analysis: a local search each step, always ≤30s by
 * construction, no special cases for long runs or long silences.
 *
 * @param {Float32Array|number[]} rms - per-window vocals RMS energy.
 * @param {Object} opts
 * @param {number} opts.hopSec - seconds per RMS window (e.g. 0.10).
 * @param {number} opts.durationSec - total audio duration.
 * @param {number} [opts.minSegSec=20] - guaranteed audio taken before any cut.
 * @param {number} [opts.maxSegSec=30] - hard cap per segment (Whisper's limit).
 * @param {number} [opts.overlapSec=2] - step-back overlap between consecutive segments.
 * @param {number} [opts.dipSec=0.5] - width of the sustained-dip search kernel.
 * @returns {Array<{start:number, end:number}>} segment spans in seconds.
 */
export function planVocalSegments(rms, opts) {
  const {
    hopSec,
    durationSec,
    minSegSec = 20,
    maxSegSec = 30,
    overlapSec = 2,
    dipSec = 0.5,
  } = opts;

  const n = rms.length;
  if (!n || !durationSec) return [{ start: 0, end: durationSec || 0 }];

  const tOf = (i) => i * hopSec;
  const dipWins = Math.max(1, Math.round(dipSec / hopSec));
  // Sustained dip = lowest average energy over a dipWins-wide kernel centered at i.
  const dipScore = (i) => {
    const lo = Math.max(0, i - (dipWins >> 1));
    const hi = Math.min(n - 1, lo + dipWins - 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += rms[k];
    return sum / (hi - lo + 1);
  };

  const segments = [];
  let startT = 0;
  let guard = 0;
  const maxSegments = Math.ceil(durationSec / Math.max(1, minSegSec)) + 4;
  while (startT < durationSec - 0.05 && guard++ < maxSegments) {
    const hardEnd = Math.min(durationSec, startT + maxSegSec);
    // If what remains fits in one segment, take it all and stop.
    if (durationSec - startT <= maxSegSec) {
      const start = segments.length === 0 ? 0 : Math.max(0, startT - overlapSec);
      segments.push({ start, end: durationSec });
      break;
    }
    // Search [startT+minSegSec, startT+maxSegSec] for the quietest sustained dip.
    const searchLoT = startT + minSegSec;
    const searchHiT = startT + maxSegSec;
    const loI = Math.round(searchLoT / hopSec);
    const hiI = Math.min(n - 1, Math.round(searchHiT / hopSec));
    let bestI = hiI; // default: cut at maxSegSec if no clear dip
    let bestScore = Infinity;
    for (let i = loI; i <= hiI; i++) {
      const sc = dipScore(i);
      if (sc < bestScore) {
        bestScore = sc;
        bestI = i;
      }
    }
    const cutT = Math.min(hardEnd, Math.max(searchLoT, tOf(bestI)));
    const start = segments.length === 0 ? 0 : Math.max(0, startT - overlapSec);
    segments.push({ start, end: cutT });
    startT = cutT;
  }
  if (!segments.length) segments.push({ start: 0, end: durationSec });
  return segments;
}

/**
 * Reconcile word lists from overlapping segments into one ordered, de-duplicated list.
 *
 * Conservative: a word is only considered a duplicate if it falls inside the OVERLAP
 * TIME WINDOW shared by two adjacent segments AND matches an already-kept word (same
 * normalized text within a small time tolerance). Outside overlap zones, every word is
 * kept — so legitimately-repeated lyrics elsewhere (e.g. "no no no no") are never
 * touched.
 *
 * @param {Array<{start:number, words:Array<{text:string,start:number,end:number}>}>} segments
 *   each carrying its absolute-time words (already offset to song time).
 * @param {number} [timeTol=0.6] - seconds tolerance for "same word" within an overlap.
 * @returns {Array<{text:string,start:number,end:number}>} merged words, time-ordered.
 */
export function reconcileOverlaps(segments, timeTol = 0.6) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const kept = [];
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const prev = si > 0 ? segments[si - 1] : null;
    // The overlap zone with the previous segment is [seg.start, prevEnd] where prevEnd
    // is the previous segment's last word end (or seg boundary). Words from THIS segment
    // inside that zone are candidates for dedup against already-kept words.
    const prevLastEnd = prev && kept.length ? kept[kept.length - 1].end : seg.start;
    const overlapEnd = Math.max(seg.start, prevLastEnd);
    for (const w of seg.words || []) {
      const mid = (w.start + w.end) / 2;
      const inOverlap = si > 0 && mid <= overlapEnd + timeTol;
      if (inOverlap) {
        // dedup: is there a kept word with same norm text near this time?
        const dup = kept.some(
          (k) => Math.abs((k.start + k.end) / 2 - mid) <= timeTol && norm(k.text) === norm(w.text)
        );
        if (dup) continue;
      }
      kept.push(w);
    }
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * Snap line boundaries to the actual vocal energy (final alignment pass).
 *
 * Whisper's timestamps drift on singing — a line can start/end a little early or late
 * vs. when the voice actually sounds. The vocals stem is the ground truth: this nudges
 * each line's start to the nearest vocal ONSET and its end to the nearest vocal OFFSET
 * within a small search window, so highlighting lands on the beat. Never moves a
 * boundary past a neighboring line's, and only adjusts within `searchSec`.
 *
 * @param {Array<{text:string,start:number,end:number}>} lines - time-ordered lines.
 * @param {Float32Array|number[]} rms - vocals RMS per window.
 * @param {Object} opts
 * @param {number} opts.hopSec - seconds per RMS window.
 * @param {number} [opts.searchSec=0.5] - max nudge in either direction.
 * @param {number} [opts.silentFrac=0.08] - voiced threshold (fraction of peak).
 * @returns {Array} the same lines with adjusted start/end.
 */
export function snapToVocalEnergy(lines, rms, opts) {
  const { hopSec, searchSec = 0.5, silentFrac = 0.08 } = opts;
  const n = rms?.length || 0;
  if (!n || !lines?.length) return lines;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) if (rms[i] > peak) peak = rms[i];
  const thresh = peak * silentFrac;
  const voiced = (i) => i >= 0 && i < n && rms[i] > thresh;
  const win = (t) => Math.max(0, Math.min(n - 1, Math.round(t / hopSec)));
  const span = Math.max(1, Math.round(searchSec / hopSec));

  // ONSET = a silence→voiced boundary (index k where !voiced(k-1) && voiced(k)).
  // OFFSET = a voiced→silence boundary (index k where voiced(k) && !voiced(k+1)),
  // the offset TIME is the start of the first silent window = (k+1)*hop.
  // For each, scan outward from the target and return the CLOSEST boundary within span.
  const nearestOnset = (t) => {
    const c = win(t);
    for (let d = 0; d <= span; d++) {
      if (voiced(c - d) && !voiced(c - d - 1)) return (c - d) * hopSec;
      if (voiced(c + d) && !voiced(c + d - 1)) return (c + d) * hopSec;
    }
    return t;
  };
  const nearestOffset = (t) => {
    const c = win(t);
    for (let d = 0; d <= span; d++) {
      // a boundary at index k means voiced(k) && !voiced(k+1); offset time = (k+1)*hop
      if (voiced(c - d) && !voiced(c - d + 1)) return (c - d + 1) * hopSec;
      if (voiced(c + d) && !voiced(c + d + 1)) return (c + d + 1) * hopSec;
    }
    return t;
  };

  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const prevEnd = i > 0 ? out[i - 1].end : 0;
    const nextStart = i < out.length - 1 ? out[i + 1].start : Infinity;
    let s = nearestOnset(out[i].start);
    let e = nearestOffset(out[i].end);
    // clamp so we never cross neighbors or invert the line
    s = Math.max(prevEnd, Math.min(s, out[i].end - 0.1));
    e = Math.min(nextStart, Math.max(e, s + 0.1));
    out[i].start = Number(s.toFixed(3));
    out[i].end = Number(e.toFixed(3));
  }
  return out;
}
