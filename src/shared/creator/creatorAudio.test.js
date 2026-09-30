import { describe, it, expect } from 'vitest';
import {
  groupWordsIntoLines,
  cullOutroThanks,
  mp4HasAudioTrack,
  assertHasAudioTrack,
  decodeFailure,
} from './creatorAudio.js';

// Build {text,start,end} words from "start|word" tokens.
function words(spec) {
  return spec
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const i = tok.indexOf('|');
      const start = parseFloat(tok.slice(0, i));
      return { text: tok.slice(i + 1), start, end: start + 0.4 };
    });
}

describe('groupWordsIntoLines', () => {
  it('does not fracture a line on Whisper mid-phrase periods', () => {
    // Real Whisper output: spurious "." after "motion" and "wears" must NOT split
    // the following phrase into fragments.
    const w = words(
      '55.7|Talk 56.5|about 57.4|things 58.2|that 59.0|nobody 59.9|cares. ' +
        '60.7|Wearing 61.3|out 62.0|the 62.6|things 63.2|that 63.8|nobody 64.5|wears.'
    );
    const lines = groupWordsIntoLines(w, { duration: 274 });
    const texts = lines.map((l) => l.text);
    expect(texts).toContain('Talk about things that nobody cares.');
    expect(texts).toContain('Wearing out the things that nobody wears.');
    // The pre-fix bug produced fragments like "Talk about things that".
    expect(texts).not.toContain('Talk about things that');
  });

  it('drops a stuck-decoder identical-word run (Oh. x31 collapse)', () => {
    let spec = '102.6|fire. ';
    for (let i = 0; i < 31; i++) spec += `${(103 + i * 0.2).toFixed(1)}|Oh. `;
    spec += '123.1|Sweet';
    const lines = groupWordsIntoLines(words(spec), { duration: 274 });
    const joined = lines.map((l) => l.text).join(' | ');
    expect(joined).not.toMatch(/Oh\. Oh\. Oh\./); // the run is gone
    expect(lines.dropped.some((d) => /identical-run/.test(d.reason))).toBe(true);
  });

  it('keeps a legitimate short repeat (not 4+ identical in a row)', () => {
    // "Sweet motion Sweet motion" — alternating, never the SAME word 4x back to back.
    const lines = groupWordsIntoLines(words('123.1|Sweet 124.0|motion 125.0|Sweet 126.0|motion'), {
      duration: 274,
    });
    expect(lines.map((l) => l.text).join(' ')).toMatch(/Sweet/);
    expect(lines.dropped.some((d) => /identical-run/.test(d.reason))).toBe(false);
  });

  it('breaks lines on real gaps and sentence ends', () => {
    const lines = groupWordsIntoLines(
      words('10.0|Hello 10.5|world 10.9|now. 20.0|A 20.5|new 21.0|line'),
      { duration: 60 }
    );
    expect(lines.length).toBe(2); // 8s gap forces a break
  });
});

describe('cullOutroThanks', () => {
  it('removes intro + outro "thank you" hallucinations outside the lyric body', () => {
    // body = real lyrics 55..188s; thank-yous at 0/13s and 210..273s are ghosts.
    const w = words(
      '0.0|Thank 12.6|you. 55.7|Talk 59.9|cares. 188.1|hand. ' +
        '210.0|Thank 220.0|you. 230.0|Thank 243.8|you. 257.7|Thank 272.7|you.'
    );
    const { words: kept, removed } = cullOutroThanks(w);
    expect(removed.length).toBe(8);
    expect(kept.map((x) => x.text)).toEqual(['Talk', 'cares.', 'hand.']);
  });

  it('keeps "thank you" sung throughout the body (Alanis "Thank U")', () => {
    let spec = '20.0|How';
    for (let t = 30; t <= 200; t += 20) spec += ` ${t}.0|Thank ${t + 1}.0|you`;
    spec += ' 205.0|India';
    const { kept, removed } = (() => {
      const r = cullOutroThanks(words(spec));
      return { kept: r.words, removed: r.removed };
    })();
    expect(removed.length).toBe(0); // every thank-you is inside the body
    expect(kept.filter((x) => /thank|you/i.test(x.text)).length).toBe(18);
  });

  it('does nothing when there are no non-thanks words to anchor a body', () => {
    const { removed } = cullOutroThanks(words('5.0|Thank 6.0|you'));
    expect(removed.length).toBe(0);
  });
});

