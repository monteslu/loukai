/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
const fftTwiddles = /* @__PURE__ */ new Map();
const ifftTwiddles = /* @__PURE__ */ new Map();
const hannWindows = /* @__PURE__ */ new Map();
const bitRevTables = /* @__PURE__ */ new Map();
function getTwiddles(cache, n, sign) {
  const hit = cache.get(n);
  if (hit) return hit;
  const real = new Float32Array(n / 2);
  const imag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const angle = (sign * 2 * Math.PI * k) / n;
    real[k] = Math.cos(angle);
    imag[k] = Math.sin(angle);
  }
  const t = { real, imag };
  cache.set(n, t);
  return t;
}
export function getHannWindow(size) {
  const hit = hannWindows.get(size);
  if (hit) return hit;
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  hannWindows.set(size, window);
  return window;
}
function getBitRevTable(n) {
  const hit = bitRevTables.get(n);
  if (hit) return hit;
  const bits = Math.log2(n) | 0;
  const table = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let v = i;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (v & 1);
      v >>= 1;
    }
    table[i] = r;
  }
  bitRevTables.set(n, table);
  return table;
}
function butterflies(realOut, imagOut, n, tw) {
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const k = j * step;
        const tReal = tw.real[k];
        const tImag = tw.imag[k];
        const idx1 = i + j;
        const idx2 = i + j + halfSize;
        const eReal = realOut[idx1];
        const eImag = imagOut[idx1];
        const oReal = realOut[idx2] * tReal - imagOut[idx2] * tImag;
        const oImag = realOut[idx2] * tImag + imagOut[idx2] * tReal;
        realOut[idx1] = eReal + oReal;
        imagOut[idx1] = eImag + oImag;
        realOut[idx2] = eReal - oReal;
        imagOut[idx2] = eImag - oImag;
      }
    }
  }
}
export function fft(realOut, imagOut, realIn, n) {
  const rev = getBitRevTable(n);
  for (let i = 0; i < n; i++) {
    realOut[i] = realIn[rev[i]];
    imagOut[i] = 0;
  }
  butterflies(realOut, imagOut, n, getTwiddles(fftTwiddles, n, -1));
}
export function ifft(realOut, imagOut, realIn, imagIn, n) {
  const rev = getBitRevTable(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    realOut[i] = realIn[j];
    imagOut[i] = imagIn[j];
  }
  butterflies(realOut, imagOut, n, getTwiddles(ifftTwiddles, n, 1));
  for (let i = 0; i < n; i++) {
    realOut[i] = realOut[i] / n;
    imagOut[i] = imagOut[i] / n;
  }
}
export function stft(signal, fftSize, hopSize, out) {
  const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2 + 1;
  const window = getHannWindow(fftSize);
  const scale = 1 / Math.sqrt(fftSize);
  const result =
    out && out.numFrames === numFrames && out.numBins === numBins
      ? out
      : {
          real: new Float32Array(numFrames * numBins),
          imag: new Float32Array(numFrames * numBins),
          numFrames,
          numBins,
        };
  const frameReal = scratchA(fftSize);
  const frameImag = scratchB(fftSize);
  const windowedFrame = scratchC(fftSize);
  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    for (let i = 0; i < fftSize; i++) {
      windowedFrame[i] = signal[start + i] * window[i];
    }
    fft(frameReal, frameImag, windowedFrame, fftSize);
    const outOffset = frame * numBins;
    for (let k = 0; k < numBins; k++) {
      result.real[outOffset + k] = frameReal[k] * scale;
      result.imag[outOffset + k] = frameImag[k] * scale;
    }
  }
  return result;
}
let sA = null;
let sB = null;
let sC = null;
let sD = null;
const scratchA = (n) => (sA && sA.length === n ? sA : (sA = new Float32Array(n)));
const scratchB = (n) => (sB && sB.length === n ? sB : (sB = new Float32Array(n)));
const scratchC = (n) => (sC && sC.length === n ? sC : (sC = new Float32Array(n)));
const scratchD = (n) => (sD && sD.length === n ? sD : (sD = new Float32Array(n)));
const windowSumRecips = /* @__PURE__ */ new Map();
function getWindowSumRecip(numFrames, fftSize, hopSize, outputLength) {
  const key = `${numFrames}/${fftSize}/${hopSize}/${outputLength}`;
  const hit = windowSumRecips.get(key);
  if (hit) return hit;
  const window = getHannWindow(fftSize);
  const windowSum = new Float32Array(outputLength);
  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    for (let i = 0; i < fftSize && start + i < outputLength; i++) {
      windowSum[start + i] = windowSum[start + i] + window[i] * window[i];
    }
  }
  const recip = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    recip[i] = windowSum[i] > 1e-8 ? 1 / windowSum[i] : 0;
  }
  windowSumRecips.set(key, recip);
  return recip;
}
export function istft(specReal, specImag, numFrames, numBins, fftSize, hopSize, length, out) {
  const outputLength = length || (numFrames - 1) * hopSize + fftSize;
  const output = out && out.length === outputLength ? out : new Float32Array(outputLength);
  output.fill(0);
  const window = getHannWindow(fftSize);
  const scale = Math.sqrt(fftSize);
  const fullReal = scratchA(fftSize);
  const fullImag = scratchB(fftSize);
  const outReal = scratchC(fftSize);
  const outImag = scratchD(fftSize);
  for (let frame = 0; frame < numFrames; frame++) {
    fullReal.fill(0);
    fullImag.fill(0);
    const rowOffset = frame * numBins;
    for (let k = 0; k < numBins; k++) {
      fullReal[k] = specReal[rowOffset + k];
      fullImag[k] = specImag[rowOffset + k];
    }
    for (let k = 1; k < numBins - 1; k++) {
      fullReal[fftSize - k] = fullReal[k];
      fullImag[fftSize - k] = -fullImag[k];
    }
    ifft(outReal, outImag, fullReal, fullImag, fftSize);
    const start = frame * hopSize;
    for (let i = 0; i < fftSize && start + i < outputLength; i++) {
      output[start + i] = output[start + i] + outReal[i] * window[i] * scale;
    }
  }
  const recip = getWindowSumRecip(numFrames, fftSize, hopSize, outputLength);
  for (let i = 0; i < outputLength; i++) {
    output[i] = output[i] * recip[i];
  }
  return output;
}
export function reflectPad(signal, padLeft, padRight, out) {
  const length = signal.length;
  const total = padLeft + length + padRight;
  const output = out && out.length === total ? out : new Float32Array(total);
  for (let i = 0; i < padLeft; i++) {
    const srcIdx = Math.min(padLeft - i, length - 1);
    output[i] = signal[srcIdx];
  }
  output.set(signal, padLeft);
  for (let i = 0; i < padRight; i++) {
    const srcIdx = Math.max(0, length - 2 - i);
    output[padLeft + length + i] = signal[srcIdx];
  }
  return output;
}
