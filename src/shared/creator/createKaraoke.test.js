/**
 * createKaraoke tests — verify the framework-free compute orchestration with MOCKED
 * libs (no real WebGPU/models). Covers: separation skipped on reuse, the Whisper
 * window loop + cull stack producing lines/words, callback wiring, and the return
 * shape the headless relay depends on. The heavy DSP (planVocalSegments, grouping,
 * culls) are the project's own tested pure fns — here we check the wiring around them.
 */

import { describe, it, expect, vi } from 'vitest';
import { createKaraoke } from './createKaraoke.js';

// A tiny stereo "audio" of N seconds at 16k (so toMono16k is a no-op and timing is
// predictable). Vocals carry a loud region so the RMS profile has a clear peak.
function fakeAudio(durationSec = 30, sampleRate = 16000) {
  const n = durationSec * sampleRate;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  // Loud from 10s..20s (the "singing" region), silent elsewhere.
  for (let i = Math.floor(10 * sampleRate); i < Math.floor(20 * sampleRate); i++) {
    left[i] = 0.5;
    right[i] = 0.5;
  }
  return { left, right, sampleRate, duration: durationSec };
}

// Mock libs: an asr() that returns one line per call, plus the ftEnsemble shape.
function fakeLibs(asrImpl) {
  const asr = vi.fn(asrImpl);
  asr.tokenizer = {}; // no get_prompt_ids → prompt path skipped
  return {
    ort: {},
    demucs: {},
    DemucsProcessor: class {},
    pipeline: vi.fn(async () => asr),
    crepeMod: { detectPitch: vi.fn(), detectKey: vi.fn() },
    tf: {}, // no LogitsProcessor → no_speech capture skipped (fail-safe)
    ftEnsemble: {
      STEMS: ['drums', 'bass', 'other', 'vocals'],
      createEnsembleSessions: vi.fn(),
      runEnsemble: vi.fn(),
    },
    _asr: asr,
  };
}

const baseOpts = {
  asrModel: 'onnx-community/whisper-tiny_timestamped',
  demucsModel: 'htdemucs',
  ftAvailable: false,
  device: 'wasm',
  whisperDtype: 'q8',
  timestampMode: 'segment',
  language: 'en',
  enableCrepe: false, // skip CREPE (no real model) — exercised via the skip log
};

describe('createKaraoke', () => {
  it('reuses provided stems (skips separation) and returns lyrics + shape', async () => {
    const audio = fakeAudio(30);
    // The vocals stem we hand in (reuse path) — same buffers as audio for the test.
    const reuse = {
      drums: { left: audio.left, right: audio.right },
      bass: { left: audio.left, right: audio.right },
      other: { left: audio.left, right: audio.right },
      vocals: { left: audio.left, right: audio.right },
    };
    // asr returns one segment with a sung line inside the loud region.
    const libs = fakeLibs(async () => ({
      chunks: [{ text: 'hello world tonight', timestamp: [11, 14] }],
      text: 'hello world tonight',
    }));

    const phases = [];
    const result = await createKaraoke({ audio, stems: reuse }, baseOpts, libs, {
      onPhase: (p) => phases.push(p),
    });

    // Separation was skipped (reuse) → ensemble/single never invoked.
    expect(libs.ftEnsemble.runEnsemble).not.toHaveBeenCalled();
    // Whisper pipeline + at least one asr() window ran.
    expect(libs.pipeline).toHaveBeenCalledOnce();
    expect(libs._asr).toHaveBeenCalled();
    // Return shape the relay/save depends on.
    expect(result.stems).toBe(reuse);
    expect(result.sampleRate).toBe(16000);
    expect(result.duration).toBe(30);
    expect(Array.isArray(result.lyrics.lines)).toBe(true);
    expect(Array.isArray(result.lyrics.words)).toBe(true);
    expect(result.lyrics.lines.length).toBeGreaterThan(0);
    expect(result.lyrics.lines[0].text).toContain('hello');
    // Words are normalized to {text,start,end}.
    for (const w of result.lyrics.words) {
      expect(typeof w.text).toBe('string');
      expect(typeof w.start).toBe('number');
    }
    // Phases: transcribing fired; separation did NOT (reuse).
    expect(phases).toContain('transcribing');
    expect(phases).not.toContain('separating');
    // CREPE disabled → no key/pitch.
    expect(result.key).toBeNull();
    expect(result.pitch).toBeNull();
    // Timing recorded.
    expect(result.timing.total).toBeGreaterThanOrEqual(0);
  });

  it('culls an annotation token ([Music]) from the words', async () => {
    const audio = fakeAudio(30);
    const reuse = { vocals: { left: audio.left, right: audio.right } };
    const libs = fakeLibs(() =>
      // "[Music]" must be stripped by the annotation cull; real words kept.
      Promise.resolve({
        chunks: [{ text: 'la la la [Music]', timestamp: [11, 14] }],
        text: 'la la la [Music]',
      })
    );
    const result = await createKaraoke(
      { audio, stems: reuse, lyricsOnly: true },
      baseOpts,
      libs,
      {}
    );
    const joined = result.lyrics.lines.map((l) => l.text).join(' ');
    expect(joined).not.toContain('[Music]');
    expect(joined.toLowerCase()).toContain('la');
  });

  it('drives onLyricsPreview + onLog during transcription', async () => {
    const audio = fakeAudio(30);
    const reuse = { vocals: { left: audio.left, right: audio.right } };
    const libs = fakeLibs(() =>
      Promise.resolve({
        chunks: [{ text: 'a sung phrase here', timestamp: [11, 14] }],
        text: 'a sung phrase here',
      })
    );
    const onLyricsPreview = vi.fn();
    const onLog = vi.fn();
    await createKaraoke({ audio, stems: reuse }, baseOpts, libs, {
      onLyricsPreview,
      onLog,
    });
    expect(onLyricsPreview).toHaveBeenCalled();
    expect(onLog).toHaveBeenCalled();
  });
});
