/**
 * Pure (no-React) creator audio + lyric helpers, extracted from WebGpuCreatorPanel so
 * the component stays a component. Browser-safe DSP/serialization only — used by the
 * WebGPU creator and any future creator surface.
 */

// Where the WebGPU runtime assets (transformers.min.js, ORT wasm) are served from.
export function assetBase() {
  return '/webgpu-assets';
}

// All word-timestamped (onnx-community *_timestamped). Word-level timing is what
// karaoke needs — we group the words into lyric LINES (groupWordsIntoLines), which
// also fixes line-timing drift since each line's start/end come from real word
// timings, not Whisper's coarse segment timestamps. Larger = more accurate, more VRAM.
export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny_timestamped', label: 'tiny · fastest' },
  { id: 'onnx-community/whisper-base_timestamped', label: 'base · fast' },
  { id: 'onnx-community/whisper-small_timestamped', label: 'small · more accurate' },
  {
    id: 'onnx-community/whisper-large-v3-turbo_timestamped',
    label: 'large-v3-turbo · best (q4f16, ~13× realtime)',
  },
];

// Demucs separation models (in-browser WebGPU). 'kind' selects the runner:
//   'single' = one htdemucs ONNX (demucs-web) — fast (~8× realtime on a good GPU).
//   'ft'     = htdemucs_ft 4-model fine-tuned ensemble — PyTorch-grade, ~2-3×
//              realtime (4× the compute). Default to the fast single model.
export const DEMUCS_MODELS = [
  { id: 'htdemucs', kind: 'single', label: 'htdemucs · fast (~8× realtime, default)' },
  {
    id: 'htdemucs_ft',
    kind: 'ft',
    label: 'htdemucs_ft · best quality, 4-model (~2-3× realtime)',
  },
];

// Encode stereo Float32 channels → a 16-bit PCM WAV Blob (for upload to the backend,
// which transcodes to AAC + muxes the .stem.mp4).
export function encodeWav(left, right, sampleRate = 44100) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4); // 16-bit stereo
  const v = new DataView(buf);
  const ws = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true); // byte rate
  v.setUint16(32, 4, true); // block align
  v.setUint16(34, 16, true); // bits
  ws(36, 'data');
  v.setUint32(40, n * 4, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    v.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    v.setInt16(off + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    off += 4;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Group word-level timestamps into lyric lines. Breaks on sentence punctuation, long
// pauses between words, or a max line length — each line's start/end is taken from its
// first/last word so line timing is accurate. `duration` (audio length) clamps the
// final line; `maxLineDur` caps any single line's displayed length.
export function groupWordsIntoLines(
  words,
  { maxGap = 1.0, maxWords = 10, maxDur = 8, duration = Infinity, maxLineDur = 10 } = {}
) {
  const lines = [];
  const dropped = []; // lines removed by grouping (so the caller can report them)
  let cur = null;
  // A "word" with no letters/digits (e.g. ".." or "♪") is punctuation/noise, not a
  // lyric — Whisper emits these as hallucinations over fades/instrumental. Drop them.
  const hasContent = (s) => /[\p{L}\p{N}]/u.test(s);
  const push = (c) => {
    const text = c.text.trim();
    if (!hasContent(text)) {
      dropped.push({ text, start: c.start, reason: 'punctuation/symbol-only' });
      return; // skip punctuation/symbol-only lines
    }
    let end = Math.min(c.end, duration); // never past the song end
    if (end - c.start > maxLineDur) end = c.start + maxLineDur; // cap runaway length
    if (end <= c.start) end = c.start + 0.5;
    lines.push({ text, start: c.start, end });
  };
  for (const w of words) {
    const text = (w.text || '').trim();
    if (!text) continue;
    const [start, end] = w.timestamp || [w.start, w.end];
    if (start == null) continue;
    if (!cur) {
      cur = { text, start, end, n: 1 };
    } else {
      const gap = start - cur.end;
      const tooLong = cur.n >= maxWords || end - cur.start > maxDur;
      const endsSentence = /[.!?]$/.test(cur.text);
      if (gap > maxGap || tooLong || endsSentence) {
        push(cur);
        cur = { text, start, end, n: 1 };
      } else {
        // join (no space before clitics/punctuation)
        cur.text += /^[,.!?;:']/.test(text) ? text : ` ${text}`;
        cur.end = end;
        cur.n += 1;
      }
    }
  }
  if (cur) push(cur);
  lines.dropped = dropped; // non-breaking: expose what grouping culled
  return lines;
}
