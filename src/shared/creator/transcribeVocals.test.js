/**
 * transcribeVocals tests - the silence-skipping segmentation, no_speech gating,
 * and legacy-mode parity, with a mocked ASR (no real model).
 */

import { describe, it, expect, vi } from 'vitest';
import { transcribeVocals } from './transcribeVocals.js';

const SR = 16000;

// Stereo vocals of durationSec with loud (0.5) samples in the given [start,end] spans.
function vocals(durationSec, voiced = []) {
  const n = durationSec * SR;
  const left = new Float32Array(n);
  for (const [a, b] of voiced) {
    for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) left[i] = 0.5;
  }
  return { left, right: left };
}

function run(v, durationSec, asrImpl, { opts = {}, tf = {} } = {}) {
  const asr = vi.fn(asrImpl);
  asr.tokenizer = {};
  return transcribeVocals(
    { vocals: v, sampleRate: SR, duration: durationSec, asr, tf },
    { timestampMode: 'segment', language: 'en', ...opts },
    {}
  ).then((r) => ({ ...r, asr }));
}

describe('transcribeVocals', () => {
  it('skips Whisper entirely on a fully instrumental track', async () => {
    const r = await run(vocals(30), 30, async () => ({ chunks: [], text: '' }));
    expect(r.asr).not.toHaveBeenCalled();
    expect(r.words).toEqual([]);
    expect(r.segmentsPlanned).toBe(0);
    expect(r.transcribedSec).toBe(0);
  });

  it('plans segments only over voiced spans (skipSilence default)', async () => {
    // 60s track, voiced 10-20s only → one ~11s window, not 2-3 full 20-30s windows.
    const r = await run(vocals(60, [[10, 20]]), 60, async () => ({
      chunks: [{ text: 'hello there', timestamp: [1.6, 4.6] }],
      text: 'hello there',
    }));
    expect(r.asr).toHaveBeenCalledTimes(1);
    const window = r.asr.mock.calls[0][0];
    expect(window.length).toBeLessThan(14 * SR); // ~10s voiced + padding, not 20-30s
    expect(r.transcribedSec).toBeLessThan(14);
    expect(r.words.length).toBeGreaterThan(0);
  });

  it('legacy mode plans the full duration like the old inline code', async () => {
    const r = await run(
      vocals(60, [[10, 20]]),
      60,
      async () => ({ chunks: [{ text: 'x', timestamp: [11, 14] }], text: 'x' }),
      { opts: { legacy: true } }
    );
    // 60s / (20-30s dip-cut) → at least 2 windows, covering the whole duration.
    expect(r.asr.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(r.transcribedSec).toBeGreaterThan(55);
  });

  it('gates a window whose captured no_speech probability is high', async () => {
    class LogitsProcessor {}
    const NO_SPEECH_TOKEN = 50363;
    const r = await run(
      vocals(30, [[10, 20]]),
      30,
      async (window, options) => {
        // Simulate the decoder's first step: feed logits where no_speech dominates.
        const cap = options.logits_processor?.[0];
        if (cap) {
          // 1-D logits row (a real 2-D transformers Tensor supports [0] indexing;
          // a plain mock object does not).
          const data = new Float32Array(NO_SPEECH_TOKEN + 2).fill(-10);
          data[NO_SPEECH_TOKEN] = 10;
          cap._call(null, { dims: [data.length], data });
        }
        return { chunks: [{ text: 'ghost words', timestamp: [1.6, 4.6] }], text: 'ghost words' };
      },
      { tf: { LogitsProcessor } }
    );
    expect(r.words).toEqual([]);
  });
});

describe('toMono16kSinc', () => {
  it('resamples a 44.1k tone to 16k preserving frequency and amplitude', async () => {
    const { toMono16kSinc } = await import('./transcribeVocals.js');
    const sr = 44100;
    const n = sr * 2;
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = Math.sin((2 * Math.PI * 1000 * i) / sr) * 0.5;
    const out = toMono16kSinc(sig, sig, sr);
    expect(Math.abs(out.length - 2 * 16000)).toBeLessThan(4);
    let peak = 0;
    let crossings = 0;
    for (let i = 1; i < out.length; i++) {
      peak = Math.max(peak, Math.abs(out[i]));
      if ((out[i - 1] < 0 && out[i] >= 0) || (out[i - 1] >= 0 && out[i] < 0)) crossings++;
    }
    expect(peak).toBeGreaterThan(0.45);
    expect(peak).toBeLessThan(0.55);
    // 1kHz tone → 2000 crossings/s x 2s (edges excluded loosely)
    expect(Math.abs(crossings - 4000)).toBeLessThan(80);
  });
});

describe('WASM downmixTo16k', () => {
  it('agrees with the JS polyphase reference', async () => {
    const { WasmStemsDsp } = await import('./demucs/stemsdsp.js');
    const { toMono16kSinc } = await import('./transcribeVocals.js');
    const sr = 44100;
    const n = sr * 2;
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    let seed = 5;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    for (let i = 0; i < n; i++) {
      left[i] = rnd() * 0.4;
      right[i] = rnd() * 0.4;
    }
    const js = toMono16kSinc(left, right, sr);
    const wasm = new WasmStemsDsp().downmixTo16k(left, right, sr);
    expect(Math.abs(wasm.length - js.length)).toBeLessThanOrEqual(1);
    let maxDiff = 0;
    const m = Math.min(js.length, wasm.length);
    for (let i = 0; i < m; i++) maxDiff = Math.max(maxDiff, Math.abs(js[i] - wasm[i]));
    expect(maxDiff).toBeLessThan(1e-4);
  });
});

describe('language auto-detect', () => {
  // Mock model: forward pass returns logits where <|es|> wins; the pipeline call
  // itself records what language it was given.
  function detectingAsr() {
    const LANG_IDS = { '<|en|>': 5, '<|es|>': 7, '<|fr|>': 9 };
    const asr = vi.fn(async () => ({
      chunks: [{ text: 'hola', timestamp: [0.5, 1.0] }],
      text: 'hola',
    }));
    asr.tokenizer = {};
    asr.processor = vi.fn(async () => ({ input_features: 'feats' }));
    asr.model = vi.fn(async () => {
      const logits = new Float32Array(16).fill(-5);
      logits[7] = 10; // <|es|> wins
      return { logits: { data: logits } };
    });
    asr.model.config = { decoder_start_token_id: 1 };
    asr.model.generation_config = { lang_to_id: LANG_IDS };
    return asr;
  }
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
    }
  }

  it("resolves 'auto' by detecting on the vocals (not the silent English default)", async () => {
    const asr = detectingAsr();
    const r = await transcribeVocals(
      { vocals: vocals(60, [[10, 20]]), sampleRate: SR, duration: 60, asr, tf: { Tensor } },
      { timestampMode: 'segment', language: 'auto' },
      {}
    );
    expect(asr.model).toHaveBeenCalledTimes(1); // one detection forward pass
    expect(r.language).toBe('es');
    // every transcription window got the DETECTED language explicitly
    expect(asr.mock.calls[0][1].language).toBe('es');
  });

  it('explicit language skips detection and reaches the ASR calls', async () => {
    const asr = detectingAsr();
    const r = await transcribeVocals(
      { vocals: vocals(60, [[10, 20]]), sampleRate: SR, duration: 60, asr, tf: { Tensor } },
      { timestampMode: 'segment', language: 'de' },
      {}
    );
    expect(asr.model).not.toHaveBeenCalled(); // no detection needed
    expect(r.language).toBe('de');
    expect(asr.mock.calls[0][1].language).toBe('de');
  });

  it('falls back to English when detection fails (never breaks creation)', async () => {
    const asr = detectingAsr();
    asr.model = vi.fn(async () => {
      throw new Error('webgpu OOM');
    });
    asr.model.config = { decoder_start_token_id: 1 };
    asr.model.generation_config = { lang_to_id: {} };
    const r = await transcribeVocals(
      { vocals: vocals(60, [[10, 20]]), sampleRate: SR, duration: 60, asr, tf: { Tensor } },
      { timestampMode: 'segment', language: 'auto' },
      {}
    );
    expect(r.language).toBe('en');
    expect(asr.mock.calls[0][1].language).toBe('en');
  });

  it('skips lib-unsupported codes (yue) and takes the runner-up', async () => {
    // large-v3-turbo's model config lists yue, but transformers.js 3.8.1's language
    // map does not — forcing it would throw. Detection must fall through to zh.
    const asr = detectingAsr();
    asr.model = vi.fn(async () => {
      const logits = new Float32Array(16).fill(-5);
      logits[3] = 12; // <|yue|> wins the argmax…
      logits[7] = 10; // …but <|zh|> is the acceptable runner-up
      return { logits: { data: logits } };
    });
    asr.model.config = { decoder_start_token_id: 1 };
    asr.model.generation_config = { lang_to_id: { '<|yue|>': 3, '<|zh|>': 7, '<|en|>': 5 } };
    const r = await transcribeVocals(
      { vocals: vocals(60, [[10, 20]]), sampleRate: SR, duration: 60, asr, tf: { Tensor } },
      { timestampMode: 'segment', language: 'auto' },
      {}
    );
    expect(r.language).toBe('zh');
  });
});
