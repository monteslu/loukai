import { describe, it, expect } from 'vitest';
import { WasmStemsDsp } from './stemsdsp.js';
import { fft, ifft, stft, istft, reflectPad } from './fft.js';
import { DemucsProcessor, segmentStarts } from './processor.js';
import { CONSTANTS } from './constants.js';
const {
  FFT_SIZE,
  HOP_SIZE,
  TRAINING_SAMPLES,
  MODEL_SPEC_BINS,
  MODEL_SPEC_FRAMES,
  SEGMENT_OVERLAP,
} = CONSTANTS;
const STRIDE = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}
function randomSignal(n, seed = 1) {
  const r = rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 0.5;
  return out;
}
const maxAbsDiff = (a, b, from = 0, to = a.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return m;
};
describe('fft/ifft', () => {
  it('roundtrips a real signal', () => {
    const n = FFT_SIZE;
    const sig = randomSignal(n, 7);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    fft(re, im, sig, n);
    const outRe = new Float32Array(n);
    const outIm = new Float32Array(n);
    ifft(outRe, outIm, re, im, n);
    expect(maxAbsDiff(outRe, sig)).toBeLessThan(1e-4);
    expect(maxAbsDiff(outIm, new Float32Array(n))).toBeLessThan(1e-4);
  });
});
describe('stft/istft', () => {
  it('reconstructs the interior of a signal (COLA)', () => {
    const len = FFT_SIZE + 20 * HOP_SIZE;
    const sig = randomSignal(len, 11);
    const spec = stft(sig, FFT_SIZE, HOP_SIZE);
    const rec = istft(spec.real, spec.imag, spec.numFrames, spec.numBins, FFT_SIZE, HOP_SIZE, len);
    expect(maxAbsDiff(rec, sig, FFT_SIZE, len - FFT_SIZE)).toBeLessThan(1e-3);
  });
  it('reuses caller-provided buffers', () => {
    const len = FFT_SIZE + 4 * HOP_SIZE;
    const sig = randomSignal(len, 13);
    const spec1 = stft(sig, FFT_SIZE, HOP_SIZE);
    const spec2 = stft(sig, FFT_SIZE, HOP_SIZE, spec1);
    expect(spec2).toBe(spec1);
    const out = new Float32Array(len);
    const rec = istft(
      spec1.real,
      spec1.imag,
      spec1.numFrames,
      spec1.numBins,
      FFT_SIZE,
      HOP_SIZE,
      len,
      out
    );
    expect(rec).toBe(out);
  });
});
describe('reflectPad', () => {
  it('matches upstream demucs-web edge semantics', () => {
    const sig = Float32Array.from([1, 2, 3, 4, 5]);
    const out = reflectPad(sig, 3, 3);
    const expected = [];
    for (let i = 0; i < 3; i++) expected.push(sig[Math.min(3 - i, sig.length - 1)]);
    expected.push(...sig);
    for (let i = 0; i < 3; i++) expected.push(sig[Math.max(0, sig.length - 2 - i)]);
    expect(Array.from(out)).toEqual(expected);
  });
  it('writes into a provided output buffer', () => {
    const sig = randomSignal(64, 3);
    const buf = new Float32Array(64 + 8 + 8);
    const out = reflectPad(sig, 8, 8, buf);
    expect(out).toBe(buf);
    const fresh = reflectPad(sig, 8, 8);
    expect(maxAbsDiff(out, fresh)).toBe(0);
  });
});
describe('segmentStarts', () => {
  it('is a single zero segment for short input', () => {
    expect(segmentStarts(1e3)).toEqual([0]);
    expect(segmentStarts(TRAINING_SAMPLES)).toEqual([0]);
  });
  it('aligns the final segment to the end (no padding waste)', () => {
    const total = 30 * 44100;
    const starts = segmentStarts(total);
    expect(starts[0]).toBe(0);
    expect(starts[starts.length - 1]).toBe(total - TRAINING_SAMPLES);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(STRIDE);
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
  });
  it('covers every sample', () => {
    for (const total of [TRAINING_SAMPLES + 1, 30 * 44100, 200 * 44100 + 17]) {
      const starts = segmentStarts(total);
      let covered = 0;
      for (const s of starts) {
        expect(s).toBeLessThanOrEqual(covered);
        covered = Math.max(covered, s + TRAINING_SAMPLES);
      }
      expect(covered).toBeGreaterThanOrEqual(total);
    }
  });
});
describe('WasmStemsDsp vs JS reference', () => {
  it('stft matches the JS implementation', () => {
    const wasm = new WasmStemsDsp();
    const len = FFT_SIZE + 8 * HOP_SIZE;
    const sig = randomSignal(len, 21);
    const js = stft(sig, FFT_SIZE, HOP_SIZE);
    const w = wasm.stft(sig, FFT_SIZE, HOP_SIZE);
    expect(w.numFrames).toBe(js.numFrames);
    expect(w.numBins).toBe(js.numBins);
    expect(maxAbsDiff(w.real, js.real)).toBeLessThan(1e-4);
    expect(maxAbsDiff(w.imag, js.imag)).toBeLessThan(1e-4);
  });
  it('istft matches the JS implementation', () => {
    const wasm = new WasmStemsDsp();
    const numFrames = 12;
    const numBins = FFT_SIZE / 2 + 1;
    const outLen = (numFrames - 1) * HOP_SIZE + FFT_SIZE;
    const sig = randomSignal(outLen, 23);
    const spec = stft(sig, FFT_SIZE, HOP_SIZE);
    const js = istft(spec.real, spec.imag, numFrames, numBins, FFT_SIZE, HOP_SIZE, outLen);
    const views = wasm.ispecViews(numFrames, numBins);
    views.real.set(spec.real.subarray(0, numFrames * numBins));
    views.imag.set(spec.imag.subarray(0, numFrames * numBins));
    const w = wasm.istft(numFrames, numBins, FFT_SIZE, HOP_SIZE, outLen);
    expect(maxAbsDiff(w, js, FFT_SIZE, outLen - FFT_SIZE)).toBeLessThan(1e-4);
    expect(maxAbsDiff(w, js)).toBeLessThan(1e-3);
  });
});
function makeStubOrt(makeOutputs) {
  class Tensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
    type;
    data;
    dims;
  }
  const session = {
    inputNames: ['input', 'x'],
    outputNames: ['output', 'add_67'],
    async run(feeds) {
      return makeOutputs(feeds);
    },
  };
  const ort = {
    Tensor,
    InferenceSession: { create: async () => session },
  };
  return { ort, session };
}
function makeProcessor(makeOutputs, opts = {}) {
  const { ort } = makeStubOrt(makeOutputs);
  const proc = new DemucsProcessor({
    ort,
    dsp: 'js',
    ...opts,
  });
  return proc;
}
function echoModel(feeds) {
  const wave = feeds['input'].data;
  const time = new Float32Array(4 * 2 * TRAINING_SAMPLES);
  for (let t = 0; t < 4; t++) {
    const s = (t + 1) / 4;
    for (let i = 0; i < TRAINING_SAMPLES; i++) {
      time[t * 2 * TRAINING_SAMPLES + i] = wave[i] * s;
      time[t * 2 * TRAINING_SAMPLES + TRAINING_SAMPLES + i] = wave[TRAINING_SAMPLES + i] * s;
    }
  }
  return {
    output: {
      data: new Float32Array(4 * 4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES),
      dims: [1, 4, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES],
    },
    add_67: { data: time, dims: [1, 4, 2, TRAINING_SAMPLES] },
  };
}
describe('DemucsProcessor.separate', () => {
  it('reassembles time-branch output through overlap-add (echo model)', async () => {
    const proc = makeProcessor(echoModel);
    await proc.loadModel(new ArrayBuffer(0));
    const total = TRAINING_SAMPLES + STRIDE;
    const left = randomSignal(total, 31);
    const right = randomSignal(total, 32);
    const stems = await proc.separate(left, right);
    expect(maxAbsDiff(stems.vocals.left, left, 1)).toBeLessThan(1e-4);
    expect(maxAbsDiff(stems.vocals.right, right, 1)).toBeLessThan(1e-4);
    const quarter = Float32Array.from(left, (v) => v * 0.25);
    expect(maxAbsDiff(stems.drums.left, quarter, 1)).toBeLessThan(1e-4);
  });
  it('pipeline=true and pipeline=false produce identical output', async () => {
    const total = TRAINING_SAMPLES + 2 * STRIDE;
    const left = randomSignal(total, 41);
    const right = randomSignal(total, 42);
    const a = makeProcessor(echoModel, { pipeline: false });
    await a.loadModel(new ArrayBuffer(0));
    const sa = await a.separate(left, right);
    const b = makeProcessor(echoModel, { pipeline: true });
    await b.loadModel(new ArrayBuffer(0));
    const sb = await b.separate(left, right);
    expect(maxAbsDiff(sa.other.left, sb.other.left)).toBe(0);
    expect(maxAbsDiff(sa.bass.right, sb.bass.right)).toBe(0);
  });
  it('wasm dsp and js dsp agree end-to-end (freq branch active)', async () => {
    const sig = randomSignal(TRAINING_SAMPLES, 51);
    const spec = stft(
      reflectPad(reflectPad(sig, 1536, 1620), FFT_SIZE / 2, FFT_SIZE / 2),
      FFT_SIZE,
      HOP_SIZE
    );
    const freq = new Float32Array(4 * 4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES);
    for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
      for (let b = 0; b < MODEL_SPEC_BINS; b++) {
        const src = (f + 2) * spec.numBins + b;
        freq[0 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + b * MODEL_SPEC_FRAMES + f] = spec.real[src];
        freq[1 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + b * MODEL_SPEC_FRAMES + f] = spec.imag[src];
      }
    }
    const freqModel = () => ({
      output: { data: freq, dims: [1, 4, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES] },
      add_67: {
        data: new Float32Array(4 * 2 * TRAINING_SAMPLES),
        dims: [1, 4, 2, TRAINING_SAMPLES],
      },
    });
    const js = makeProcessor(freqModel, { dsp: 'js' });
    await js.loadModel(new ArrayBuffer(0));
    const sj = await js.separate(sig, sig);
    const wasm = makeProcessor(freqModel, { dsp: 'wasm' });
    await wasm.loadModel(new ArrayBuffer(0));
    const sw = await wasm.separate(sig, sig);
    expect(maxAbsDiff(sw.drums.left, sj.drums.left)).toBeLessThan(1e-4);
    expect(maxAbsDiff(sj.drums.left, sig, FFT_SIZE, TRAINING_SAMPLES - FFT_SIZE)).toBeLessThan(
      0.01
    );
    expect(maxAbsDiff(sj.bass.left, new Float32Array(TRAINING_SAMPLES))).toBeLessThan(1e-6);
  });
  it('reports progress once per segment', async () => {
    const events = [];
    const proc = makeProcessor(echoModel, {
      onProgress: (p) => events.push(p.currentSegment),
    });
    await proc.loadModel(new ArrayBuffer(0));
    const total = TRAINING_SAMPLES + 2 * STRIDE;
    await proc.separate(randomSignal(total, 61), randomSignal(total, 62));
    expect(events).toEqual([1, 2, 3]);
  });
});

