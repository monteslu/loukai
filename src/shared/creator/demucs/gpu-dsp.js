/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
import { CONSTANTS } from './constants.js';
const { FFT_SIZE, HOP_SIZE, TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES } = CONSTANTS;
const STFT_PAD = Math.floor(HOP_SIZE / 2) * 3;
const STFT_LE = Math.ceil(TRAINING_SAMPLES / HOP_SIZE);
const STFT_PAD_RIGHT = STFT_PAD + STFT_LE * HOP_SIZE - TRAINING_SAMPLES;
const STFT_INPUT_LEN = STFT_PAD + TRAINING_SAMPLES + STFT_PAD_RIGHT;
const CENTER_PAD = FFT_SIZE / 2;
const CENTERED_LEN = STFT_INPUT_LEN + 2 * CENTER_PAD;
const TOTAL_FRAMES = Math.floor((CENTERED_LEN - FFT_SIZE) / HOP_SIZE) + 1;
const PADDED_FRAMES = MODEL_SPEC_FRAMES + 4;
const PADDED_BINS = MODEL_SPEC_BINS + 1;
const ISTFT_LEN = (PADDED_FRAMES - 1) * HOP_SIZE + FFT_SIZE;
const ISTFT_OFFSET = CENTER_PAD + STFT_PAD;
const N2 = FFT_SIZE / 2;
const PLANE = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;
const WG = 256;
const PER_THREAD = N2 / WG;
const COMMON =
  /* wgsl */
  `
fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
fn conj2(a: vec2f) -> vec2f { return vec2f(a.x, -a.y); }
`;
const PAD_WGSL =
  /* wgsl */
  `
struct PadParams { padLeft: u32, srcLen: u32, outLen: u32, srcOffset: u32 }
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> p: PadParams;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.outLen) { return; }
  var s: i32;
  let li = i32(i) - i32(p.padLeft);
  if (li < 0) {
    s = min(i32(p.padLeft) - i32(i), i32(p.srcLen) - 1);
  } else if (li < i32(p.srcLen)) {
    s = li;
  } else {
    s = max(0, i32(p.srcLen) - 2 - (li - i32(p.srcLen)));
  }
  // srcOffset instead of a bind-group buffer offset: the right channel starts at
  // TRAINING_SAMPLES*4 bytes, which doesn't meet the 256-byte binding alignment.
  dst[i] = src[p.srcOffset + u32(s)];
}
`;
const STFT_WGSL =
  /* wgsl */
  `
${COMMON}
struct StftParams { channelBase: u32, _a: u32, _b: u32, _c: u32 }
@group(0) @binding(0) var<storage, read> padded: array<f32>;     // CENTERED_LEN samples
@group(0) @binding(1) var<storage, read> hann: array<f32>;       // FFT_SIZE
@group(0) @binding(2) var<storage, read> twiddle: array<vec2f>;  // [0,1024): fft2048; [1024,3073): untangle e^-2pik/4096, k=0..2048
@group(0) @binding(3) var<storage, read_write> magSpec: array<f32>; // 4 * PLANE
@group(0) @binding(4) var<uniform> p: StftParams;

var<workgroup> buf: array<vec2f, ${N2}>;

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let frame = wg.x;
  let base = frame * ${HOP_SIZE}u;
  // Bit-reversed windowed packed load: buf[i] = (x[2r]\xB7w[2r], x[2r+1]\xB7w[2r+1]), r = rev11(i).
  for (var t = 0u; t < ${PER_THREAD}u; t++) {
    let i = li.x + t * ${WG}u;
    let r = reverseBits(i) >> ${32 - Math.log2(N2)}u;
    let s = base + r * 2u;
    buf[i] = vec2f(padded[s] * hann[r * 2u], padded[s + 1u] * hann[r * 2u + 1u]);
  }
  workgroupBarrier();
  // Radix-2 DIT butterflies.
  var size = 2u;
  while (size <= ${N2}u) {
    let half = size >> 1u;
    let step = ${N2}u / size;
    for (var t = 0u; t < ${PER_THREAD / 2}u; t++) {
      let bi = li.x + t * ${WG}u; // butterfly index 0..N2/2-1
      let grp = bi / half;
      let j = bi % half;
      let i1 = grp * size + j;
      let i2 = i1 + half;
      let w = twiddle[j * step];
      let e = buf[i1];
      let o = cmul(buf[i2], w);
      buf[i1] = e + o;
      buf[i2] = e - o;
    }
    workgroupBarrier();
    size = size << 1u;
  }
  // Untangle Z (2048-pt FFT of packed) into real-FFT bins X[0..2047] and write
  // into the model layout. X[k] = (S + w4096[k]\xB7D)/2, S = Z[k]+conj(Z[-k]),
  // D = -i\xB7(Z[k]-conj(Z[-k])). Scale 1/sqrt(4096).
  let outFrame = i32(frame) - 2;
  if (outFrame < 0 || outFrame >= ${MODEL_SPEC_FRAMES}) { return; }
  for (var t = 0u; t < ${PER_THREAD}u; t++) {
    let k = li.x + t * ${WG}u; // 0..2047
    let zk = buf[k];
    let zn = buf[(${N2}u - k) % ${N2}u];
    let s = zk + conj2(zn);
    let d = zk - conj2(zn);
    let dm = vec2f(d.y, -d.x); // -i\xB7d
    let x = (s + cmul(twiddle[${N2 / 2}u + k], dm)) * ${(0.5 / Math.sqrt(FFT_SIZE)).toExponential()};
    let o = p.channelBase * ${PLANE}u + k * ${MODEL_SPEC_FRAMES}u + u32(outFrame);
    magSpec[o] = x.x;
    magSpec[o + ${PLANE}u] = x.y;
  }
}
`;
const IFFT_WGSL =
  /* wgsl */
  `
${COMMON}
struct IfftParams { trackChannelBase: u32, _a: u32, _b: u32, _c: u32 } // (track*4 + channelBase)
@group(0) @binding(0) var<storage, read> freq: array<f32>;       // 16 * PLANE (model output)
@group(0) @binding(1) var<storage, read> hann: array<f32>;
@group(0) @binding(2) var<storage, read> twiddle: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> frames: array<f32>; // PADDED_FRAMES * FFT_SIZE
@group(0) @binding(4) var<uniform> p: IfftParams;

var<workgroup> buf: array<vec2f, ${N2}>;

fn readBin(plane: u32, k: u32, outFrame: i32) -> f32 {
  if (outFrame < 0 || outFrame >= ${MODEL_SPEC_FRAMES} || k >= ${MODEL_SPEC_BINS}u) { return 0.0; }
  return freq[plane * ${PLANE}u + k * ${MODEL_SPEC_FRAMES}u + u32(outFrame)];
}

@compute @workgroup_size(${WG})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let frame = wg.x;
  let outFrame = i32(frame) - 2;
  let rp = p.trackChannelBase;
  let ip = p.trackChannelBase + 1u;
  // Entangle: Z[k] = (A + i\xB7D)/2, A = X[k]+conj(X[N2-k]), D = conj(w4096[k])\xB7(X[k]-conj(X[N2-k])).
  for (var t = 0u; t < ${PER_THREAD}u; t++) {
    let k = li.x + t * ${WG}u; // 0..2047
    let xk = vec2f(readBin(rp, k, outFrame), readBin(ip, k, outFrame));
    let kn = ${N2}u - k; // 1..2048 (bin 2048 reads 0 \u2014 model crops Nyquist)
    let xn = vec2f(readBin(rp, kn, outFrame), readBin(ip, kn, outFrame));
    let a = xk + conj2(xn);
    let b = xk - conj2(xn);
    let d = cmul(conj2(twiddle[${N2 / 2}u + k]), b);
    let id = vec2f(-d.y, d.x); // i\xB7d
    buf[k] = (a + id) * 0.5;
  }
  workgroupBarrier();
  // Radix-2 DIF with conjugate twiddles: natural input, bit-reversed output.
  var size = ${N2}u;
  while (size >= 2u) {
    let half = size >> 1u;
    let step = ${N2}u / size;
    for (var t = 0u; t < ${PER_THREAD / 2}u; t++) {
      let bi = li.x + t * ${WG}u;
      let grp = bi / half;
      let j = bi % half;
      let i1 = grp * size + j;
      let i2 = i1 + half;
      let a = buf[i1];
      let b = buf[i2];
      buf[i1] = a + b;
      buf[i2] = cmul(a - b, conj2(twiddle[j * step]));
    }
    workgroupBarrier();
    size = size >> 1u;
  }
  // Unpack z[n] = buf[rev(n)]. Our DIF inverse is unnormalized (2048\xB7true
  // inverse); the reference applies window\xB7sqrt(4096)/4096 to kiss_fftri output
  // (which is 4096\xB7true inverse). Net factor here: window\xB7(64/2048) = window/32.
  for (var t = 0u; t < ${PER_THREAD}u; t++) {
    let n = li.x + t * ${WG}u; // 0..2047
    let r = reverseBits(n) >> ${32 - Math.log2(N2)}u;
    let z = buf[r];
    let o = frame * ${FFT_SIZE}u + n * 2u;
    frames[o] = z.x * hann[n * 2u] * (1.0 / 32.0);
    frames[o + 1u] = z.y * hann[n * 2u + 1u] * (1.0 / 32.0);
  }
}
`;
const OLA_WGSL =
  /* wgsl */
  `
@group(0) @binding(0) var<storage, read> frames: array<f32>;   // PADDED_FRAMES * FFT_SIZE (pre-windowed+scaled)
@group(0) @binding(1) var<storage, read> recip: array<f32>;    // ISTFT_LEN
@group(0) @binding(2) var<storage, read_write> timeOut: array<f32>; // ISTFT_LEN

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= ${ISTFT_LEN}u) { return; }
  var acc = 0.0;
  let fMax = min(i / ${HOP_SIZE}u, ${PADDED_FRAMES - 1}u);
  var f = select(0u, (i - ${FFT_SIZE - 1}u + ${HOP_SIZE - 1}u) / ${HOP_SIZE}u, i >= ${FFT_SIZE - 1}u);
  for (; f <= fMax; f++) {
    acc += frames[f * ${FFT_SIZE}u + (i - f * ${HOP_SIZE}u)];
  }
  timeOut[i] = acc * recip[i];
}
`;
const COMBINE_WGSL =
  /* wgsl */
  `
struct CombineParams {
  start: u32,          // segment start in the track
  copyLen: u32,        // samples to accumulate
  segmentLength: u32,  // for the fade-out edge
  timeBase: u32,       // offset into timeData for this track/channel plane
  addWeights: u32,     // 1 \u2192 also accumulate weights
  totalSamples: u32,
  _a: u32, _b: u32,
}
@group(0) @binding(0) var<storage, read> timeData: array<f32>;  // model time output (8 planes)
@group(0) @binding(1) var<storage, read> istftTime: array<f32>; // ISTFT_LEN (freq branch, normalized)
@group(0) @binding(2) var<storage, read_write> acc: array<f32>; // totalSamples
@group(0) @binding(3) var<storage, read_write> weights: array<f32>;
@group(0) @binding(4) var<uniform> p: CombineParams;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.copyLen) { return; }
  const halfStride: f32 = ${(Math.floor(TRAINING_SAMPLES * 0.75) * 0.5).toExponential()};
  let fadeIn = min(f32(i) / halfStride, 1.0);
  let fadeOut = min(f32(p.segmentLength - i) / halfStride, 1.0);
  let w = min(fadeIn, fadeOut);
  let v = timeData[p.timeBase + i] + istftTime[${ISTFT_OFFSET}u + i];
  acc[p.start + i] += v * w;
  if (p.addWeights == 1u) {
    weights[p.start + i] += w;
  }
}
`;
const NORM_WGSL =
  /* wgsl */
  `
struct NormParams { totalSamples: u32, _a: u32, _b: u32, _c: u32 }
@group(0) @binding(0) var<storage, read> weights: array<f32>;
@group(0) @binding(1) var<storage, read_write> acc: array<f32>;
@group(0) @binding(2) var<uniform> p: NormParams;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.totalSamples) { return; }
  let w = weights[i];
  if (w > 0.0) { acc[i] = acc[i] / w; }
}
`;
function makePipe(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const pipeline = device.createComputePipeline({
    label,
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  return { pipeline, layout: pipeline.getBindGroupLayout(0) };
}
const wgCount = (n) => Math.ceil(n / WG);
export const GPU_GEOMETRY = {
  FFT_SIZE,
  HOP_SIZE,
  TRAINING_SAMPLES,
  MODEL_SPEC_BINS,
  MODEL_SPEC_FRAMES,
  STFT_PAD,
  STFT_PAD_RIGHT,
  STFT_INPUT_LEN,
  CENTER_PAD,
  CENTERED_LEN,
  TOTAL_FRAMES,
  PADDED_FRAMES,
  PADDED_BINS,
  ISTFT_LEN,
  ISTFT_OFFSET,
  PLANE,
};
export class GpuStemsDsp {
  device;
  pad;
  stft;
  ifft;
  ola;
  combine;
  norm;
  // Static resources (uploaded once).
  hannBuf;
  twiddleBuf;
  recipBuf;
  // Per-segment scratch (fixed geometry).
  segBuf;
  // raw segment, 2 channels planar = waveform model input
  stftInputBuf;
  centeredBuf;
  magSpecBuf;
  // model spec input, 4*PLANE
  framesBuf;
  istftTimeBuf;
  constructor(device) {
    this.device = device;
    this.pad = makePipe(device, PAD_WGSL, 'stems-pad');
    this.stft = makePipe(device, STFT_WGSL, 'stems-stft');
    this.ifft = makePipe(device, IFFT_WGSL, 'stems-ifft');
    this.ola = makePipe(device, OLA_WGSL, 'stems-ola');
    this.combine = makePipe(device, COMBINE_WGSL, 'stems-combine');
    this.norm = makePipe(device, NORM_WGSL, 'stems-normalize');
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const hann = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE));
    this.hannBuf = device.createBuffer({ size: hann.byteLength, usage: storage, label: 'hann' });
    device.queue.writeBuffer(this.hannBuf, 0, hann);
    const tw = new Float32Array((N2 / 2 + PADDED_BINS) * 2);
    for (let k = 0; k < N2 / 2; k++) {
      tw[k * 2] = Math.cos((-2 * Math.PI * k) / N2);
      tw[k * 2 + 1] = Math.sin((-2 * Math.PI * k) / N2);
    }
    for (let k = 0; k < PADDED_BINS; k++) {
      tw[(N2 / 2 + k) * 2] = Math.cos((-2 * Math.PI * k) / FFT_SIZE);
      tw[(N2 / 2 + k) * 2 + 1] = Math.sin((-2 * Math.PI * k) / FFT_SIZE);
    }
    this.twiddleBuf = device.createBuffer({
      size: tw.byteLength,
      usage: storage,
      label: 'twiddle',
    });
    device.queue.writeBuffer(this.twiddleBuf, 0, tw);
    const wsum = new Float32Array(ISTFT_LEN);
    for (let f = 0; f < PADDED_FRAMES; f++) {
      const start = f * HOP_SIZE;
      for (let i = 0; i < FFT_SIZE && start + i < ISTFT_LEN; i++) {
        wsum[start + i] += hann[i] * hann[i];
      }
    }
    const recip = new Float32Array(ISTFT_LEN);
    for (let i = 0; i < ISTFT_LEN; i++) recip[i] = wsum[i] > 1e-8 ? 1 / wsum[i] : 0;
    this.recipBuf = device.createBuffer({
      size: recip.byteLength,
      usage: storage,
      label: 'wsum-recip',
    });
    device.queue.writeBuffer(this.recipBuf, 0, recip);
    const mk = (floats, label, extra = 0) =>
      device.createBuffer({ size: floats * 4, usage: storage | extra, label });
    this.segBuf = mk(2 * TRAINING_SAMPLES, 'segment');
    this.stftInputBuf = mk(STFT_INPUT_LEN, 'stft-input');
    this.centeredBuf = mk(CENTERED_LEN, 'centered');
    this.magSpecBuf = mk(4 * PLANE, 'magspec');
    this.framesBuf = mk(PADDED_FRAMES * FFT_SIZE, 'ifft-frames');
    this.istftTimeBuf = mk(ISTFT_LEN, 'istft-time');
    this.buildStaticBinds();
  }
  /** The two model-input buffers (bind these via ort.Tensor.fromGpuBuffer). */
  get waveformBuffer() {
    return this.segBuf;
  }
  get magSpecBuffer() {
    return this.magSpecBuf;
  }
  // Static bind groups (built once - every buffer they reference is fixed).
  pad1Binds;
  // per channel
  pad2Bind;
  stftBinds;
  olaBind;
  // Reusable per-plane combine uniforms (written each segment).
  combineUniforms;
  staticUniform(data) {
    const buf = this.device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }
  bind(pipe, buffers) {
    for (let i = 0; i < buffers.length; i++) {
      if (!buffers[i])
        throw new Error(`bind: buffer ${i} undefined (pipeline ${pipe.pipeline.label})`);
    }
    return this.device.createBindGroup({
      layout: pipe.layout,
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }
  /** Build the fixed-geometry bind groups. Called once from the constructor. */
  buildStaticBinds() {
    this.pad1Binds = [0, 1].map((c) =>
      this.bind(this.pad, [
        this.segBuf,
        this.stftInputBuf,
        this.staticUniform(
          new Uint32Array([STFT_PAD, TRAINING_SAMPLES, STFT_INPUT_LEN, c * TRAINING_SAMPLES])
        ),
      ])
    );
    this.pad2Bind = this.bind(this.pad, [
      this.stftInputBuf,
      this.centeredBuf,
      this.staticUniform(new Uint32Array([CENTER_PAD, STFT_INPUT_LEN, CENTERED_LEN, 0])),
    ]);
    this.stftBinds = [0, 1].map((c) =>
      this.bind(this.stft, [
        this.centeredBuf,
        this.hannBuf,
        this.twiddleBuf,
        this.magSpecBuf,
        this.staticUniform(new Uint32Array([c * 2, 0, 0, 0])),
      ])
    );
    this.olaBind = this.bind(this.ola, [this.framesBuf, this.recipBuf, this.istftTimeBuf]);
    this.combineUniforms = Array.from({ length: 8 }, () =>
      this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    );
  }
  /** Upload segment samples (planar stereo) into the waveform input buffer. */
  writeSegment(left, right) {
    this.device.queue.writeBuffer(this.segBuf, 0, left);
    this.device.queue.writeBuffer(this.segBuf, TRAINING_SAMPLES * 4, right);
  }
  /** Encode the forward path for one channel: reflect-pad ×2 → STFT into magSpec. */
  encodeStft(encoder, channel) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pad.pipeline);
    pass.setBindGroup(0, this.pad1Binds[channel]);
    pass.dispatchWorkgroups(wgCount(STFT_INPUT_LEN));
    pass.setBindGroup(0, this.pad2Bind);
    pass.dispatchWorkgroups(wgCount(CENTERED_LEN));
    pass.setPipeline(this.stft.pipeline);
    pass.setBindGroup(0, this.stftBinds[channel]);
    pass.dispatchWorkgroups(TOTAL_FRAMES);
    pass.end();
  }
  /**
   * Per-track-load bindings: iFFT/combine reference the (stable, preallocated)
   * model output buffers and the whole-track accumulators, so they're built
   * once per separate() call and reused across segments.
   */
  makeTrackBinds(freqBuf, timeBuf, accs, weightsBuf) {
    const ifftBinds = [];
    const combineBinds = [];
    for (let t = 0; t < 4; t++) {
      for (let c = 0; c < 2; c++) {
        ifftBinds.push(
          this.bind(this.ifft, [
            freqBuf,
            this.hannBuf,
            this.twiddleBuf,
            this.framesBuf,
            this.staticUniform(new Uint32Array([t * 4 + c * 2, 0, 0, 0])),
          ])
        );
        combineBinds.push(
          this.bind(this.combine, [
            timeBuf,
            this.istftTimeBuf,
            accs[t][c],
            weightsBuf,
            this.combineUniforms[t * 2 + c],
          ])
        );
      }
    }
    return { ifftBinds, combineBinds };
  }
  /**
   * Encode the whole post-model path for one segment: per track/channel, iFFT
   * the frequency branch, overlap-add, combine with the time branch into the
   * accumulators. Uniforms must be written for this segment first (queue order
   * guarantees they land before this encoder's submit).
   */
  encodePost(encoder, binds, seg) {
    for (let plane = 0; plane < 8; plane++) {
      const t = plane >> 1;
      const c = plane & 1;
      this.device.queue.writeBuffer(
        this.combineUniforms[plane],
        0,
        new Uint32Array([
          seg.start,
          seg.copyLen,
          seg.segmentLength,
          (t * 2 + c) * TRAINING_SAMPLES,
          plane === 0 ? 1 : 0,
          // weights accumulate once per segment
          seg.totalSamples,
          0,
          0,
        ])
      );
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.ifft.pipeline);
      pass.setBindGroup(0, binds.ifftBinds[plane]);
      pass.dispatchWorkgroups(PADDED_FRAMES);
      pass.setPipeline(this.ola.pipeline);
      pass.setBindGroup(0, this.olaBind);
      pass.dispatchWorkgroups(wgCount(ISTFT_LEN));
      pass.setPipeline(this.combine.pipeline);
      pass.setBindGroup(0, binds.combineBinds[plane]);
      pass.dispatchWorkgroups(wgCount(seg.copyLen));
      pass.end();
    }
  }
  /** Encode the final normalize of one accumulator by the shared weights. */
  encodeNormalize(encoder, acc, weightsBuf, totalSamples) {
    const bind = this.bind(this.norm, [
      weightsBuf,
      acc,
      this.staticUniform(new Uint32Array([totalSamples, 0, 0, 0])),
    ]);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.norm.pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(wgCount(totalSamples));
    pass.end();
  }
}
