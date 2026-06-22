/**
 * Transcription scoring harness — grade a candidate lyric transcription against a
 * hand-made GOLD STANDARD (correct lines + line start/end). Line-level only (no
 * per-word timing required in gold).
 *
 * Metrics:
 *  - WER (word error rate) over the full concatenated text — substitutions, deletions,
 *    insertions / gold word count. Lower is better; 0 = perfect text.
 *  - Word accuracy = 1 - WER.
 *  - Line-timing MAE — for each gold line matched to a candidate line (by text overlap),
 *    the mean absolute error of start and end (seconds). Lower is better.
 *  - Junk/extra ratio — candidate words with no gold counterpart (hallucinations).
 *
 * Usage:
 *   node score.mjs <gold.json> <candidate.json>
 * where each file is { lines: [{text, start, end}, ...] }  (candidate may also be the
 * raw {segments:[...]} dump — we flatten text either way).
 */
import { readFileSync } from 'fs';

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const words = (lines) =>
  lines
    .map((l) => norm(l.text))
    .join(' ')
    .split(' ')
    .filter(Boolean);

// Levenshtein over word arrays → edit distance (for WER).
function wordEditDistance(a, b) {
  const m = a.length;
  const k = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(k + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= k; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= k; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][k];
}

// Load a file; accept {lines:[...]} or {segments:[...]} (raw dump) and normalize to lines.
function loadLines(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(j.lines)) return j.lines.map((l) => ({ text: l.text, start: l.start, end: l.end }));
  if (Array.isArray(j.segments)) {
    // Python raw: segments[] have .text/.start/.end. Web raw: segments[] have .chunks[].
    if (j.segments.some((s) => Array.isArray(s.chunks))) {
      const lines = [];
      for (const seg of j.segments)
        for (const c of seg.chunks || [])
          lines.push({ text: c.text, start: c.t?.[0] ?? c.start, end: c.t?.[1] ?? c.end });
      return lines;
    }
    return j.segments.map((s) => ({ text: s.text, start: s.start, end: s.end }));
  }
  if (Array.isArray(j) && j[0]?.chunks) {
    const lines = [];
    for (const seg of j) for (const c of seg.chunks) lines.push({ text: c.text, start: c.t?.[0], end: c.t?.[1] });
    return lines;
  }
  throw new Error(`unrecognized shape in ${path}`);
}

// Match each gold line to the best-overlapping candidate line (by normalized-token
// Jaccard) to compute timing error on aligned lines.
function timingMAE(gold, cand) {
  const tok = (l) => new Set(norm(l.text).split(' ').filter(Boolean));
  let sumStart = 0;
  let sumEnd = 0;
  let matched = 0;
  for (const g of gold) {
    const gt = tok(g);
    if (!gt.size) continue;
    let best = null;
    let bestJ = 0;
    for (const c of cand) {
      const ct = tok(c);
      if (!ct.size) continue;
      let inter = 0;
      for (const w of gt) if (ct.has(w)) inter++;
      const jac = inter / (gt.size + ct.size - inter);
      if (jac > bestJ) {
        bestJ = jac;
        best = c;
      }
    }
    if (best && bestJ >= 0.4 && g.start != null && best.start != null) {
      sumStart += Math.abs(g.start - best.start);
      if (g.end != null && best.end != null) sumEnd += Math.abs(g.end - best.end);
      matched++;
    }
  }
  return {
    matchedLines: matched,
    startMAE: matched ? sumStart / matched : null,
    endMAE: matched ? sumEnd / matched : null,
  };
}

function main() {
  const [, , goldPath, candPath] = process.argv;
  if (!goldPath || !candPath) {
    console.error('usage: node score.mjs <gold.json> <candidate.json>');
    process.exit(1);
  }
  const gold = loadLines(goldPath);
  const cand = loadLines(candPath);
  const gw = words(gold);
  const cw = words(cand);
  const dist = wordEditDistance(gw, cw);
  const wer = gw.length ? dist / gw.length : 0;
  const t = timingMAE(gold, cand);

  console.log('=== TRANSCRIPTION SCORE ===');
  console.log(`  gold:      ${gold.length} lines, ${gw.length} words`);
  console.log(`  candidate: ${cand.length} lines, ${cw.length} words`);
  console.log(`  WER:           ${(wer * 100).toFixed(1)}%   (word accuracy ${((1 - wer) * 100).toFixed(1)}%)`);
  console.log(`  edit distance: ${dist} word ops`);
  console.log(`  extra words:   ${Math.max(0, cw.length - gw.length)} (candidate longer than gold → likely hallucination/dup)`);
  console.log(
    `  line timing:   matched ${t.matchedLines}/${gold.length} lines, ` +
      `start MAE ${t.startMAE != null ? t.startMAE.toFixed(2) + 's' : 'n/a'}, ` +
      `end MAE ${t.endMAE != null ? t.endMAE.toFixed(2) + 's' : 'n/a'}`
  );
}

main();
