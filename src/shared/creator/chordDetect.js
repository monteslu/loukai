/**
 * Chord detection for the chord track (issue #93).
 *
 * Chromagram + triad template matching over the separated stems: the "other"
 * stem carries the harmony (guitars/keys) and the bass stem votes on the root
 * note, which is the disambiguator normal full-mix detectors never get.
 * Pure typed-array JS; runs inside the creator worker (or any Web Worker), so
 * nothing here may touch the DOM. A 4-minute song is well under a second.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WINDOW = 8192;
const HOP = 4096;
const MIN_SEGMENT_SEC = 0.6;
const ENERGY_FLOOR = 1e-4; // frames quieter than this are "no chord"

/** In-place iterative radix-2 FFT (real input, magnitudes out). */
function fftMagnitudes(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  const mags = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

/** Map FFT magnitudes to a 12-bin chroma vector over [fMin, fMax]. */
function chromaFromMags(mags, sampleRate, fMin, fMax) {
  const chroma = new Float32Array(12);
  const binHz = sampleRate / WINDOW;
  const lo = Math.max(1, Math.floor(fMin / binHz));
  const hi = Math.min(mags.length - 1, Math.ceil(fMax / binHz));
  for (let b = lo; b <= hi; b++) {
    const f = b * binHz;
    const midi = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    // energy, tapered against the high end so overtones dominate less
    chroma[pc] += mags[b] * mags[b] * (1 / Math.sqrt(f / fMin));
  }
  return chroma;
}

function downmix(stem) {
  const left = stem.left;
  const right = stem.right || stem.left;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

const hannCache = new Map();
function hann(n) {
  if (!hannCache.has(n)) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    hannCache.set(n, w);
  }
  return hannCache.get(n);
}

/**
 * Detect the ROOT NOTE timeline from separated stems (issue #93 feedback from
 * the field: full maj/min chord guessing missed changes; a bass-driven root is
 * far more reliable, and the editor lets players add the quality by hand).
 *
 * Per frame: the bass stem is nearly monophonic, so when it is sounding its
 * dominant pitch class IS the root. When the bass rests or is ambiguous, fall
 * back to the strongest pitch class of the harmony stem.
 *
 * @param {{left: Float32Array, right?: Float32Array}} other  harmony stem
 * @param {{left: Float32Array, right?: Float32Array}} bass   bass stem
 * @param {number} sampleRate
 * @returns {Array<{start: number, end: number, chord: string}>} merged segments
 *   of bare roots ('C', 'F#'); silent stretches are simply absent.
 */
export function detectChords(other, bass, sampleRate) {
  if (!other?.left?.length) return [];
  const harm = downmix(other);
  const bassMono = bass?.left?.length ? downmix(bass) : null;
  const win = hann(WINDOW);
  const re = new Float32Array(WINDOW);
  const im = new Float32Array(WINDOW);

  const dominantPc = (chroma) => {
    let energy = 0;
    for (let i = 0; i < 12; i++) energy += chroma[i];
    if (energy < ENERGY_FLOOR) return null;
    let best = 0;
    for (let i = 1; i < 12; i++) if (chroma[i] > chroma[best]) best = i;
    // Demand real dominance: the top pitch class must carry a meaningful share
    // of the frame's energy or the frame is ambiguous (transients, noise).
    return chroma[best] / energy >= 0.22 ? best : null;
  };

  const frames = [];
  for (let start = 0; start + WINDOW <= harm.length; start += HOP) {
    let pc = null;

    // Bass first: monophonic, low register, the root nearly by definition.
    if (bassMono && start + WINDOW <= bassMono.length) {
      for (let i = 0; i < WINDOW; i++) {
        re[i] = bassMono[start + i] * win[i];
        im[i] = 0;
      }
      pc = dominantPc(chromaFromMags(fftMagnitudes(re, im), sampleRate, 41, 300));
    }

    // Harmony fallback when the bass is silent or ambiguous.
    if (pc === null) {
      for (let i = 0; i < WINDOW; i++) {
        re[i] = harm[start + i] * win[i];
        im[i] = 0;
      }
      pc = dominantPc(chromaFromMags(fftMagnitudes(re, im), sampleRate, 82, 2000));
    }

    frames.push(pc === null ? null : NOTE_NAMES[pc]);
  }

  // Merge frames into segments; drop blips shorter than MIN_SEGMENT_SEC by
  // absorbing them into the previous segment.
  const hopSec = HOP / sampleRate;
  const segments = [];
  for (let f = 0; f < frames.length; f++) {
    const chord = frames[f];
    const t = f * hopSec;
    const last = segments[segments.length - 1];
    if (chord === null) {
      if (last && !last.closed) last.closed = true;
      continue;
    }
    if (last && !last.closed && last.chord === chord) {
      last.end = t + hopSec;
    } else {
      segments.push({ start: t, end: t + hopSec, chord, closed: false });
    }
  }
  const cleaned = [];
  for (const seg of segments) {
    if (seg.end - seg.start >= MIN_SEGMENT_SEC || cleaned.length === 0) {
      cleaned.push({ start: round2(seg.start), end: round2(seg.end), chord: seg.chord });
    } else {
      cleaned[cleaned.length - 1].end = round2(seg.end); // absorb the blip
    }
  }
  return cleaned;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
