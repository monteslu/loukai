import { describe, it, expect } from 'vitest';
import {
  normalizeKaraLines,
  findFirstMainLineIndex,
  findLastMainLineIndex,
  buildRenderTimeline,
  validateLines,
} from './lyricTimeline.js';

// A song that opens with backup-singer chants before the first sung line at 18.4s
// (the shape that exposed the intro bug).
const song = [
  { start: 3.8, end: 4.98, text: 'Oh oh', singer: 'backup:PA' },
  { start: 8.04, end: 9.14, text: 'Oh oh', singer: 'backup:PA' },
  { start: 12.0, end: 13.3, text: 'Oh oh', singer: 'backup:PA' },
  { start: 16.41, end: 17.39, text: 'Oh oh', singer: 'backup:PA' },
  { start: 18.4, end: 22.37, text: 'First verse line' },
  { start: 22.67, end: 26.64, text: 'Second verse line' },
  { start: 26.84, end: 30.85, text: 'Third verse line' },
  { start: 40.0, end: 44.0, text: 'After a long gap' },
  { start: 41.0, end: 42.0, text: 'Oh oh', singer: 'backup:PA' },
];

describe('normalizeKaraLines', () => {
  it('maps kara fields to renderer fields and flags backup singers', () => {
    const lines = normalizeKaraLines(song);
    expect(lines[0]).toMatchObject({
      index: 0,
      startTime: 3.8,
      endTime: 4.98,
      singer: 'backup:PA',
      isBackup: true,
      isDisabled: false,
    });
    expect(lines[4]).toMatchObject({ singer: null, isBackup: false });
  });

  it('honors the legacy backup boolean and disabled flag', () => {
    const lines = normalizeKaraLines([
      { start: 1, end: 2, text: 'a', backup: true },
      { start: 3, end: 4, text: 'b', disabled: true },
    ]);
    expect(lines[0].isBackup).toBe(true);
    expect(lines[0].singer).toBe('backup');
    expect(lines[1].isDisabled).toBe(true);
  });

  it('counts word timings', () => {
    const lines = normalizeKaraLines([
      {
        start: 0,
        end: 1,
        text: 'a b',
        words: {
          timings: [
            [0, 0.4],
            [0.5, 1],
          ],
        },
      },
    ]);
    expect(lines[0].wordCount).toBe(2);
  });

  it('returns an empty list for bad input', () => {
    expect(normalizeKaraLines(null)).toEqual([]);
    expect(normalizeKaraLines('nope')).toEqual([]);
  });
});

describe('findFirstMainLineIndex / findLastMainLineIndex', () => {
  it('skips leading backup lines', () => {
    expect(findFirstMainLineIndex(normalizeKaraLines(song))).toBe(4);
  });

  it('skips disabled lines', () => {
    const lines = normalizeKaraLines([
      { start: 0, end: 1, text: 'off', disabled: true },
      { start: 2, end: 3, text: 'on' },
    ]);
    expect(findFirstMainLineIndex(lines)).toBe(1);
  });

  it('returns -1 when nothing is sung by the lead', () => {
    expect(findFirstMainLineIndex(normalizeKaraLines(song.slice(0, 4)))).toBe(-1);
    expect(findFirstMainLineIndex(null)).toBe(-1);
    expect(findLastMainLineIndex([])).toBe(-1);
  });

  it('finds the last main line past trailing backups', () => {
    expect(findLastMainLineIndex(normalizeKaraLines(song))).toBe(7);
  });
});

describe('buildRenderTimeline', () => {
  it('makes the intro wait for the first sung line and lists the backups inside it', () => {
    const timeline = buildRenderTimeline(normalizeKaraLines(song), 200);
    expect(timeline[0]).toMatchObject({
      type: 'intro',
      start: 0,
      end: 18.4,
      waitingFor: 4,
      showsProgressBar: true,
      backups: [0, 1, 2, 3],
    });
  });

  it('emits sung lines, short gaps without a bar, long gaps with a bar, and the outro', () => {
    const timeline = buildRenderTimeline(normalizeKaraLines(song), 200);
    const types = timeline.map((s) => s.type);
    expect(types).toEqual(['intro', 'line', 'gap', 'line', 'gap', 'line', 'gap', 'line', 'outro']);

    const shortGap = timeline[2];
    expect(shortGap.showsProgressBar).toBe(false);
    expect(shortGap.waitingFor).toBe(5);

    const longGap = timeline[6];
    expect(longGap).toMatchObject({
      start: 30.85,
      end: 40.0,
      showsProgressBar: true,
      waitingFor: 7,
    });

    const lastLine = timeline[7];
    expect(lastLine.backups).toEqual([8]);

    expect(timeline[8]).toMatchObject({ type: 'outro', start: 44.0, end: 200 });
  });

  it('skips the outro when the song ends with the last line', () => {
    const timeline = buildRenderTimeline(normalizeKaraLines(song), 44.0);
    expect(timeline.at(-1).type).toBe('line');
  });

  it('reports a backup-only file', () => {
    const timeline = buildRenderTimeline(normalizeKaraLines(song.slice(0, 4)));
    expect(timeline).toEqual([
      { type: 'no-main-lines', start: 0, end: 17.39, backups: [0, 1, 2, 3] },
    ]);
  });

  it('returns nothing for no lines', () => {
    expect(buildRenderTimeline([])).toEqual([]);
    expect(buildRenderTimeline(null)).toEqual([]);
  });
});

describe('validateLines', () => {
  it('is quiet on clean data', () => {
    expect(validateLines(normalizeKaraLines(song), song)).toEqual([]);
  });

  it('flags bad ranges, ordering, overlap, and empty text', () => {
    const raw = [
      { start: 5, end: 5, text: 'zero length' },
      { start: 2, end: 6, text: 'out of order and overlapping' },
      { start: 7, end: 8, text: '   ' },
    ];
    const warnings = validateLines(normalizeKaraLines(raw), raw);
    expect(warnings.some((w) => w.includes('not after start'))).toBe(true);
    expect(warnings.some((w) => w.includes('out of order'))).toBe(true);
    expect(warnings.some((w) => w.includes('overlaps'))).toBe(true);
    expect(warnings.some((w) => w.includes('empty text'))).toBe(true);
  });

  it('flags word timings that do not match the words or fall outside the line', () => {
    const raw = [
      {
        start: 0,
        end: 2,
        text: 'one two three',
        words: {
          timings: [
            [0, 0.5],
            [0.6, 2.5],
          ],
        },
      },
    ];
    const warnings = validateLines(normalizeKaraLines(raw), raw);
    expect(warnings.some((w) => w.includes('2 word timings for 3 words'))).toBe(true);
    expect(warnings.some((w) => w.includes('outside the line'))).toBe(true);
  });

  it('flags control characters left in the text', () => {
    // A group-separator (0x1d) left behind by an editor, as seen in a real file
    const raw = [{ start: 0, end: 1, text: 'fore' + String.fromCharCode(0x1d) + 'ver' }];
    const warnings = validateLines(normalizeKaraLines(raw), raw);
    expect(warnings).toEqual([expect.stringContaining('U+001d')]);
  });
});
