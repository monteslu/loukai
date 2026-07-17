/**
 * demucs-web API compatibility + fused helpers for the ft-ensemble path.
 *
 * ft-ensemble.js drives the 4 specialist sessions itself and only needs the DSP:
 * prepareModelInput / standaloneMask / standaloneIspec (exact demucs-web
 * signatures and layouts, MIT, timcsy) - reimplemented here over the WASM+SIMD
 * KissFFT backend so the ensemble's CPU cost drops the same way the
 * single-model path's did. freqTrackToTime is the fused fast path (skips the
 * 4-track standaloneMask materialization when only one stem is consumed).
 *
 * The annotated TypeScript source of this runner lives in mochamix
 * (packages/stems/src/vendor/demucs); keep the two in sync.
 */

import { WasmStemsDsp } from './stemsdsp.js';
import { stft as stftJs, istft as istftJs, reflectPad } from './fft.js';
import { CONSTANTS } from './constants.js';

const { FFT_SIZE, HOP_SIZE, TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES } = CONSTANTS;
const STFT_PAD = Math.floor(HOP_SIZE / 2) * 3;
const STFT_LE = Math.ceil(TRAINING_SAMPLES / HOP_SIZE);
const STFT_PAD_RIGHT = STFT_PAD + STFT_LE * HOP_SIZE - TRAINING_SAMPLES;
const STFT_INPUT_LEN = STFT_PAD + TRAINING_SAMPLES + STFT_PAD_RIGHT;
const CENTER_PAD = FFT_SIZE / 2;
const CENTERED_LEN = STFT_INPUT_LEN + 2 * CENTER_PAD;
const PADDED_BINS = MODEL_SPEC_BINS + 1;
const PADDED_FRAMES = MODEL_SPEC_FRAMES + 4;
const ISTFT_LEN = (PADDED_FRAMES - 1) * HOP_SIZE + FFT_SIZE;
const ISTFT_OFFSET = CENTER_PAD + STFT_PAD;
const PLANE = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;

// Shared DSP backend: WASM+SIMD KissFFT, pure-JS FFT as the fallback.
let backend = null;
function getBackend() {
  if (backend) return backend;
  try {
    backend = new WasmStemsDsp();
  } catch {
    let spec;
    let ispecReal = new Float32Array(0);
    let ispecImag = new Float32Array(0);
    let out = new Float32Array(0);
    backend = {
      stft(signal, fftSize, hop) {
        spec = stftJs(signal, fftSize, hop, spec);
        return spec;
      },
      ispecViews(numFrames, numBins) {
        const n = numFrames * numBins;
        if (ispecReal.length !== n) {
          ispecReal = new Float32Array(n);
          ispecImag = new Float32Array(n);
        }
        return { real: ispecReal, imag: ispecImag };
      },
      istft(numFrames, numBins, fftSize, hop, outLen) {
        if (out.length !== outLen) out = new Float32Array(outLen);
        return istftJs(ispecReal, ispecImag, numFrames, numBins, fftSize, hop, outLen, out);
      },
    };
  }
  return backend;
}

// Reused pre-STFT scratch (compat calls are strictly sequential).
let segScratch = null;
function getSegScratch() {
  if (!segScratch) {
    segScratch = {
      seg: new Float32Array(TRAINING_SAMPLES),
      stftInput: new Float32Array(STFT_INPUT_LEN),
      centered: new Float32Array(CENTERED_LEN),
    };
  }
  return segScratch;
}

/**
 * demucs-web prepareModelInput: pad a (≤TRAINING_SAMPLES) stereo segment, STFT
 * both channels, and lay out the model inputs. Returns FRESH waveform/magSpec
 * arrays (callers may hold them across calls). Same output as upstream, with
 * the FFT work in WASM.
 */
