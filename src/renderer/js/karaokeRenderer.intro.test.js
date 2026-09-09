import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KaraokeRenderer } from './karaokeRenderer.js';

// A song that opens with four backup:PA chants before the first line the
// singer performs at 18.4s.
const lyricsData = [
  { start: 3.8, end: 4.98, text: 'Oh oh', singer: 'backup:PA' },
  { start: 8.04, end: 9.14, text: 'Oh oh', singer: 'backup:PA' },
  { start: 12.0, end: 13.3, text: 'Oh oh', singer: 'backup:PA' },
  { start: 16.41, end: 17.39, text: 'Oh oh', singer: 'backup:PA' },
  { start: 18.4, end: 22.37, text: 'First verse line' },
  { start: 22.67, end: 26.64, text: 'Second verse line' },
];

function makeRenderer(time) {
  const canvas = document.createElement('canvas');
  canvas.id = 'test-canvas';
  canvas.width = 1280;
  canvas.height = 720;
  // jsdom has no 2D context; hand the renderer a permissive stand-in
  canvas.getContext = () =>
    new Proxy(
      {},
      {
        get: (target, key) => (key in target ? target[key] : vi.fn()),
        set: (target, key, value) => {
          target[key] = value;
          return true;
        },
      }
    );
  document.body.appendChild(canvas);
  const renderer = new KaraokeRenderer('test-canvas');
  renderer.lyrics = renderer.parseLyricsData(lyricsData);
  renderer.songDuration = 200;
  renderer.currentTime = time;
  renderer.getInterpolatedTime = () => time;
  return renderer;
}

describe('KaraokeRenderer intro with leading backup lines', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('treats everything before the first sung line as the intro', () => {
    expect(makeRenderer(1).isInInstrumentalIntro()).toBe(true);
    // Inside and after the backup chants, still before the singer's first line
    expect(makeRenderer(4).isInInstrumentalIntro()).toBe(true);
    expect(makeRenderer(17.5).isInInstrumentalIntro()).toBe(true);
    expect(makeRenderer(18.4).isInInstrumentalIntro()).toBe(false);
  });

  it('is not an intro when no line is sung by the lead', () => {
    const renderer = makeRenderer(1);
    renderer.lyrics = renderer.parseLyricsData(lyricsData.slice(0, 4));
    expect(renderer.isInInstrumentalIntro()).toBe(false);
  });

  it('counts the intro progress bar down to the first sung line and previews that line', () => {
    const renderer = makeRenderer(9.2);
    renderer.drawProgressBar = vi.fn();
    renderer.drawUpcomingLyricsPreview = vi.fn();
    renderer.drawActiveLines = vi.fn();
    renderer.startTransitionAnimations = vi.fn();

    renderer.drawInstrumentalIntro(1280, 720);

    const progress = renderer.drawProgressBar.mock.calls[0][4];
    expect(progress).toBeCloseTo(9.2 / 18.4, 5);

    const previewed = renderer.drawUpcomingLyricsPreview.mock.calls[0][0];
    expect(previewed.text).toBe('First verse line');
    expect(previewed.isBackup).toBe(false);

    expect(renderer.lockedUpcomingIndex).toBe(4);
    // Backup chants still get drawn (at the bottom), but the upcoming pass is
    // skipped so the first sung line is not drawn a second time.
    expect(renderer.drawActiveLines).toHaveBeenCalledWith(1280, 720, true);
  });

  it('does not draw the next sung line twice during a backup-only stretch', () => {
    const renderer = makeRenderer(15);
    renderer.drawProgressBar = vi.fn();
    renderer.drawUpcomingLyricsPreview = vi.fn();
    renderer.drawActiveLines = vi.fn();

    renderer.drawBackupOnlyProgressBar(1280, 720);

    expect(renderer.drawUpcomingLyricsPreview).toHaveBeenCalledTimes(1);
    expect(renderer.drawUpcomingLyricsPreview.mock.calls[0][0].text).toBe('First verse line');
    expect(renderer.drawActiveLines).toHaveBeenCalledWith(1280, 720, true);
  });
});
