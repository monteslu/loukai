/**
 * Creator Service Tests
 *
 * The creator runs entirely in-browser (WebGPU) — no native Python install/convert.
 * These cover the backend-shared bits the service still owns: status, lyric lookup,
 * Whisper context, and file-info.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock external dependencies before importing the service
vi.mock('../../main/creator/systemChecker.js', () => ({
  getCacheDir: vi.fn(() => '/mock/cache/dir'),
}));

vi.mock('../../main/creator/lrclibService.js', () => ({
  searchLyrics: vi.fn(),
  prepareWhisperContext: vi.fn(),
}));

vi.mock('../../main/creator/ffmpegService.js', () => ({
  getAudioInfo: vi.fn(),
  isVideoFile: vi.fn(),
}));

describe('creatorService', () => {
  let creatorService;
  let searchLyrics;
  let prepareWhisperContext;
  let getAudioInfo;
  let isVideoFile;

  beforeEach(async () => {
    vi.resetModules();

    const lrclibService = await import('../../main/creator/lrclibService.js');
    searchLyrics = lrclibService.searchLyrics;
    prepareWhisperContext = lrclibService.prepareWhisperContext;

    const ffmpegService = await import('../../main/creator/ffmpegService.js');
    getAudioInfo = ffmpegService.getAudioInfo;
    isVideoFile = ffmpegService.isVideoFile;

    creatorService = await import('./creatorService.js');
  });

  describe('getStatus', () => {
    it('should return creator status', () => {
      const result = creatorService.getStatus();
      expect(result.converting).toBe(false);
      expect(result.cacheDir).toBe('/mock/cache/dir');
      expect(result.job).toBeDefined();
    });
  });

  describe('findLyrics', () => {
    it('should find lyrics successfully', async () => {
      searchLyrics.mockResolvedValue({
        syncedLyrics: '[00:01.00]Hello world',
        plainLyrics: 'Hello world',
      });

      const result = await creatorService.findLyrics('Test Song', 'Test Artist');

      expect(result.success).toBe(true);
      expect(result.syncedLyrics).toBe('[00:01.00]Hello world');
      expect(result.plainLyrics).toBe('Hello world');
      expect(searchLyrics).toHaveBeenCalledWith('Test Song', 'Test Artist');
    });

    it('should return error when no lyrics found', async () => {
      searchLyrics.mockResolvedValue(null);

      const result = await creatorService.findLyrics('Unknown', 'Unknown');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No lyrics found');
    });

    it('should handle search errors', async () => {
      searchLyrics.mockRejectedValue(new Error('Search failed'));

      const result = await creatorService.findLyrics('Test', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search failed');
    });

    it('should coerce an object title to empty string (no [object Object] query)', async () => {
      searchLyrics.mockResolvedValue(null);

      await creatorService.findLyrics({ no: 1 }, 'Artist');

      expect(searchLyrics).toHaveBeenCalledWith('', 'Artist');
    });
  });

  describe('getWhisperContext', () => {
    it('should prepare whisper context successfully', async () => {
      prepareWhisperContext.mockResolvedValue({
        vocabulary: ['word1', 'word2'],
        prompt: 'context prompt',
      });

      const result = await creatorService.getWhisperContext('Title', 'Artist', 'existing lyrics');

      expect(result.success).toBe(true);
      expect(result.vocabulary).toEqual(['word1', 'word2']);
      expect(prepareWhisperContext).toHaveBeenCalledWith('Title', 'Artist', 'existing lyrics');
    });

    it('should handle context preparation errors', async () => {
      prepareWhisperContext.mockRejectedValue(new Error('Context failed'));

      const result = await creatorService.getWhisperContext('Title', 'Artist', '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Context failed');
    });
  });

  describe('getFileInfo', () => {
    it('should return file info with ID3 tags', async () => {
      getAudioInfo.mockResolvedValue({
        title: 'Song Title',
        artist: 'Artist Name',
        album: 'Album Name',
        duration: 180,
        sampleRate: 44100,
        channels: 2,
        codec: 'mp3',
        tags: { year: '2023' },
      });
      isVideoFile.mockResolvedValue(false);
      searchLyrics.mockResolvedValue({
        syncedLyrics: '[00:01.00]Lyrics',
      });

      const result = await creatorService.getFileInfo('/path/to/song.mp3');

      expect(result.success).toBe(true);
      expect(result.file.title).toBe('Song Title');
      expect(result.file.artist).toBe('Artist Name');
      expect(result.file.album).toBe('Album Name');
      expect(result.file.duration).toBe(180);
      expect(result.file.hasId3Tags).toBe(true);
      expect(result.file.isVideo).toBe(false);
      expect(result.lyrics).toBeDefined();
    });

    it('should parse filename when no ID3 tags', async () => {
      getAudioInfo.mockResolvedValue({
        duration: 180,
        sampleRate: 44100,
        channels: 2,
        codec: 'mp3',
      });
      isVideoFile.mockResolvedValue(false);
      searchLyrics.mockResolvedValue(null);

      const result = await creatorService.getFileInfo('/path/to/Artist Name - Song Title.mp3');

      expect(result.success).toBe(true);
      expect(result.file.title).toBe('Song Title');
      expect(result.file.artist).toBe('Artist Name');
      expect(result.file.hasId3Tags).toBe(false);
    });

    it('should detect video files', async () => {
      getAudioInfo.mockResolvedValue({ duration: 180 });
      isVideoFile.mockResolvedValue(true);

      const result = await creatorService.getFileInfo('/path/to/video.mp4');

      expect(result.file.isVideo).toBe(true);
    });

    it('should handle file info errors', async () => {
      getAudioInfo.mockRejectedValue(new Error('File not found'));

      const result = await creatorService.getFileInfo('/invalid/path.mp3');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });

    it('should continue if lyrics lookup fails', async () => {
      getAudioInfo.mockResolvedValue({
        title: 'Song',
        artist: 'Artist',
        duration: 180,
      });
      isVideoFile.mockResolvedValue(false);
      searchLyrics.mockRejectedValue(new Error('Network error'));

      const result = await creatorService.getFileInfo('/path/to/song.mp3');

      expect(result.success).toBe(true);
      expect(result.lyrics).toBeUndefined();
    });
  });

  describe('default export', () => {
    it('should export the WebGPU-creator service functions', () => {
      expect(creatorService.default).toBeDefined();
      expect(creatorService.default.getStatus).toBeDefined();
      expect(creatorService.default.findLyrics).toBeDefined();
      expect(creatorService.default.getWhisperContext).toBeDefined();
      expect(creatorService.default.getFileInfo).toBeDefined();
      expect(creatorService.default.saveWebGpuStems).toBeDefined();
      expect(creatorService.default.updateStemLyrics).toBeDefined();
    });
  });
});