// ── the chained split model (gpu-separator runChain + processor loadModel) ──────
import { GpuSeparator } from './gpu-separator.js';

describe('GpuSeparator.runChain (chained split)', () => {
  const mkSep = () => new GpuSeparator({ ort: {} });

  it('runs pieces strictly in order, feeds boundaries by name, disposes them after', async () => {
    const sep = mkSep();
    const calls = [];
    const disposed = [];
    const tensor = (name) => ({ name, dispose: () => disposed.push(name) });
    sep.feeds = { mix: 'MIX', mag: 'MAG' };
    sep.chain = [
      {
        session: {
          run: async (feeds) => {
            calls.push(['p0', Object.keys(feeds)]);
            return { a: tensor('a') };
          },
        },
        inputs: ['mix', 'mag'],
        outputs: ['a'],
        fetches: null,
      },
      {
        session: {
          run: async (feeds) => {
            calls.push(['p1', Object.keys(feeds)]);
            return { b: tensor('b') };
          },
        },
        inputs: ['a'],
        outputs: ['b'],
        fetches: null,
      },
      {
        session: {
          run: async (feeds, fetches) => {
            calls.push(['p2', Object.keys(feeds), Object.keys(fetches)]);
            return {};
          },
        },
        inputs: ['b', 'mix'],
        outputs: ['x'],
        fetches: { x: 'FREQ' },
      },
    ];
    await sep.runChain();
    // strict manifest order, boundary tensors resolved by NAME (a from p0 → p1, b+mix → p2),
    // final piece runs with pre-bound fetches
    expect(calls).toEqual([
      ['p0', ['mix', 'mag']],
      ['p1', ['a']],
      ['p2', ['b', 'mix'], ['x']],
    ]);
    // every boundary tensor disposed once the segment is done (VRAM leak pitfall)
    expect(disposed.sort()).toEqual(['a', 'b']);
  });

  it('throws on a missing boundary tensor and still disposes what it made', async () => {
    const sep = mkSep();
    const disposed = [];
    sep.feeds = { mix: 'MIX', mag: 'MAG' };
    sep.chain = [
      {
        session: { run: async () => ({ a: { dispose: () => disposed.push('a') } }) },
        inputs: ['mix'],
        outputs: ['a'],
        fetches: null,
      },
      // asks for a tensor no earlier piece produced → manifest order violation
      { session: { run: async () => ({}) }, inputs: ['nope'], outputs: ['z'], fetches: null },
    ];
    await expect(sep.runChain()).rejects.toThrow(/missing boundary tensor nope/);
    expect(disposed).toEqual(['a']);
  });

  it('initChain gives ONLY piece 0 the caller session options (CPU-pinned prologue)', async () => {
    const seen = [];
    const ort = {
      InferenceSession: {
        create: async (_buf, opts) => {
          seen.push(opts);
          return { run: async () => ({}) };
        },
      },
      env: { webgpu: {} }, // no device → initChain throws AFTER creating sessions
      Tensor: { fromGpuBuffer: () => ({}) },
    };
    const sep = new GpuSeparator({
      ort,
      sessionOptions: {
        executionProviders: [{ name: 'webgpu', forceCpuNodeNames: ['/ReduceMean'] }],
      },
    });
    const chain = {
      pieces: [
        { buf: new ArrayBuffer(1), inputs: ['mix', 'mag'], outputs: ['t1'] },
        { buf: new ArrayBuffer(1), inputs: ['t1'], outputs: ['x'] },
      ],
      outputs: { freq: 'x', time: 'xt' },
    };
    await expect(sep.initChain(chain)).rejects.toThrow(/no WebGPU device/);
    expect(seen).toHaveLength(2);
    // piece 0: caller options (with the forceCpuNodeNames pin) merged in
    expect(seen[0].executionProviders[0].forceCpuNodeNames).toEqual(['/ReduceMean']);
    // piece 1: plain webgpu, NO pin (pinning later pieces breaks them)
    expect(seen[1].executionProviders).toEqual(['webgpu']);
    expect(seen[1].executionProviders[0].forceCpuNodeNames).toBeUndefined();
  });
});

describe('DemucsProcessor chained model requirements', () => {
  it('a chain on a non-GPU dsp path fails loudly (no silent WASM fallback)', async () => {
    const proc = new DemucsProcessor({ ort: {}, dsp: 'wasm' });
    const chain = { pieces: [], outputs: { freq: 'x', time: 'xt' } };
    await expect(proc.loadModel(chain)).rejects.toThrow(/requires the WebGPU DSP path/);
  });

  it('live gentle flip reaches the gpu separator through the setter', () => {
    const proc = new DemucsProcessor({ ort: {}, dsp: 'wasm', gentle: false });
    proc.gpu = { gentle: false };
    proc.gentle = true;
    expect(proc.gpu.gentle).toBe(true);
    proc.gentle = false;
    expect(proc.gpu.gentle).toBe(false);
  });
});
