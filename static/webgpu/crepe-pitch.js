/**
 * CREPE pitch detection for the WebGPU creator (per-frame F0 of the vocals).
 *
 * Powers the karaoke pitch line / scoring — parity with the native creator's CREPE
 * step. Model: CREPE-tiny exported to ONNX (crepe_tiny.onnx, ~2MB, 6-conv CNN, runs
 * on WebGPU ~1.3s for a 3-min song). Input: 1024-sample frames @16k → output: 360
 * pitch-bin activations. We decode argmax → cents → Hz (CREPE's standard mapping)
 * and take the bin value as confidence.
 */

const SR = 16000;
const FRAME = 1024;
const BINS = 360;
const CENTS_PER_BIN = 20;
const C1_CENTS = 1997.379; // CREPE: cents of the first bin (32.70 Hz reference offset)

// hop = 10ms (160 samples @16k) → standard CREPE frame rate (matches torchcrepe).
const HOP = 160;

/**
 * Detect pitch over 16k mono audio.
 * @param ort onnxruntime-web module
 * @param session loaded CREPE ONNX InferenceSession (input 'frames'[B,1024])
 * @param mono Float32Array @16k
 * @param opts { batch=256, confidenceThreshold=0.5, onProgress }
 * @returns { times:Float32Array, frequency:Float32Array, confidence:Float32Array, hopSec }
 */
export async function detectPitch(ort, session, mono, opts = {}) {
  const batch = opts.batch ?? 256;
  const onProgress = opts.onProgress;
  const nFrames = Math.max(0, Math.floor((mono.length - FRAME) / HOP) + 1);
  const frequency = new Float32Array(nFrames);
  const confidence = new Float32Array(nFrames);
  const times = new Float32Array(nFrames);

  const inName = session.inputNames[0];
  const outName = session.outputNames[0];

  for (let base = 0; base < nFrames; base += batch) {
    const n = Math.min(batch, nFrames - base);
    // Build [n,1024], per-frame normalized (CREPE normalizes each frame to 0-mean/1-std).
    const buf = new Float32Array(n * FRAME);
    for (let f = 0; f < n; f++) {
      const start = (base + f) * HOP;
      let mean = 0;
      for (let i = 0; i < FRAME; i++) mean += mono[start + i] || 0;
      mean /= FRAME;
      let std = 0;
      for (let i = 0; i < FRAME; i++) {
        const v = (mono[start + i] || 0) - mean;
        buf[f * FRAME + i] = v;
        std += v * v;
      }
      std = Math.sqrt(std / FRAME) || 1;
      for (let i = 0; i < FRAME; i++) buf[f * FRAME + i] /= std;
      times[base + f] = (start + FRAME / 2) / SR;
    }
    const res = await session.run({ [inName]: new ort.Tensor('float32', buf, [n, FRAME]) });
    const act = res[outName].data; // [n, 360]
    for (let f = 0; f < n; f++) {
      // argmax bin + a local weighted average around it (CREPE's local-average decode).
      let bi = 0;
      let bv = -Infinity;
      for (let b = 0; b < BINS; b++) {
        const v = act[f * BINS + b];
        if (v > bv) {
          bv = v;
          bi = b;
        }
      }
      // weighted centroid over ±4 bins for sub-bin accuracy
      let wsum = 0;
      let csum = 0;
      for (let b = Math.max(0, bi - 4); b <= Math.min(BINS - 1, bi + 4); b++) {
        const w = act[f * BINS + b];
        wsum += w;
        csum += w * b;
      }
      const binF = wsum > 0 ? csum / wsum : bi;
      const cents = C1_CENTS + binF * CENTS_PER_BIN;
      const hz = 10 * 2 ** (cents / 1200); // CREPE cents→Hz
      confidence[base + f] = bv;
      frequency[base + f] = hz;
    }
    if (onProgress) onProgress(Math.min(1, (base + n) / nFrames));
  }
  return { times, frequency, confidence, hopSec: HOP / SR };
}

// Krumhansl-Schmuckler key profiles.
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function corr(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / (Math.sqrt(da * db) || 1);
}

/**
 * Estimate musical key from a pitch result (the parity feature the native creator
 * actually uses CREPE for). Builds a confidence-weighted pitch-class histogram and
 * correlates against Krumhansl-Schmuckler major/minor profiles.
 * @returns { key: 'Am'|'C'|…, mode: 'major'|'minor', confidence }
 */
export function detectKey({ frequency, confidence }, confThreshold = 0.5) {
  const chroma = new Float32Array(12);
  for (let i = 0; i < frequency.length; i++) {
    const f = frequency[i];
    const c = confidence[i];
    if (!(f > 0) || c < confThreshold) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += c;
  }
  let best = { score: -Infinity, key: 'C', mode: 'major' };
  for (let root = 0; root < 12; root++) {
    const rotM = KS_MAJOR.map((_, i) => KS_MAJOR[(i - root + 12) % 12]);
    const rotm = KS_MINOR.map((_, i) => KS_MINOR[(i - root + 12) % 12]);
    const sM = corr(chroma, rotM);
    const sm = corr(chroma, rotm);
    if (sM > best.score) best = { score: sM, key: NOTE_NAMES[root], mode: 'major' };
    if (sm > best.score) best = { score: sm, key: `${NOTE_NAMES[root]}m`, mode: 'minor' };
  }
  return { key: best.key, mode: best.mode, confidence: best.score };
}
