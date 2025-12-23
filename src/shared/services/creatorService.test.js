/**
 * Creator Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all external dependencies before importing the service
vi.mock('../../main/creator/systemChecker.js', () => ({
  checkAllComponents: vi.fn(),
  getCacheDir: vi.fn(() => '/mock/cache/dir'),
  getPythonPath: vi.fn(() => '/mock/python'),
}));

vi.mock('../../main/creator/downloadManager.js', () => ({
  installAllComponents: vi.fn(),
}));

vi.mock('../../main/creator/lrclibService.js', () => ({
  searchLyrics: vi.fn(),
  prepareWhisperContext: vi.fn(),
}));

vi.mock('../../main/creator/ffmpegService.js', () => ({
  getAudioInfo: vi.fn(),
  isVideoFile: vi.fn(),
}));

vi.mock('../../main/creator/conversionService.js', () => ({
  runConversion: vi.fn(),
  cancelConversion: vi.fn(),
  isConversionInProgress: vi.fn(() => false),
}));

describe('creatorService', () => {
  let creatorService;
  let checkAllComponents;
  let getCacheDir;
  let getPythonPath;
  let installAllComponents;
  let searchLyrics;
  let prepareWhisperContext;
  let getAudioInfo;
  let isVideoFile;
  let runConversion;
  let cancelConversion;
  let isConversionInProgress;

  beforeEach(async () => {
    // Reset modules to clear module-level state (installationInProgress, etc.)
    vi.resetModules();

    // Re-import mocks and service fresh
    const systemChecker = await import('../../main/creator/systemChecker.js');
    checkAllComponents = systemChecker.checkAllComponents;
    getCacheDir = systemChecker.getCacheDir;
    getPythonPath = systemChecker.getPythonPath;

    const downloadManager = await import('../../main/creator/downloadManager.js');
    installAllComponents = downloadManager.installAllComponents;

    const lrclibService = await import('../../main/creator/lrclibService.js');
    searchLyrics = lrclibService.searchLyrics;
    prepareWhisperContext = lrclibService.prepareWhisperContext;

    const ffmpegService = await import('../../main/creator/ffmpegService.js');
    getAudioInfo = ffmpegService.getAudioInfo;
    isVideoFile = ffmpegService.isVideoFile;

    const conversionService = await import('../../main/creator/conversionService.js');
    runConversion = conversionService.runConversion;
    cancelConversion = conversionService.cancelConversion;
    isConversionInProgress = conversionService.isConversionInProgress;

    // Import fresh service
    creatorService = await import('./creatorService.js');

    // Reset conversion state mock
    isConversionInProgress.mockReturnValue(false);
  });

  describe('checkComponents', () => {
    it('should return component status successfully', async () => {
      checkAllComponents.mockResolvedValue({
        ffmpeg: { installed: true },
        python: { installed: true },
        whisper: { installed: true },
      });

      const result = await creatorService.checkComponents();

      expect(result.success).toBe(true);
      expect(result.ffmpeg).toEqual({ installed: true });
      expect(result.python).toEqual({ installed: true });
      expect(result.whisper).toEqual({ installed: true });
    });

    it('should handle check errors', async () => {
      checkAllComponents.mockRejectedValue(new Error('Check failed'));

      const result = await creatorService.checkComponents();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Check failed');
    });
  });

  describe('getStatus', () => {
    it('should return installation status', () => {
      isConversionInProgress.mockReturnValue(false);

      const result = creatorService.getStatus();

      expect(result.installing).toBe(false);
      expect(result.cancelled).toBe(false);
      expect(result.converting).toBe(false);
      expect(result.cacheDir).toBe('/mock/cache/dir');
      expect(result.pythonPath).toBe('/mock/python');
    });

    it('should reflect conversion in progress', () => {
      isConversionInProgress.mockReturnValue(true);

      const result = creatorService.getStatus();

      expect(result.converting).toBe(true);
    });
  });

  describe('installComponents', () => {
    it('should install components successfully', async () => {
      installAllComponents.mockImplementation(async (progressCallback) => {
        progressCallback(50, 'Installing...');
        progressCallback(100, 'Done');
        return { success: true };
      });

      const onProgress = vi.fn();
      const result = await creatorService.installComponents(onProgress);

      expect(result.success).toBe(true);
      expect(onProgress).toHaveBeenCalledWith({
        step: 'starting',
        message: 'Starting installation...',
        progress: 0,
      });
      expect(onProgress).toHaveBeenCalledWith({
        step: 'complete',
        message: 'Installation complete',
        progress: 100,
      });
    });

    it('should handle installation errors', async () => {
      installAllComponents.mockRejectedValue(new Error('Install failed'));

      const onProgress = vi.fn();
      const result = await creatorService.installComponents(onProgress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Install failed');
    });

    it('should prevent concurrent installations', async () => {
      // Start first installation (won't resolve)
      installAllComponents.mockImplementation(() => new Promise(() => {}));
      creatorService.installComponents(vi.fn());

      // Try to start second
      const result = await creatorService.installComponents(vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Installation already in progress');
    });
  });

  describe('cancelInstall', () => {
    it('should return error when no installation in progress', () => {
      const result = creatorService.cancelInstall();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No installation in progress');
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

  describe('startConversion', () => {
    it('should start conversion successfully', async () => {
      runConversion.mockImplementation(async (options, progressCb) => {
        progressCb('processing', 'Processing...', 50);
        return { success: true, outputPath: '/output/file.m4a' };
      });

      const onProgress = vi.fn();
      const result = await creatorService.startConversion({ inputPath: '/input.mp3' }, onProgress);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBe('/output/file.m4a');
      expect(onProgress).toHaveBeenCalledWith({
        step: 'starting',
        message: 'Starting conversion...',
        progress: 0,
      });
    });

    it('should prevent concurrent conversions', async () => {
      isConversionInProgress.mockReturnValue(true);

      const result = await creatorService.startConversion({}, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Conversion already in progress');
    });

    it('should handle conversion errors', async () => {
      runConversion.mockRejectedValue(new Error('Conversion failed'));

      const result = await creatorService.startConversion({}, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Conversion failed');
    });

    it('should pass console output callback', async () => {
      const onConsoleOutput = vi.fn();
      runConversion.mockResolvedValue({ success: true });

      await creatorService.startConversion({}, vi.fn(), onConsoleOutput);

      expect(runConversion).toHaveBeenCalledWith({}, expect.any(Function), onConsoleOutput, null);
    });

    it('should pass settings manager', async () => {
      const settingsManager = { get: vi.fn() };
      runConversion.mockResolvedValue({ success: true });

      await creatorService.startConversion({}, vi.fn(), null, settingsManager);

      expect(runConversion).toHaveBeenCalledWith({}, expect.any(Function), null, settingsManager);
    });
  });

  describe('stopConversion', () => {
    it('should stop conversion', () => {
      cancelConversion.mockReturnValue(true);

      const result = creatorService.stopConversion();

      expect(result.success).toBe(true);
      expect(cancelConversion).toHaveBeenCalled();
    });

    it('should return false when cancel fails', () => {
      cancelConversion.mockReturnValue(false);

      const result = creatorService.stopConversion();

      expect(result.success).toBe(false);
    });
  });

  describe('default export', () => {
    it('should export all functions', () => {
      expect(creatorService.default).toBeDefined();
      expect(creatorService.default.checkComponents).toBeDefined();
      expect(creatorService.default.getStatus).toBeDefined();
      expect(creatorService.default.installComponents).toBeDefined();
      expect(creatorService.default.cancelInstall).toBeDefined();
      expect(creatorService.default.findLyrics).toBeDefined();
      expect(creatorService.default.getWhisperContext).toBeDefined();
      expect(creatorService.default.getFileInfo).toBeDefined();
      expect(creatorService.default.startConversion).toBeDefined();
      expect(creatorService.default.stopConversion).toBeDefined();
    });
  });
});
