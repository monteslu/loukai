/* Ported from mochamix packages/dsp-wasm/src/stemsdsp.ts (annotated TypeScript source,
 * keep in sync). WASM+SIMD KissFFT STFT/iSTFT + polyphase 16k downmix for Whisper. */
import { stemsdspWasmBase64 } from './stemsdsp-wasm.js';
import { base64ToBytes } from './base64.js';
export class WasmStemsDsp {
  ex;
  sigPtr = 0;
  sigCap = 0;
  stftRealPtr = 0;
  stftImagPtr = 0;
  stftCap = 0;
  ispecRealPtr = 0;
  ispecImagPtr = 0;
  ispecCap = 0;
  outPtr = 0;
  outCap = 0;
  constructor() {
    const bytes = base64ToBytes(stemsdspWasmBase64);
    const module = new WebAssembly.Module(bytes);
    const noop = () => 0;
    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: {
        fd_write: noop,
        fd_close: noop,
        fd_seek: noop,
        fd_read: noop,
        proc_exit: () => {},
        environ_get: noop,
        environ_sizes_get: noop,
      },
    });
    this.ex = instance.exports;
    this.ex._initialize?.();
  }
  heapF32() {
    return new Float32Array(this.ex.memory.buffer);
  }
  ensure(ptrField, capField, floats) {
    if (floats <= this[capField]) return;
    if (this[ptrField]) this.ex.free(this[ptrField]);
    this[ptrField] = this.ex.malloc(floats * 4);
    if (!this[ptrField]) throw new Error(`stemsdsp: out of WASM memory (${floats * 4} bytes)`);
    this[capField] = floats;
  }
  ensurePair(which, floats) {
    const capField = which === 'stft' ? 'stftCap' : 'ispecCap';
    if (floats > this[capField]) {
      const rField = which === 'stft' ? 'stftRealPtr' : 'ispecRealPtr';
      const iField = which === 'stft' ? 'stftImagPtr' : 'ispecImagPtr';
      if (this[rField]) {
        this.ex.free(this[rField]);
        this.ex.free(this[iField]);
      }
      this[rField] = this.ex.malloc(floats * 4);
      this[iField] = this.ex.malloc(floats * 4);
      if (!this[rField] || !this[iField]) throw new Error('stemsdsp: out of WASM memory');
      this[capField] = floats;
    }
    return which === 'stft'
      ? { real: this.stftRealPtr, imag: this.stftImagPtr }
      : { real: this.ispecRealPtr, imag: this.ispecImagPtr };
  }
  /**
   * Forward STFT (Hann, 1/sqrt(n)). Returns heap views over the frame-major
   * spectra - read them before the next call.
   */
  stft(signal, fftSize, hop) {
    const numFrames = Math.floor((signal.length - fftSize) / hop) + 1;
    const numBins = fftSize / 2 + 1;
    this.ensure('sigPtr', 'sigCap', signal.length);
    const spec = this.ensurePair('stft', numFrames * numBins);
    const heap = this.heapF32();
    heap.set(signal, this.sigPtr / 4);
    const rc = this.ex.stems_stft(this.sigPtr, signal.length, fftSize, hop, spec.real, spec.imag);
    if (rc < 0) throw new Error('stemsdsp: stems_stft failed');
    return {
      real: heap.subarray(spec.real / 4, spec.real / 4 + numFrames * numBins),
      imag: heap.subarray(spec.imag / 4, spec.imag / 4 + numFrames * numBins),
      numFrames,
      numBins,
    };
  }
  /**
   * Writable heap views for the iSTFT input spectra (frame-major). The caller
   * fills these (e.g. transposing the model's frequency output) then calls
   * istft() with the same geometry.
   */
  ispecViews(numFrames, numBins) {
    const spec = this.ensurePair('ispec', numFrames * numBins);
    const heap = this.heapF32();
    return {
      real: heap.subarray(spec.real / 4, spec.real / 4 + numFrames * numBins),
      imag: heap.subarray(spec.imag / 4, spec.imag / 4 + numFrames * numBins),
    };
  }
  // Downmix/decimate scratch (separate from the STFT buffers).
  dmLeftPtr = 0;
  dmRightPtr = 0;
  dmCap = 0;
  dmOutPtr = 0;
  dmOutCap = 0;
  /**
   * Stereo → mono 16kHz (Whisper input) via the C polyphase windowed-sinc
   * decimator. Returns a FRESH Float32Array (not a heap view). Throws when the
   * rate has no small rational relation to 16k (caller falls back to JS).
   */
  downmixTo16k(left, right, sampleRate) {
    if (!Number.isInteger(sampleRate)) throw new Error('stemsdsp: non-integer rate');
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(sampleRate, 16e3);
    const rateNum = sampleRate / g;
    const rateDen = 16e3 / g;
    const n = left.length;
    const outLen = Math.floor(n / (sampleRate / 16e3)) + 1;
    if (n > this.dmCap) {
      if (this.dmLeftPtr) {
        this.ex.free(this.dmLeftPtr);
        this.ex.free(this.dmRightPtr);
      }
      this.dmLeftPtr = this.ex.malloc(n * 4);
      this.dmRightPtr = this.ex.malloc(n * 4);
      if (!this.dmLeftPtr || !this.dmRightPtr) throw new Error('stemsdsp: out of WASM memory');
      this.dmCap = n;
    }
    if (outLen > this.dmOutCap) {
      if (this.dmOutPtr) this.ex.free(this.dmOutPtr);
      this.dmOutPtr = this.ex.malloc(outLen * 4);
      if (!this.dmOutPtr) throw new Error('stemsdsp: out of WASM memory');
      this.dmOutCap = outLen;
    }
    const heap = this.heapF32();
    heap.set(left, this.dmLeftPtr / 4);
    heap.set(right, this.dmRightPtr / 4);
    const produced = this.ex.stems_downmix16k(
      this.dmLeftPtr,
      this.dmRightPtr,
      n,
      rateNum,
      rateDen,
      this.dmOutPtr,
      outLen
    );
    if (produced < 0) throw new Error('stemsdsp: unsupported rate for polyphase decimation');
    return new Float32Array(
      this.heapF32().subarray(this.dmOutPtr / 4, this.dmOutPtr / 4 + produced)
    );
  }
  /**
   * Inverse STFT over the spectra written via ispecViews(). numBins must be
   * fftSize/2+1. Returns a heap view of the output - read before the next call.
   */
  istft(numFrames, numBins, fftSize, hop, outLen) {
    if (this.ispecCap < numFrames * numBins) throw new Error('stemsdsp: call ispecViews() first');
    this.ensure('outPtr', 'outCap', outLen);
    const rc = this.ex.stems_istft(
      this.ispecRealPtr,
      this.ispecImagPtr,
      numFrames,
      numBins,
      fftSize,
      hop,
      outLen,
      this.outPtr
    );
    if (rc < 0) throw new Error('stemsdsp: stems_istft failed (numBins must be fftSize/2+1)');
    return this.heapF32().subarray(this.outPtr / 4, this.outPtr / 4 + outLen);
  }
}