export function prepareModelInput(leftChannel, rightChannel) {
  const dsp = getBackend();
  const s = getSegScratch();
  const magSpec = new Float32Array(4 * PLANE);
  const waveform = new Float32Array(2 * TRAINING_SAMPLES);

  const channelToMag = (src, channelBase, waveOffset) => {
    s.seg.fill(0);
    s.seg.set(src.subarray(0, Math.min(src.length, TRAINING_SAMPLES)));
    waveform.set(s.seg, waveOffset);
    reflectPad(s.seg, STFT_PAD, STFT_PAD_RIGHT, s.stftInput);
    reflectPad(s.stftInput, CENTER_PAD, CENTER_PAD, s.centered);
    const spec = dsp.stft(s.centered, FFT_SIZE, HOP_SIZE);
    const realBase = channelBase * PLANE;
    const imagBase = (channelBase + 1) * PLANE;
    for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
      const srcRow = (f + 2) * spec.numBins;
      for (let b = 0; b < MODEL_SPEC_BINS; b++) {
        magSpec[realBase + b * MODEL_SPEC_FRAMES + f] = spec.real[srcRow + b];
        magSpec[imagBase + b * MODEL_SPEC_FRAMES + f] = spec.imag[srcRow + b];
      }
    }
  };
  channelToMag(leftChannel, 0, 0);
  channelToMag(rightChannel, 2, TRAINING_SAMPLES);

  return {
    waveform,
    magSpec,
    numBins: MODEL_SPEC_BINS,
    numFrames: MODEL_SPEC_FRAMES,
    originalLength: leftChannel.length,
  };
}

/**
 * demucs-web standaloneMask: split the model's frequency output into 4 per-track
 * complex spectrograms (upstream layout: [b * numFrames + f]). Compat only -
 * prefer freqTrackToTime, which skips materializing the 3 unused tracks.
 */
export function standaloneMask(freqOutput) {
  const result = [];
  for (let t = 0; t < 4; t++) {
    const trackSpec = {
      leftReal: new Float32Array(PLANE),
      leftImag: new Float32Array(PLANE),
      rightReal: new Float32Array(PLANE),
      rightImag: new Float32Array(PLANE),
    };
    const base = t * 4 * PLANE;
    for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
      for (let b = 0; b < MODEL_SPEC_BINS; b++) {
        const src = b * MODEL_SPEC_FRAMES + f;
        const out = b * MODEL_SPEC_FRAMES + f;
        trackSpec.leftReal[out] = freqOutput[base + src];
        trackSpec.leftImag[out] = freqOutput[base + PLANE + src];
        trackSpec.rightReal[out] = freqOutput[base + 2 * PLANE + src];
        trackSpec.rightImag[out] = freqOutput[base + 3 * PLANE + src];
      }
    }
    result.push(trackSpec);
  }
  return result;
}

function istftPadded(fillRow) {
  const dsp = getBackend();
  const views = dsp.ispecViews(PADDED_FRAMES, PADDED_BINS);
  views.real.fill(0);
  views.imag.fill(0);
  fillRow(views.real, views.imag);
  return dsp.istft(PADDED_FRAMES, PADDED_BINS, FFT_SIZE, HOP_SIZE, ISTFT_LEN);
}

/**
 * demucs-web standaloneIspec: one track's complex spectrogram → stereo time
 * domain, cropped to targetLength. Same math, WASM iSTFT.
 */
export function standaloneIspec(trackSpec, targetLength) {
  const channel = (real, imag) => {
    const time = istftPadded((dstR, dstI) => {
      for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
        const dstRow = (f + 2) * PADDED_BINS;
        for (let b = 0; b < MODEL_SPEC_BINS; b++) {
          dstR[dstRow + b] = real[b * MODEL_SPEC_FRAMES + f];
          dstI[dstRow + b] = imag[b * MODEL_SPEC_FRAMES + f];
        }
      }
    });
    return new Float32Array(time.subarray(ISTFT_OFFSET, ISTFT_OFFSET + targetLength));
  };
  return {
    left: channel(trackSpec.leftReal, trackSpec.leftImag),
    right: channel(trackSpec.rightReal, trackSpec.rightImag),
  };
}

/**
 * Fused fast path for the ensemble: ONE track's frequency output straight to
 * stereo time domain - no intermediate per-track spectrograms at all.
 * Equivalent to standaloneIspec(standaloneMask(freqOutput)[track], targetLength).
 */
export function freqTrackToTime(freqOutput, track, targetLength) {
  const channel = (channelBase) => {
    const realBase = (track * 4 + channelBase) * PLANE;
    const imagBase = (track * 4 + channelBase + 1) * PLANE;
    const time = istftPadded((dstR, dstI) => {
      for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
        const dstRow = (f + 2) * PADDED_BINS;
        for (let b = 0; b < MODEL_SPEC_BINS; b++) {
          dstR[dstRow + b] = freqOutput[realBase + b * MODEL_SPEC_FRAMES + f];
          dstI[dstRow + b] = freqOutput[imagBase + b * MODEL_SPEC_FRAMES + f];
        }
      }
    });
    return new Float32Array(time.subarray(ISTFT_OFFSET, ISTFT_OFFSET + targetLength));
  };
  return { left: channel(0), right: channel(2) };
}
