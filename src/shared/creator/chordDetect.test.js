import { describe, it, expect } from 'vitest';
import { detectChords } from './chordDetect.js';

const SR = 44100;

function tone(freqs, seconds, gain = 0.3) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (const f of freqs) {
    for (let i = 0; i < n; i++)
      out[i] += (gain / freqs.length) * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return out;
}

function concat(parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('detectChords (root notes)', () => {
  it('follows the bass root through a progression', () => {
    // C major triad over C bass, then A minor triad over A bass.
    const other = concat([tone([261.6, 329.6, 392.0], 2), tone([220.0, 261.6, 329.6], 2)]);
    const bass = concat([tone([65.4], 2), tone([55.0], 2)]); // C2 then A1
    const segs = detectChords({ left: other }, { left: bass }, SR);
    const names = segs.map((s) => s.chord);
    expect(names[0]).toBe('C');
    expect(names[names.length - 1]).toBe('A');
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].start);
    }
  });

  it('returns nothing for silence', () => {
    const silent = new Float32Array(SR * 2);
    expect(detectChords({ left: silent }, { left: silent }, SR)).toEqual([]);
  });

  it('falls back to the harmony stem when the bass is silent', () => {
    const other = tone([196.0], 2); // G3 alone - dominance is unambiguous
    const segs = detectChords({ left: other }, null, SR);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs[0].chord).toBe('G');
  });

  it('emits bare roots only (no maj/min suffix)', () => {
    const other = tone([220.0, 261.6, 329.6], 2); // A minor triad
    const bass = tone([55.0], 2);
    const segs = detectChords({ left: other }, { left: bass }, SR);
    for (const s of segs) expect(s.chord).toMatch(/^[A-G]#?$/);
  });

  it('rounds segment times to centiseconds', () => {
    const other = tone([196.0], 1.5);
    const segs = detectChords({ left: other }, null, SR);
    for (const s of segs) {
      expect(s.start).toBeCloseTo(Math.round(s.start * 100) / 100, 10);
    }
  });
});
