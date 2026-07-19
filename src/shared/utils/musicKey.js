/**
 * Musical key name arithmetic for the key shift control (issue #90).
 * Pure string math: no audio here.
 */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const PITCH_CLASS = {
  C: 0,
  'B#': 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

/**
 * Transpose a key name by N semitones, preserving the mode suffix.
 * 'Am' +2 -> 'Bm', 'F#' -1 -> 'F', 'Bb minor' +1 -> 'B minor'.
 * Returns null when the key string is unparseable (display falls back to
 * bare semitones).
 */
export function shiftKeyName(key, semitones) {
  if (!key || typeof key !== 'string') return null;
  const m = key.trim().match(/^([A-Ga-g])([#b♯♭]?)(.*)$/);
  if (!m) return null;
  const accidental = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  const root = m[1].toUpperCase() + accidental;
  const pc = PITCH_CLASS[root];
  if (pc === undefined) return null;
  const n = Math.round(Number(semitones) || 0);
  const shifted = (((pc + n) % 12) + 12) % 12;
  return SHARP_NAMES[shifted] + m[3];
}

/** Clamp + round a requested key shift to the supported range. */
export const KEY_SHIFT_MIN = -6;
export const KEY_SHIFT_MAX = 6;
export function clampKeyShift(semitones) {
  const n = Math.round(Number(semitones) || 0);
  return Math.max(KEY_SHIFT_MIN, Math.min(KEY_SHIFT_MAX, n));
}
