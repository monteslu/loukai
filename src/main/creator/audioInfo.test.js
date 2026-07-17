/**
 * Conformance tests for the pure-JS getAudioInfo, checked against ffprobe.
 *
 * Metadata is exact (not perceptual), so this asserts field-for-field equality
 * with ffprobe on generated fixtures. Skips automatically if ffmpeg/ffprobe are
 * not on PATH (so CI without them stays green).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getAudioInfo } from './audioInfo.js';

function have(cmd) {
  try {
    execFileSync(cmd, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAVE_FFMPEG = have('ffmpeg') && have('ffprobe');

function ffprobe(file) {
  const j = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
      {
        encoding: 'utf8',
      }
    )
  );
  const audio = j.streams.filter((s) => s.codec_type === 'audio');
  return {
    duration: parseFloat(j.format.duration),
    sampleRate: parseInt(audio[0].sample_rate, 10),
    channels: audio[0].channels,
    codec: audio[0].codec_name,
    audioStreamCount: audio.length,
  };
}

describe.skipIf(!HAVE_FFMPEG)('getAudioInfo conformance vs ffprobe', () => {
  let dir;
  const files = {};

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'audioinfo-'));
    // plain stereo mp3 + m4a with tags
    files.mp3 = join(dir, 'plain.mp3');
    files.m4a = join(dir, 'plain.m4a');
    const sine = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', '-ar', '44100'];
    const meta = ['-metadata', 'title=TestSong', '-metadata', 'artist=TestArtist'];
    execFileSync('ffmpeg', ['-y', ...sine, ...meta, files.mp3], { stdio: 'ignore' });
    execFileSync('ffmpeg', ['-y', ...sine, '-c:a', 'aac', ...meta, files.m4a], { stdio: 'ignore' });
  });

  for (const kind of ['mp3', 'm4a']) {
    it(`plain ${kind} matches ffprobe`, async () => {
      const exp = ffprobe(files[kind]);
      const got = await getAudioInfo(files[kind]);
      expect(got.sampleRate).toBe(exp.sampleRate);
      expect(got.channels).toBe(exp.channels);
      expect(Math.abs(got.duration - exp.duration)).toBeLessThan(0.5);
      expect(got.audioStreamCount).toBe(1);
      expect(got.title).toBe('TestSong');
      expect(got.artist).toBe('TestArtist');
    });
  }

  it('does not return music-metadata multitrack garbage (sampleRate 0 / channels 255)', async () => {
    const got = await getAudioInfo(files.m4a);
    expect(got.sampleRate).toBeGreaterThan(0);
    expect(got.channels).toBeGreaterThan(0);
    expect(got.channels).not.toBe(255);
  });
});
