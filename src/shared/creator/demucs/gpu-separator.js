/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
import { CONSTANTS } from './constants.js';
import { GpuStemsDsp, GPU_GEOMETRY } from './gpu-dsp.js';
import { segmentStarts } from './segments.js';
const { TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, TRACKS } = CONSTANTS;
const { PLANE } = GPU_GEOMETRY;
export class GpuSeparator {
  ort;
  onLog;
  onProgress;
  extraSessionOptions;
  session = null;
  captured = false;
  device;
  dsp;
  freqBuf;
  timeBuf;
  feeds;
  fetches;
  modelBuffer;
  baseSessionOptions;
  constructor(opts) {
    this.ort = opts.ort;
    this.onLog = opts.onLog ?? (() => {});
    this.onProgress = opts.onProgress;
    this.extraSessionOptions = opts.sessionOptions ?? {};
  }
  /** Create the session (capture if possible), grab ORT's device, build the kernels. */
  async init(modelBuffer) {
    this.modelBuffer = modelBuffer;
    const base = {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all',
      preferredOutputLocation: 'gpu-buffer',
      ...this.extraSessionOptions,
    };
    this.baseSessionOptions = base;
    if (this.extraSessionOptions['enableGraphCapture'] === true) {
      try {
        this.session = await this.ort.InferenceSession.create(modelBuffer, {
          ...base,
          enableGraphCapture: true,
        });
        this.captured = true;
      } catch (e) {
        this.onLog(
          'gpu',
          `graph capture unavailable (${String(e).slice(0, 200)}) \u2014 running uncaptured`
        );
      }
    }
    if (!this.session) {
      this.session = await this.ort.InferenceSession.create(modelBuffer, base);
      this.captured = false;
    }
    const device = this.ort.env.webgpu?.device;
    if (!device) throw new Error('ORT exposed no WebGPU device after session init');
    this.device = device;
    this.dsp = new GpuStemsDsp(device);
    const outUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.freqBuf = device.createBuffer({
      size: 16 * PLANE * 4,
      usage: outUsage,
      label: 'model-freq-out',
    });
    this.timeBuf = device.createBuffer({
      size: 8 * TRAINING_SAMPLES * 4,
      usage: outUsage,
      label: 'model-time-out',
    });
    this.buildIo();
    this.onLog('gpu', `full-GPU pipeline ready (graph capture: ${this.captured ? 'ON' : 'off'})`);
  }
  /** (Re)build the GPU-buffer tensors for the current session. Buffers are stable. */
  buildIo() {
    const session = this.session;
    const t = this.ort.Tensor;
    const waveTensor = t.fromGpuBuffer(this.dsp.waveformBuffer, {
      dataType: 'float32',
      dims: [1, 2, TRAINING_SAMPLES],
    });
    const specTensor = t.fromGpuBuffer(this.dsp.magSpecBuffer, {
      dataType: 'float32',
      dims: [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES],
    });
    const freqTensor = t.fromGpuBuffer(this.freqBuf, {
      dataType: 'float32',
      dims: [1, 4, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES],
    });
    const timeTensor = t.fromGpuBuffer(this.timeBuf, {
      dataType: 'float32',
      dims: [1, 4, 2, TRAINING_SAMPLES],
    });
    this.feeds = {
      [session.inputNames[0]]: waveTensor,
      ...(session.inputNames.length > 1 ? { [session.inputNames[1]]: specTensor } : {}),
    };
    const names = [...session.outputNames];
    const freqName = names.includes('output') ? 'output' : names[0];
    const timeName = names.includes('add_67') ? 'add_67' : names[1];
    this.fetches = { [freqName]: freqTensor, [timeName]: timeTensor };
  }
  /**
   * ORT's WebGPU graph-capture REPLAY can fail on graphs this size even when
   * the capturing run succeeded (an internal bind group re-created against a
   * freed buffer). Recreate the session uncaptured - same device, so all our
   * buffers and bind groups stay valid - and carry on fully on the GPU.
   */
  async recreateWithoutCapture() {
    const old = this.session;
    this.session = await this.ort.InferenceSession.create(
      this.modelBuffer,
      this.baseSessionOptions
    );
    void old?.release?.().catch(() => {});
    this.captured = false;
    this.buildIo();
  }
  /** Read one whole-track accumulator back to the CPU. */
  async readback(buf, floats) {
    const staging = this.device.createBuffer({
      size: floats * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(buf, 0, staging, 0, floats * 4);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }
  async separate(left, right) {
    const session = this.session;
    if (!session) throw new Error('GpuSeparator not initialized');
    const totalSamples = left.length;
    const accBytes = totalSamples * 4;
    const limit = this.device.limits.maxStorageBufferBindingSize;
    if (accBytes > limit) {
      throw new Error(
        `track too long for the GPU path (${accBytes} > maxStorageBufferBindingSize ${limit})`
      );
    }
    const starts = segmentStarts(totalSamples);
    const totalSegments = starts.length;
    const accUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    const accs = TRACKS.map((_, t) =>
      [0, 1].map((c) =>
        this.device.createBuffer({ size: accBytes, usage: accUsage, label: `acc-${t}-${c}` })
      )
    );
    const weights = this.device.createBuffer({ size: accBytes, usage: accUsage, label: 'weights' });
    const binds = this.dsp.makeTrackBinds(this.freqBuf, this.timeBuf, accs, weights);
    const short = totalSamples < TRAINING_SAMPLES;
    const padL = short ? new Float32Array(TRAINING_SAMPLES) : null;
    const padR = short ? new Float32Array(TRAINING_SAMPLES) : null;
    try {
      for (let n = 0; n < totalSegments; n++) {
        const start = starts[n];
        const segmentLength = Math.min(start + TRAINING_SAMPLES, totalSamples) - start;
        if (short) {
          padL.set(left.subarray(start, start + segmentLength));
          padR.set(right.subarray(start, start + segmentLength));
          this.dsp.writeSegment(padL, padR);
        } else {
          this.dsp.writeSegment(
            left.subarray(start, start + TRAINING_SAMPLES),
            right.subarray(start, start + TRAINING_SAMPLES)
          );
        }
        const pre = this.device.createCommandEncoder({ label: `stft-${n}` });
        this.dsp.encodeStft(pre, 0);
        this.dsp.encodeStft(pre, 1);
        this.device.queue.submit([pre.finish()]);
        try {
          await this.session.run(this.feeds, this.fetches);
        } catch (e) {
          if (!this.captured) throw e;
          this.onLog(
            'gpu',
            `graph-capture replay failed (${String(e).slice(0, 160)}) \u2014 recreating session uncaptured`
          );
          await this.recreateWithoutCapture();
          await this.session.run(this.feeds, this.fetches);
        }
        const post = this.device.createCommandEncoder({ label: `post-${n}` });
        this.dsp.encodePost(post, binds, {
          start,
          copyLen: segmentLength,
          segmentLength,
          totalSamples,
        });
        this.device.queue.submit([post.finish()]);
        this.onProgress?.({
          progress: (n + 1) / totalSegments,
          currentSegment: n + 1,
          totalSegments,
        });
      }
      const norm = this.device.createCommandEncoder({ label: 'normalize' });
      for (const pair of accs)
        for (const acc of pair) this.dsp.encodeNormalize(norm, acc, weights, totalSamples);
      this.device.queue.submit([norm.finish()]);
      const out = {};
      for (let t = 0; t < TRACKS.length; t++) {
        out[TRACKS[t]] = {
          left: await this.readback(accs[t][0], totalSamples),
          right: await this.readback(accs[t][1], totalSamples),
        };
      }
      return out;
    } finally {
      for (const pair of accs) for (const acc of pair) acc.destroy();
      weights.destroy();
    }
  }
}
