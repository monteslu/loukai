/**
 * Stem×bus mixer pure logic (plan §12 unit list): effective-gain matrix,
 * punchthrough max() overlay, unknown-stem runtime defaults, D1 seed, persisted
 * merge, display ordering, and the classification heuristics they depend on.
 */

import { describe, it, expect } from 'vitest';
import {
  dbToLinear,
  clampStemGain,
  effectiveStemGain,
  defaultStemEntry,
  resolveStemEntry,
  seedDefaultStemMix,
  mergeStemMix,
  orderStems,
  CANONICAL_STEMS,
  STEM_GAIN_MAX,
} from './stemGain.js';
import { isVocalStem, isMixdownStem, isMelodicStem } from './stemClassify.js';

describe('dbToLinear / clampStemGain', () => {
  it('converts dB trims', () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);
    expect(dbToLinear(6)).toBeCloseTo(1.995, 2);
    expect(dbToLinear(undefined)).toBe(1); // missing trim = authored unity
  });

  it('clamps sliders to 0..1.5 and coerces junk to unity', () => {
    expect(clampStemGain(0.5)).toBe(0.5);
    expect(clampStemGain(-1)).toBe(0);
    expect(clampStemGain(9)).toBe(STEM_GAIN_MAX);
    expect(clampStemGain('nope')).toBe(1);
    expect(clampStemGain(undefined)).toBe(1);
  });
});

describe('effectiveStemGain (§5.2 formula)', () => {
  it('multiplies trim × user × mute', () => {
    // authored -6dB, slider 50% → quarter-ish level
    expect(effectiveStemGain({ fileTrimDb: -6, userGain: 0.5 })).toBeCloseTo(0.2505, 3);
    // unity everything
    expect(effectiveStemGain({})).toBe(1);
    // mute wins regardless of slider
    expect(effectiveStemGain({ userGain: 1.5, muted: true })).toBe(0);
  });

  it('does NOT include bus master terms (gotcha #9: they live on masterGain)', () => {
    // the formula has no master inputs at all — same value whatever the master does
    expect(effectiveStemGain({ fileTrimDb: 0, userGain: 1 })).toBe(1);
  });

  describe('backup:PA punchthrough overlay (D2: only ever ADDS vocals)', () => {
    it('raises user-muted vocals to the authored level while active', () => {
      const val = effectiveStemGain({ fileTrimDb: -3, muted: true, punchthroughActive: true });
      expect(val).toBeCloseTo(dbToLinear(-3), 6); // full authored level
    });

    it('is a no-op when the user already sits above authored', () => {
      const val = effectiveStemGain({ fileTrimDb: 0, userGain: 1.2, punchthroughActive: true });
      expect(val).toBeCloseTo(1.2, 6); // user wins — max(1.2, 1.0)
    });

    it('restores the user level when inactive (40% case from the plan)', () => {
      const during = effectiveStemGain({ fileTrimDb: 0, userGain: 0.4, punchthroughActive: true });
      const after = effectiveStemGain({ fileTrimDb: 0, userGain: 0.4, punchthroughActive: false });
      expect(during).toBe(1); // line plays at authored 100%
      expect(after).toBeCloseTo(0.4, 6); // returns to the slider
    });
  });
});

describe('runtime defaults for unknown stems (§5.1)', () => {
  it('non-vocal: audible on PA, muted on IEM', () => {
    expect(defaultStemEntry('PA', 'guitar')).toEqual({ gain: 1, muted: false });
    expect(defaultStemEntry('IEM', 'guitar')).toEqual({ gain: 1, muted: true });
  });

  it('vocals muted on PA; everything muted on IEM (single-sound-card default)', () => {
    expect(defaultStemEntry('PA', 'Lead Vox')).toEqual({ gain: 1, muted: true });
    expect(defaultStemEntry('IEM', 'Lead Vox')).toEqual({ gain: 1, muted: true });
  });

  it('resolveStemEntry falls back to the runtime default and clamps stored values', () => {
    const stemMix = { PA: { drums: { gain: 99, muted: 0 } } };
    expect(resolveStemEntry(stemMix, 'PA', 'drums')).toEqual({ gain: STEM_GAIN_MAX, muted: false });
    expect(resolveStemEntry(stemMix, 'IEM', 'harmonica')).toEqual({ gain: 1, muted: true });
    expect(resolveStemEntry(undefined, 'PA', 'vocals')).toEqual({ gain: 1, muted: true });
  });
});

