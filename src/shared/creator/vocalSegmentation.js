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
 * Plan transcription segments by cutting at vocal silence.
 *
 * Algorithm:
 *  1. Classify each RMS window as silent (< fraction of peak) or voiced.
 *  2. Walk voiced regions. Accumulate into a segment until adding the next voiced run
 *     would exceed maxSegSec — then cut at the SILENCE gap between runs (the natural
 *     boundary). A phrase is never split.
 *  3. If a single continuous voiced run is itself longer than maxSegSec (rare — a very
 *     long held passage), force a cut at the QUIETEST interior point of that run.
 *  4. Each segment after the first steps BACK by overlapSec so the boundary words are
 *     transcribed in both segments (reconciled later).
 *
 * @param {Float32Array|number[]} rms - per-window vocals RMS energy.
 * @param {Object} opts
 * @param {number} opts.hopSec - seconds per RMS window (e.g. 0.20).
 * @param {number} opts.durationSec - total audio duration.
 * @param {number} [opts.maxSegSec=28] - hard cap per segment (< Whisper's 30s limit).
 * @param {number} [opts.overlapSec=2] - step-back overlap between consecutive segments.
 * @param {number} [opts.silentFrac=0.08] - silence threshold as fraction of peak RMS.
 * @param {number} [opts.minGapSec=0.30] - min silent run to count as a cuttable gap.
 * @returns {Array<{start:number, end:number}>} segment spans in seconds.
 */
export function planVocalSegments(rms, opts) {
  const {
    hopSec,
    durationSec,
    maxSegSec = 28,
    overlapSec = 2,
    silentFrac = 0.08,
    minGapSec = 0.3,
    longGapSec = 2.0, // a silence this long is always a cut point (instrumental break)
  } = opts;

  const n = rms.length;
  if (!n || !durationSec) return [{ start: 0, end: durationSec || 0 }];

  let peak = 1e-9;
  for (let i = 0; i < n; i++) if (rms[i] > peak) peak = rms[i];
  const thresh = peak * silentFrac;
  const voiced = (i) => rms[i] > thresh;
  const tOf = (i) => i * hopSec;

  // Find voiced runs [startIdx, endIdx) and the silent gaps between them.
  const runs = [];
  let i = 0;
  while (i < n) {
    while (i < n && !voiced(i)) i++;
    if (i >= n) break;
    const s = i;
    while (i < n && voiced(i)) i++;
    runs.push([s, i]); // [start, end) in window indices
  }

  // No voiced content at all → one segment over the whole thing.
  if (!runs.length) return [{ start: 0, end: durationSec }];

  const minGapWins = Math.max(1, Math.round(minGapSec / hopSec));

  // Effective content budget per segment: the window we feed Whisper is
  // [cut - overlap, nextCut], so the SPACING between cuts must leave room for the
  // step-back. Keep the actual window <= maxSegSec.
  const budget = Math.max(5, maxSegSec - overlapSec);

  // Build cut points (in seconds). Cut in the silence BEFORE a run when keeping going
  // would exceed the budget; if a single run itself exceeds the budget, cut at its
  // quietest interior point(s).
  const cuts = [0];
  let segStartT = 0;
  const pushCut = (t) => {
    if (t > segStartT + 0.5 && t < durationSec - 0.05) {
      cuts.push(t);
      segStartT = t;
    }
  };

  for (let r = 0; r < runs.length; r++) {
    const [rs, re] = runs[r];
    const runEndT = tOf(re);

    // (a) cut at the silent gap BEFORE this run when either:
    //   - continuing past it would blow the budget, OR
    //   - the gap is LONG (a multi-second instrumental break is always a clean,
    //     phrase-safe cut point — e.g. a guitar solo), so segments never absorb a
    //     big silence and stay short.
    if (r > 0) {
      const [, prevEnd] = runs[r - 1];
      const gapWins = rs - prevEnd;
      const gapSec = gapWins * hopSec;
      const wouldExceed = tOf(rs) - segStartT > budget;
      const longGap = gapSec >= longGapSec;
      if (gapWins >= minGapWins && (wouldExceed || longGap)) {
        pushCut(tOf((prevEnd + rs) / 2)); // middle of the silence
      }
    }

    // (b) a single voiced run longer than the budget → force interior cut(s) at the
    // quietest point near each budget stride.
    while (runEndT - segStartT > budget) {
      const targetT = segStartT + budget;
      let bestI = Math.min(re - 1, Math.max(rs, Math.round(targetT / hopSec)));
      const lo = Math.max(rs, bestI - Math.round(1.5 / hopSec));
      const hi = Math.min(re - 1, bestI + Math.round(1.5 / hopSec));
      let minV = Infinity;
      for (let k = lo; k <= hi; k++) {
        if (rms[k] < minV) {
          minV = rms[k];
          bestI = k;
        }
      }
      const cutT = tOf(bestI);
      if (cutT <= segStartT + 0.5) break; // can't make progress → avoid infinite loop
      pushCut(cutT);
    }
  }

  // Last voiced offset — used to trim a trailing all-silent tail (outro fade) so the
  // final segment doesn't carry dead air that pushes its length over maxSegSec.
  const lastVoicedT = tOf(runs[runs.length - 1][1]);

  // Build segments from cut points, applying the step-back overlap to the START only.
  const bounds = [...cuts, durationSec];
  const segments = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const rawStart = bounds[s];
    let end = bounds[s + 1];
    const start = s === 0 ? 0 : Math.max(0, rawStart - overlapSec);
    // Trim trailing silence: never extend a segment more than a small pad past the
    // last voiced content, and never let the window exceed maxSegSec.
    if (end - start > maxSegSec) end = start + maxSegSec;
    if (end > lastVoicedT + 1.0 && start < lastVoicedT) {
      end = Math.min(end, lastVoicedT + 1.0);
    }
    segments.push({ start, end });
  }
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