// Minimal ISO-BMFF box: 32-bit size + 4-char type + payload.
function box(type, ...children) {
  const payload = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(8 + payload);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4
  );
  let pos = 8;
  for (const c of children) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
// hdlr full box: version/flags (4) + pre_defined (4) + handler type (4) + reserved (12)
const hdlr = (handler) => {
  const body = new Uint8Array(24);
  body.set(
    [...handler].map((c) => c.charCodeAt(0)),
    8
  );
  return box('hdlr', body);
};
const trak = (handler) => box('trak', box('tkhd'), box('mdia', box('mdhd'), hdlr(handler)));
const mp4 = (...traks) => concat(box('ftyp'), box('moov', ...traks), box('mdat'));
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe('mp4HasAudioTrack', () => {
  it('finds a sound track next to a video track', () => {
    expect(mp4HasAudioTrack(mp4(trak('vide'), trak('soun')))).toBe(true);
  });

  it('reports a video-only file', () => {
    expect(mp4HasAudioTrack(mp4(trak('vide')))).toBe(false);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    expect(mp4HasAudioTrack(mp4(trak('soun')).buffer)).toBe(true);
  });

  it('returns null for bytes that are not an MP4 container', () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0]);
    expect(mp4HasAudioTrack(mp3)).toBe(null);
    expect(mp4HasAudioTrack(new Uint8Array(0))).toBe(null);
  });

  it('stops at a box whose size runs past the end instead of throwing', () => {
    const bytes = mp4(trak('vide'));
    new DataView(bytes.buffer).setUint32(0, 0x7fffffff); // corrupt ftyp size
    expect(mp4HasAudioTrack(bytes)).toBe(null);
  });

  it('reads 64-bit box sizes', () => {
    const moov = box('moov', trak('soun'));
    const big = new Uint8Array(moov.length + 8);
    const view = new DataView(big.buffer);
    view.setUint32(0, 1); // size 1 → 64-bit size follows the type
    big.set(
      [...'moov'].map((c) => c.charCodeAt(0)),
      4
    );
    view.setBigUint64(8, BigInt(big.length));
    big.set(moov.subarray(8), 16);
    expect(mp4HasAudioTrack(big)).toBe(true);
  });
});

describe('assertHasAudioTrack', () => {
  it('throws a clear message for a video-only file', () => {
    expect(() => assertHasAudioTrack(mp4(trak('vide')), 'clip.mp4')).toThrow(
      /clip\.mp4 has no audio track/
    );
  });

  it('lets files with audio, and files it cannot read, through to the decoder', () => {
    expect(() => assertHasAudioTrack(mp4(trak('soun')), 'a.mp4')).not.toThrow();
    expect(() => assertHasAudioTrack(new Uint8Array([1, 2, 3]), 'a.wav')).not.toThrow();
  });
});

describe('decodeFailure', () => {
  it('names the file and keeps the decoder reason', () => {
    const err = decodeFailure('song.flac', new Error('Unable to decode audio data'));
    expect(err.message).toMatch(/^Couldn't decode the audio in song\.flac \(Unable to decode/);
    expect(err.message).toMatch(/MP3 or WAV/);
  });

  it('copes with a missing name and reason', () => {
    expect(decodeFailure(undefined, undefined).message).toMatch(
      /^Couldn't decode the audio in this file\./
    );
  });
});