describe('D1 seed + merge (§5.3)', () => {
  it('seed matches the D1 defaults table', () => {
    const seed = seedDefaultStemMix();
    expect(Object.keys(seed.PA)).toEqual(CANONICAL_STEMS);
    expect(seed.PA).toMatchObject({
      drums: { muted: false },
      bass: { muted: false },
      other: { muted: false },
      vocals: { muted: true },
    });
    // IEM defaults fully muted: we can't assume a second sound card exists,
    // and an unmuted IEM vocal on a shared output leaks guide vocals.
    expect(seed.IEM).toMatchObject({
      drums: { muted: true },
      bass: { muted: true },
      other: { muted: true },
      vocals: { muted: true },
    });
    // all sliders default to 100% = authored mix (D3)
    for (const bus of ['PA', 'IEM'])
      for (const stem of CANONICAL_STEMS) expect(seed[bus][stem].gain).toBe(1);
  });

  it('no persisted state → pure seed', () => {
    expect(mergeStemMix(undefined)).toEqual(seedDefaultStemMix());
    expect(mergeStemMix(null)).toEqual(seedDefaultStemMix());
  });

  it('persisted values override the seed; unknown stems survive; junk is sanitized', () => {
    const merged = mergeStemMix({
      PA: { vocals: { gain: 0.8, muted: false }, kazoo: { gain: 2.4, muted: 'yes' } },
      IEM: { drums: 'garbage' },
      booth: { drums: { gain: 1 } }, // unknown bus dropped
    });
    expect(merged.PA.vocals).toEqual({ gain: 0.8, muted: false }); // user's choice
    expect(merged.PA.kazoo).toEqual({ gain: STEM_GAIN_MAX, muted: true }); // clamped + coerced
    expect(merged.PA.drums).toEqual({ gain: 1, muted: false }); // seed preserved
    expect(merged.IEM.drums).toEqual({ gain: 1, muted: true }); // junk entry ignored → seed
    expect(merged.booth).toBeUndefined();
  });

  it('round-trips: merge(seed) === seed', () => {
    expect(mergeStemMix(seedDefaultStemMix())).toEqual(seedDefaultStemMix());
  });
});

describe('orderStems', () => {
  it('canonical order first, then file order', () => {
    expect(orderStems(['kazoo', 'vocals', 'bass', 'theremin', 'drums'])).toEqual([
      'drums',
      'bass',
      'vocals',
      'kazoo',
      'theremin',
    ]);
    expect(orderStems([])).toEqual([]);
    expect(orderStems(undefined)).toEqual([]);
  });
});

describe('stemClassify (exact port of the KAIPlayer heuristics)', () => {
  it('vocal detection', () => {
    for (const n of ['vocals', 'Lead Vocals', 'VOX', 'backing voice', 'singing'])
      expect(isVocalStem(n)).toBe(true);
    for (const n of ['drums', 'bass', 'other']) expect(isVocalStem(n)).toBe(false);
  });

  it('mixdown detection (exact / underscore-delimited only)', () => {
    for (const n of ['mixdown', 'mix', 'master', 'stereo mix', 'drums_mix', 'mix_stereo'])
      expect(isMixdownStem(n)).toBe(true);
    // 'remix' contains 'mix' but not delimited → NOT a mixdown (matches shipped rules)
    expect(isMixdownStem('remix')).toBe(false);
    expect(isMixdownStem('drums')).toBe(false);
  });

  it('melodic detection', () => {
    for (const n of ['other', 'instrumental', 'melody', 'accompaniment', 'music'])
      expect(isMelodicStem(n)).toBe(true);
    for (const n of ['vocals', 'drums', 'percussion', 'bass']) expect(isMelodicStem(n)).toBe(false);
    expect(isMelodicStem('theremin')).toBe(true); // unknown defaults to melodic
  });
});
