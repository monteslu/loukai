import { describe, it, expect } from 'vitest';
import { shiftKeyName, clampKeyShift } from './musicKey.js';

describe('shiftKeyName', () => {
  it('shifts natural keys', () => {
    expect(shiftKeyName('C', 2)).toBe('D');
    expect(shiftKeyName('A', 3)).toBe('C');
  });

  it('preserves the mode suffix', () => {
    expect(shiftKeyName('Am', 2)).toBe('Bm');
    expect(shiftKeyName('Bb minor', 1)).toBe('B minor');
    expect(shiftKeyName('F#m', -2)).toBe('Em');
  });

  it('handles flats and unicode accidentals, normalizing to sharps', () => {
    expect(shiftKeyName('Bb', 1)).toBe('B');
    expect(shiftKeyName('Eb', 2)).toBe('F');
    expect(shiftKeyName('D♭', 0)).toBe('C#');
    expect(shiftKeyName('F♯', 1)).toBe('G');
  });

  it('wraps around the octave in both directions', () => {
    expect(shiftKeyName('B', 1)).toBe('C');
    expect(shiftKeyName('C', -1)).toBe('B');
    expect(shiftKeyName('C', -13)).toBe('B');
  });

  it('is identity at 0', () => {
    expect(shiftKeyName('G', 0)).toBe('G');
    expect(shiftKeyName('Am', 0)).toBe('Am');
  });

  it('returns null for garbage', () => {
    expect(shiftKeyName('', 2)).toBeNull();
    expect(shiftKeyName(null, 2)).toBeNull();
    expect(shiftKeyName('H', 2)).toBeNull();
    expect(shiftKeyName(42, 2)).toBeNull();
  });
});

describe('clampKeyShift', () => {
  it('clamps to -6..6 and rounds', () => {
    expect(clampKeyShift(9)).toBe(6);
    expect(clampKeyShift(-9)).toBe(-6);
    expect(clampKeyShift(2.6)).toBe(3);
    expect(clampKeyShift('nope')).toBe(0);
  });
});
