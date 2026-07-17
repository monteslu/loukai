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

// Whisper transcription languages — the FULL set the models support (and that
// transformers.js can force), in whisper's training-prevalence order so the common
// picks sit on top. 'auto' (real detection, see transcribeVocals) is prepended by the
// dropdowns; English is the default everywhere. Note: large-v3-turbo additionally knows
// 'yue' (Cantonese), but transformers.js 3.8.1 cannot force it, so it is not offered.
export const WHISPER_LANGUAGES = [
  ['en', 'English'],
  ['zh', 'Chinese'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['ru', 'Russian'],
  ['ko', 'Korean'],
  ['fr', 'French'],
  ['ja', 'Japanese'],
  ['pt', 'Portuguese'],
  ['tr', 'Turkish'],
  ['pl', 'Polish'],
  ['ca', 'Catalan'],
  ['nl', 'Dutch'],
  ['ar', 'Arabic'],
  ['sv', 'Swedish'],
  ['it', 'Italian'],
  ['id', 'Indonesian'],
  ['hi', 'Hindi'],
  ['fi', 'Finnish'],
  ['vi', 'Vietnamese'],
  ['he', 'Hebrew'],
  ['uk', 'Ukrainian'],
  ['el', 'Greek'],
  ['ms', 'Malay'],
  ['cs', 'Czech'],
  ['ro', 'Romanian'],
  ['da', 'Danish'],
  ['hu', 'Hungarian'],
  ['ta', 'Tamil'],
  ['no', 'Norwegian'],
  ['th', 'Thai'],
  ['ur', 'Urdu'],
  ['hr', 'Croatian'],
  ['bg', 'Bulgarian'],
  ['lt', 'Lithuanian'],
  ['la', 'Latin'],
  ['mi', 'Maori'],
  ['ml', 'Malayalam'],
  ['cy', 'Welsh'],
  ['sk', 'Slovak'],
  ['te', 'Telugu'],
  ['fa', 'Persian'],
  ['lv', 'Latvian'],
  ['bn', 'Bengali'],
  ['sr', 'Serbian'],
  ['az', 'Azerbaijani'],
  ['sl', 'Slovenian'],
  ['kn', 'Kannada'],
  ['et', 'Estonian'],
  ['mk', 'Macedonian'],
  ['br', 'Breton'],
  ['eu', 'Basque'],
  ['is', 'Icelandic'],
  ['hy', 'Armenian'],
  ['ne', 'Nepali'],
  ['mn', 'Mongolian'],
  ['bs', 'Bosnian'],
  ['kk', 'Kazakh'],
  ['sq', 'Albanian'],
  ['sw', 'Swahili'],
  ['gl', 'Galician'],
  ['mr', 'Marathi'],
  ['pa', 'Punjabi'],
  ['si', 'Sinhala'],
  ['km', 'Khmer'],
  ['sn', 'Shona'],
  ['yo', 'Yoruba'],
  ['so', 'Somali'],
  ['af', 'Afrikaans'],
  ['oc', 'Occitan'],
  ['ka', 'Georgian'],
  ['be', 'Belarusian'],
  ['tg', 'Tajik'],
  ['sd', 'Sindhi'],
  ['gu', 'Gujarati'],
  ['am', 'Amharic'],
  ['yi', 'Yiddish'],
  ['lo', 'Lao'],
  ['uz', 'Uzbek'],
  ['fo', 'Faroese'],
  ['ht', 'Haitian Creole'],
  ['ps', 'Pashto'],
  ['tk', 'Turkmen'],
  ['nn', 'Nynorsk'],
  ['mt', 'Maltese'],
  ['sa', 'Sanskrit'],
  ['lb', 'Luxembourgish'],
  ['my', 'Myanmar'],
  ['bo', 'Tibetan'],
  ['tl', 'Tagalog'],
  ['mg', 'Malagasy'],
  ['as', 'Assamese'],
  ['tt', 'Tatar'],
  ['haw', 'Hawaiian'],
  ['ln', 'Lingala'],
  ['ha', 'Hausa'],
  ['ba', 'Bashkir'],
  ['jw', 'Javanese'],
  ['su', 'Sundanese'],
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
/**
 * Cull "thank you" / "thanks for watching" hallucinations — Whisper's single most
 * common ghost (trained on endless video outros), clustering over the dead
 * intro/outro instrumental. The discriminator is position, NOT a phrase blacklist
 * or a fixed time cutoff: a thanks word is a ghost only when it falls OUTSIDE the
 * lyric body (the span of the first..last NON-thanks word). So a song that sings
 * "thank you" within its body (e.g. Alanis "Thank U") keeps every one, while
 * Sweet Emotion's intro/outro "thank you"s are removed.
 *
 * @param {Array} words - [{text, timestamp:[s,e]} | {text, start, end}]
 * @returns {{ words: Array, removed: string[] }}
 */
export function cullOutroThanks(words) {
  const startOf = (w) => (w.timestamp ? w.timestamp[0] : w.start) ?? null;
  const THANKS = /^(thank|thanks|thank[- ]?you|you|for|watching|so|much)[.,!?]*$/i;
  const STRONG = /^(thank|thanks|watching)[.,!?]*$/i; // a "strong" thanks token
  const isThanks = (w) => THANKS.test((w.text || '').trim());

  let bodyStart = Infinity;
  let bodyEnd = -Infinity;
  for (const w of words) {
    if (isThanks(w)) continue;
    const s = startOf(w);
    if (s == null) continue;
    if (s < bodyStart) bodyStart = s;
    if (s > bodyEnd) bodyEnd = s;
  }
  // No non-thanks words at all → can't tell ghost from lyric; keep everything.
  if (bodyEnd < bodyStart) return { words, removed: [] };

  const outside = (s) => s != null && (s < bodyStart || s > bodyEnd);
  const removed = [];
  // Pass 1: remove strong thanks tokens stranded outside the body.
  let kept = words.filter((w) => {
    const s = startOf(w);
    if (STRONG.test((w.text || '').trim()) && outside(s)) {
      removed.push(`${(w.text || '').trim()}@${s.toFixed(0)}s`);
      return false;
    }
    return true;
  });
  // Pass 2: the weak companions ("you"/"for"/...) also stranded outside go too.
  if (removed.length) {
    kept = kept.filter((w) => {
      const s = startOf(w);
      if (isThanks(w) && outside(s)) {
        removed.push(`${(w.text || '').trim()}@${s.toFixed(0)}s`);
        return false;
      }
      return true;
    });
  }
  return { words: kept, removed };
}

export function groupWordsIntoLines(
  words,
  { maxGap = 1.5, maxWords = 12, maxDur = 9, duration = Infinity, maxLineDur = 10 } = {}
) {
  const lines = [];
  const dropped = []; // lines removed by grouping (so the caller can report them)
  let cur = null;
  // A "word" with no letters/digits (e.g. ".." or "♪") is punctuation/noise, not a
  // lyric — Whisper emits these as hallucinations over fades/instrumental. Drop them.
  const hasContent = (s) => /[\p{L}\p{N}]/u.test(s);
  // Normalized word key for collapsing a stuck-decoder run (e.g. "Oh." x31): strip
  // punctuation + case so "Oh." and "Oh" compare equal.
  const wordKey = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
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
  // Collapse a stuck-decoder run first: ≥4 consecutive identical words (e.g.
  // "Oh." "Oh." ... x31 from a decoder collapse) become a single word spanning
  // the run. Real lyrics don't repeat the SAME word 4+ times back-to-back with no
  // other word between; loops do. This kills the worst hallucination before grouping.
  const collapsed = [];
  for (const w of words) {
    const text = (w.text || '').trim();
    if (!text) continue;
    const prev = collapsed[collapsed.length - 1];
    if (prev && wordKey(prev.text) && wordKey(prev.text) === wordKey(text)) {
      prev.run = (prev.run || 1) + 1;
      const [, e] = w.timestamp || [w.start, w.end];
      if (e != null) prev.end = e; // extend the run's end
      continue;
    }
    const [start, end] = w.timestamp || [w.start, w.end];
    collapsed.push({ text, start, end, run: 1 });
  }
  for (const w of collapsed) {
    // A long identical-word run is a loop artifact, not a lyric — drop it entirely.
    if ((w.run || 1) >= 4) {
      dropped.push({ text: `${w.text} x${w.run}`, start: w.start, reason: 'identical-run loop' });
      continue;
    }
    const { text, start, end } = w;
    if (start == null) continue;
    if (!cur) {
      cur = { text, start, end, n: 1 };
    } else {
      const gap = start - cur.end;
      // Only treat a sentence-ending period as a line break once the line is
      // substantial. Whisper sprinkles spurious mid-phrase periods ("Sweet motion."
      // "wears.") that would otherwise fracture a clean line into fragments.
      const endsSentence = /[.!?]$/.test(cur.text) && cur.n >= 4;
      const tooLong = cur.n >= maxWords || end - cur.start > maxDur;
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
