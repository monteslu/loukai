/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
import { WasmStemsDsp } from './stemsdsp.js';
import { CONSTANTS } from './constants.js';
import { stft, istft, reflectPad } from './fft.js';
import { segmentStarts } from './segments.js';
import { GpuSeparator } from './gpu-separator.js';
const {
  FFT_SIZE,
  HOP_SIZE,
  TRAINING_SAMPLES,
  MODEL_SPEC_BINS,
  MODEL_SPEC_FRAMES,
  SEGMENT_OVERLAP,
  TRACKS,
} = CONSTANTS;
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
class JsStemsDsp {
  spec;
  ispecReal = new Float32Array(0);
  ispecImag = new Float32Array(0);
  out = new Float32Array(0);
  stft(signal, fftSize, hop) {
    this.spec = stft(signal, fftSize, hop, this.spec);
    return this.spec;
  }
  ispecViews(numFrames, numBins) {
    const n = numFrames * numBins;
    if (this.ispecReal.length !== n) {
      this.ispecReal = new Float32Array(n);
      this.ispecImag = new Float32Array(n);
    }
    return { real: this.ispecReal, imag: this.ispecImag };
  }
  istft(numFrames, numBins, fftSize, hop, outLen) {
    if (this.out.length !== outLen) this.out = new Float32Array(outLen);
    return istft(
      this.ispecReal,
      this.ispecImag,
      numFrames,
      numBins,
      fftSize,
      hop,
      outLen,
      this.out
    );
  }
}
export { segmentStarts } from './segments.js';
const yieldToLoop = (() => {
  if (typeof MessageChannel === 'undefined') {
    return () => new Promise((r) => setTimeout(r, 0));
  }
  const channel = new MessageChannel();
  let pending = null;
  channel.port1.onmessage = () => {
    const r = pending;
    pending = null;
    r?.();
  };
  return () =>
    new Promise((r) => {
      pending = r;
      channel.port2.postMessage(null);
    });
})();
function makeInputScratch() {
  return {
    segLeft: new Float32Array(TRAINING_SAMPLES),
    segRight: new Float32Array(TRAINING_SAMPLES),
    stftInput: new Float32Array(STFT_INPUT_LEN),
    centered: new Float32Array(CENTERED_LEN),
    spec: void 0,
    magSpec: new Float32Array(4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES),
    waveform: new Float32Array(2 * TRAINING_SAMPLES),
  };
}
export class DemucsProcessor {
  ort;
  sessionOptions;
  onProgress;
  onLog;
  pipeline;
  dspMode;
  cpuDsp = null;
  gpu = null;
  modelBuffer = null;
  session = null;
  inputs = null;
  constructor(options) {
    this.ort = options.ort;
    this.sessionOptions = options.sessionOptions ?? {};
    this.onProgress = options.onProgress ?? (() => {});
    this.onLog = options.onLog ?? (() => {});
    this.pipeline = options.pipeline ?? true;
    const gpuAvailable = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
    this.dspMode = options.dsp ?? (gpuAvailable ? 'webgpu' : 'wasm');
  }
  makeCpuDsp() {
    if (this.cpuDsp) return this.cpuDsp;
    if (this.dspMode === 'js') {
      this.cpuDsp = new JsStemsDsp();
    } else {
      try {
        this.cpuDsp = new WasmStemsDsp();
      } catch (e) {
        this.onLog(
          'dsp',
          `WASM stems DSP unavailable (${String(e)}) \u2014 falling back to JS FFT`
        );
        this.cpuDsp = new JsStemsDsp();
      }
    }
    return this.cpuDsp;
  }
  async loadCpuSession(modelBuffer) {
    this.session = await this.ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all',
      ...this.sessionOptions,
    });
    return this.session;
  }
  async loadModel(modelBuffer) {
    this.onLog('model', 'Loading model...');
    this.modelBuffer = modelBuffer;
    // The full-GPU path only makes sense when the session itself targets the
    // webgpu EP (createKaraoke passes ['wasm'] when the user picks the wasm EP).
    const eps = this.sessionOptions['executionProviders'];
    const wantsWebGpuEp =
      !Array.isArray(eps) || eps.some((e) => e === 'webgpu' || e?.name === 'webgpu');
    if (this.dspMode === 'webgpu' && wantsWebGpuEp) {
      try {
        const gpu = new GpuSeparator({
          ort: this.ort,
          sessionOptions: this.sessionOptions,
          onLog: this.onLog,
          onProgress: this.onProgress,
        });
        await gpu.init(modelBuffer);
        this.gpu = gpu;
        this.session = gpu.session;
        this.onLog('model', 'Model loaded successfully (full-GPU path)');
        return this.session;
      } catch (e) {
        this.onLog(
          'gpu',
          `full-GPU path unavailable (${String(e).slice(0, 300)}) \u2014 using WASM DSP path`
        );
        this.gpu = null;
        this.dspMode = 'wasm';
      }
    }
    const session = await this.loadCpuSession(modelBuffer);
    this.onLog('model', 'Model loaded successfully');
    return session;
  }
  /**
   * Build the model's two inputs for the segment starting at `start`, into
   * scratch slot `slot`. Returns the feeds for session.run.
   */
  prepareSegment(left, right, start, slot, session) {
    const end = Math.min(start + TRAINING_SAMPLES, left.length);
    const segmentLength = end - start;
    slot.segLeft.fill(0);
    slot.segRight.fill(0);
    slot.segLeft.set(left.subarray(start, start + segmentLength));
    slot.segRight.set(right.subarray(start, start + segmentLength));
    const channelSpecToMag = (seg, channelBase) => {
      reflectPad(seg, STFT_PAD, STFT_PAD_RIGHT, slot.stftInput);
      reflectPad(slot.stftInput, CENTER_PAD, CENTER_PAD, slot.centered);
      const spec = this.dsp.stft(slot.centered, FFT_SIZE, HOP_SIZE);
      const realBase = channelBase * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;
      const imagBase = (channelBase + 1) * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;
      for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
        const srcRow = (f + 2) * spec.numBins;
        for (let b = 0; b < MODEL_SPEC_BINS; b++) {
          slot.magSpec[realBase + b * MODEL_SPEC_FRAMES + f] = spec.real[srcRow + b];
          slot.magSpec[imagBase + b * MODEL_SPEC_FRAMES + f] = spec.imag[srcRow + b];
        }
      }
    };
    channelSpecToMag(slot.segLeft, 0);
    channelSpecToMag(slot.segRight, 2);
    slot.waveform.set(slot.segLeft, 0);
    slot.waveform.set(slot.segRight, TRAINING_SAMPLES);
    const feeds = {};
    feeds[session.inputNames[0]] = new this.ort.Tensor('float32', slot.waveform, [
      1,
      2,
      TRAINING_SAMPLES,
    ]);
    if (session.inputNames.length > 1) {
      feeds[session.inputNames[1]] = new this.ort.Tensor('float32', slot.magSpec, [
        1,
        4,
        MODEL_SPEC_BINS,
        MODEL_SPEC_FRAMES,
      ]);
    }
    return feeds;
  }
  /**
   * iSTFT one channel of one track's frequency output, straight from the model
   * tensor (fused mask + ispec: no intermediate per-track spectrograms).
   * channelBase selects [t][channelBase]=real / [t][channelBase+1]=imag planes.
   */
  freqChannelToTime(freqData, track, channelBase) {
    const plane = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;
    const realBase = (track * 4 + channelBase) * plane;
    const imagBase = (track * 4 + channelBase + 1) * plane;
    const { real, imag } = this.dsp.ispecViews(PADDED_FRAMES, PADDED_BINS);
    real.fill(0);
    imag.fill(0);
    for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
      const dstRow = (f + 2) * PADDED_BINS;
      for (let b = 0; b < MODEL_SPEC_BINS; b++) {
        real[dstRow + b] = freqData[realBase + b * MODEL_SPEC_FRAMES + f];
        imag[dstRow + b] = freqData[imagBase + b * MODEL_SPEC_FRAMES + f];
      }
    }
    return this.dsp.istft(PADDED_FRAMES, PADDED_BINS, FFT_SIZE, HOP_SIZE, ISTFT_LEN);
  }
  /** CPU-path DSP backend, created lazily (GPU path never touches it). */
  get dsp() {
    return this.makeCpuDsp();
  }
  async separate(leftChannel, rightChannel) {
    if (this.gpu) {
      try {
        return await this.gpu.separate(leftChannel, rightChannel);
      } catch (e) {
        this.onLog(
          'gpu',
          `GPU separation failed (${String(e).slice(0, 300)}) \u2014 falling back to WASM DSP`
        );
        void this.gpu.session?.release?.().catch(() => {});
        this.gpu = null;
        this.dspMode = 'wasm';
        if (!this.modelBuffer) throw e;
        await this.loadCpuSession(this.modelBuffer);
      }
    }
    const session = this.session;
    if (!session) throw new Error('Model not loaded. Call loadModel() first.');
    const totalSamples = leftChannel.length;
    const stride = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
    const starts = segmentStarts(totalSamples);
    const totalSegments = starts.length;
    const outputs = TRACKS.map(() => ({
      left: new Float32Array(totalSamples),
      right: new Float32Array(totalSamples),
    }));
    const weights = new Float32Array(totalSamples);
    if (!this.inputs) this.inputs = [makeInputScratch(), makeInputScratch()];
    let overlapWindow = new Float32Array(0);
    const getOverlapWindow = (segmentLength) => {
      if (overlapWindow.length === segmentLength) return overlapWindow;
      overlapWindow = new Float32Array(segmentLength);
      for (let i = 0; i < segmentLength; i++) {
        const fadeIn = Math.min(i / (stride * 0.5), 1);
        const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
        overlapWindow[i] = Math.min(fadeIn, fadeOut);
      }
      return overlapWindow;
    };
    const postProcess = async (start, results) => {
      let timeData = null;
      let timeShape = null;
      let freqData = null;
      for (const name of session.outputNames) {
        const tensor = results[name];
        if (!tensor) continue;
        if (tensor.dims.length === 4 && tensor.dims[2] === 2) {
          timeData = tensor.data;
          timeShape = tensor.dims;
        } else if (tensor.dims.length === 5 && tensor.dims[2] === 4) {
          freqData = tensor.data;
        }
      }
      if (!timeData || !timeShape) throw new Error('Could not find time-domain output tensor');
      const numChannels = timeShape[2];
      const samples = timeShape[3];
      const segmentLength = Math.min(start + TRAINING_SAMPLES, totalSamples) - start;
      const window = getOverlapWindow(segmentLength);
      const copyLen = Math.min(segmentLength, samples, totalSamples - start);
      for (let t = 0; t < TRACKS.length; t++) {
        const timeBase = t * numChannels * samples;
        const out = outputs[t];
        if (freqData) {
          const freqLeft = this.freqChannelToTime(freqData, t, 0);
          for (let i = 0; i < copyLen; i++) {
            const v = timeData[timeBase + i] + (freqLeft[ISTFT_OFFSET + i] ?? 0);
            out.left[start + i] = out.left[start + i] + v * window[i];
          }
          const freqRight = this.freqChannelToTime(freqData, t, 2);
          for (let i = 0; i < copyLen; i++) {
            const v = timeData[timeBase + samples + i] + (freqRight[ISTFT_OFFSET + i] ?? 0);
            out.right[start + i] = out.right[start + i] + v * window[i];
          }
        } else {
          for (let i = 0; i < copyLen; i++) {
            out.left[start + i] = out.left[start + i] + timeData[timeBase + i] * window[i];
            out.right[start + i] =
              out.right[start + i] + timeData[timeBase + samples + i] * window[i];
          }
        }
        if (this.pipeline) await yieldToLoop();
      }
      for (let i = 0; i < copyLen; i++) {
        weights[start + i] = weights[start + i] + window[i];
      }
    };
    if (this.pipeline) {
      let feeds = this.prepareSegment(
        leftChannel,
        rightChannel,
        starts[0],
        this.inputs[0],
        session
      );
      let inFlight = session.run(feeds);
      for (let n = 0; n < totalSegments; n++) {
        if (n + 1 < totalSegments) {
          feeds = this.prepareSegment(
            leftChannel,
            rightChannel,
            starts[n + 1],
            this.inputs[(n + 1) % 2],
            session
          );
          await yieldToLoop();
        }
        const results = await inFlight;
        if (n + 1 < totalSegments) inFlight = session.run(feeds);
        await postProcess(starts[n], results);
        this.onProgress({
          progress: (n + 1) / totalSegments,
          currentSegment: n + 1,
          totalSegments,
        });
      }
    } else {
      for (let n = 0; n < totalSegments; n++) {
        const feeds = this.prepareSegment(
          leftChannel,
          rightChannel,
          starts[n],
          this.inputs[n % 2],
          session
        );
        const results = await session.run(feeds);
        await postProcess(starts[n], results);
        this.onProgress({
          progress: (n + 1) / totalSegments,
          currentSegment: n + 1,
          totalSegments,
        });
      }
    }
    for (const out of outputs) {
      for (let i = 0; i < totalSamples; i++) {
        const w = weights[i];
        if (w > 0) {
          out.left[i] = out.left[i] / w;
          out.right[i] = out.right[i] / w;
        }
      }
    }
    return {
      drums: outputs[0],
      bass: outputs[1],
      other: outputs[2],
      vocals: outputs[3],
    };
  }
}
