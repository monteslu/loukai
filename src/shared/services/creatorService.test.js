/**
 * Creator Service Tests
 *
 * The creator runs entirely in-browser (WebGPU) — no native Python install/convert.
 * These cover the backend-shared bits the service still owns: status, lyric lookup,
 * Whisper context, and file-info.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock external dependencies before importing the service
vi.mock('../../main/creator/systemChecker.js', () => ({
  getCacheDir: vi.fn(() => '/mock/cache/dir'),
}));

vi.mock('../../main/creator/lrclibService.js', () => ({
  searchLyrics: vi.fn(),
  prepareWhisperContext: vi.fn(),
}));

vi.mock('../../main/creator/audioInfo.js', () => ({
  getAudioInfo: vi.fn(),
  isVideoFile: vi.fn(),
}));

vi.mock('../../main/creator/stemBuilder.js', () => ({
  repairStemFile: vi.fn(),
  repairStemFiles: vi.fn(),
}));

vi.mock('../../main/creator/llmService.js', () => ({
  getLLMSettingsRaw: vi.fn(),
  correctLyrics: vi.fn(),
}));

vi.mock('stem-mp4', () => ({
  StemMp4Writer: { write: vi.fn() },
  Atoms: {
    readKaraAtom: vi.fn(),
    writeKaraAtom: vi.fn(),
    addMusicalKey: vi.fn(),
    writeVpchAtom: vi.fn(),
  },
}));

describe('creatorService', () => {
  let creatorService;
  let searchLyrics;
  let prepareWhisperContext;
  let getAudioInfo;
  let isVideoFile;
  let repairStemFile;
  let repairStemFiles;
  let llmService;
  let Atoms;
  let StemMp4Writer;
  let creatorJob;
  let dir;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'creator-service-'));
    vi.resetModules();

    const lrclibService = await import('../../main/creator/lrclibService.js');
    searchLyrics = lrclibService.searchLyrics;
    prepareWhisperContext = lrclibService.prepareWhisperContext;

    const audioInfo = await import('../../main/creator/audioInfo.js');
    getAudioInfo = audioInfo.getAudioInfo;
    isVideoFile = audioInfo.isVideoFile;

    const stemBuilder = await import('../../main/creator/stemBuilder.js');
    repairStemFile = stemBuilder.repairStemFile;
    repairStemFiles = stemBuilder.repairStemFiles;

    llmService = await import('../../main/creator/llmService.js');
    ({ Atoms, StemMp4Writer } = await import('stem-mp4'));
    creatorJob = await import('../../main/creator/creatorJob.js');

    creatorService = await import('./creatorService.js');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
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

  describe('repairStem', () => {
    it('returns the repair result on success', async () => {
      repairStemFile.mockResolvedValue({ success: true, repaired: true });
      const result = await creatorService.repairStem('/songs/x.stem.mp4');
      expect(repairStemFile).toHaveBeenCalledWith('/songs/x.stem.mp4');
      expect(result).toEqual({ success: true, repaired: true });
    });

    it('returns a structured error when the repair throws', async () => {
      repairStemFile.mockRejectedValue(new Error('bad atom'));
      const result = await creatorService.repairStem('/songs/x.stem.mp4');
      expect(result).toEqual({ success: false, error: 'bad atom' });
    });
  });

  describe('repairStems', () => {
    it('returns batch results on success', async () => {
      repairStemFiles.mockResolvedValue({ success: true, repaired: 2 });
      const result = await creatorService.repairStems(['/a.stem.mp4', '/b.stem.mp4']);
      expect(repairStemFiles).toHaveBeenCalledWith(['/a.stem.mp4', '/b.stem.mp4']);
      expect(result).toEqual({ success: true, repaired: 2 });
    });

    it('returns a structured error when the batch throws', async () => {
      repairStemFiles.mockRejectedValue(new Error('batch failed'));
      const result = await creatorService.repairStems(['/a.stem.mp4']);
      expect(result).toEqual({ success: false, error: 'batch failed' });
    });
  });

  describe('getStatus while a save is running', () => {
    it('reports converting and the live job', () => {
      creatorJob.startJob({ title: 'T', artist: 'A', startedAt: 1 });
      const status = creatorService.getStatus();
      expect(status.converting).toBe(true);
      expect(status.job).toMatchObject({ status: 'running', title: 'T', artist: 'A' });
    });
  });

  describe('getFileInfo stem detection', () => {
    const streams = (names) => names.map((title, index) => ({ title, index }));

    it('reports stems, the vocals track and existing lyrics for a stem file', async () => {
      getAudioInfo.mockResolvedValue({
        title: 'T',
        audioStreamCount: 5,
        audioStreams: streams(['master', 'drums', 'bass', 'other', 'Vocals']),
      });
      isVideoFile.mockResolvedValue(false);
      Atoms.readKaraAtom.mockResolvedValue({ lines: [{ text: 'x' }] });

      const { file } = await creatorService.getFileInfo('/lib/Song.STEM.MP4');

      expect(file.hasStems).toBe(true);
      expect(file.stemNames).toEqual(['master', 'drums', 'bass', 'other', 'Vocals']);
      expect(file.vocalsTrackIndex).toBe(4);
      expect(file.hasLyrics).toBe(true);
    });

    it('treats a missing kara atom as a stem file without lyrics', async () => {
      getAudioInfo.mockResolvedValue({
        audioStreamCount: 4,
        audioStreams: streams(['drums', 'bass', 'other', 'lead']),
      });
      isVideoFile.mockResolvedValue(false);
      Atoms.readKaraAtom.mockRejectedValue(new Error('no kara'));

      const { file } = await creatorService.getFileInfo('/lib/song.m4a');

      expect(file.hasStems).toBe(true);
      expect(file.vocalsTrackIndex).toBe(null);
      expect(file.hasLyrics).toBe(false);
    });

    it('does not look for stems in formats that cannot hold them', async () => {
      getAudioInfo.mockResolvedValue({ audioStreamCount: 5, audioStreams: streams(['a']) });
      isVideoFile.mockResolvedValue(false);

      const { file } = await creatorService.getFileInfo('/lib/song.mp3');

      expect(file.hasStems).toBe(false);
      expect(Atoms.readKaraAtom).not.toHaveBeenCalled();
    });

    it('does not report lyrics when the kara atom has no lines', async () => {
      getAudioInfo.mockResolvedValue({
        audioStreamCount: 5,
        audioStreams: streams(['master', 'drums', 'bass', 'other', 'vocals']),
      });
      isVideoFile.mockResolvedValue(false);
      Atoms.readKaraAtom.mockResolvedValue({ lines: [] });

      const { file } = await creatorService.getFileInfo('/lib/song.mp4');

      expect(file.hasStems).toBe(true);
      expect(file.hasLyrics).toBe(false);
    });
  });

  describe('saveWebGpuStems', () => {
    const STEMS = ['master', 'drums', 'bass', 'other', 'vocals'];
    let stems;
    const lines = [{ start: 1, end: 2, text: 'raw line' }];
    const words = [{ start: 1, end: 1.5, text: 'raw' }];

    beforeEach(() => {
      stems = {};
      for (const k of STEMS) {
        stems[k] = join(dir, `${k}.m4a`);
        writeFileSync(stems[k], `aac-${k}`);
      }
      StemMp4Writer.write.mockResolvedValue(undefined);
    });

    const save = (overrides = {}) =>
      creatorService.saveWebGpuStems({
        stems,
        metadata: { title: 'Title', artist: 'Artist' },
        lyrics: { lines, words },
        songsFolder: dir,
        ...overrides,
      });

    it('requires a songs folder', async () => {
      await expect(save({ songsFolder: '' })).rejects.toThrow('songs folder is not set');
    });

    it('refuses to start while another creation is running', async () => {
      creatorJob.startJob({ title: 'Other', startedAt: 1 });

      const err = await save().catch((e) => e);

      expect(err.message).toBe('A creation is already in progress');
      expect(err.busy).toBe(true);
      expect(err.job.title).toBe('Other');
      expect(StemMp4Writer.write).not.toHaveBeenCalled();
    });

    it('muxes the encoded stems into the library and completes the job', async () => {
      const result = await save({
        metadata: {
          title: 'Why: Not/Now?',
          artist: 'A|B',
          album: 'Al',
          year: 1999,
          genre: 'Rock',
          track: 3,
          disk: 1,
          albumartist: 'AA',
          composer: 'C',
          tempo: 120,
        },
        source: 'web',
      });

      const expectedPath = join(dir, 'A_B - Why_ Not_Now_.stem.mp4');
      expect(result).toEqual({
        outputPath: expectedPath,
        fileName: 'A_B - Why_ Not_Now_.stem.mp4',
        llmStats: null,
      });
      const args = StemMp4Writer.write.mock.calls[0][0];
      expect(args.outputPath).toBe(expectedPath);
      expect(args.mixdownAac.toString()).toBe('aac-master');
      for (const k of ['drums', 'bass', 'other', 'vocals']) {
        expect(args.stemsAac[k].toString()).toBe(`aac-${k}`);
      }
      expect(args.metadata).toEqual({
        title: 'Why: Not/Now?',
        artist: 'A|B',
        album: 'Al',
        year: 1999,
        genre: 'Rock',
        track: 3,
        disk: 1,
        albumartist: 'AA',
        composer: 'C',
        tempo: 120,
      });
      expect(args.lyricsData).toEqual({ lines });
      expect(args.encoderDelaySamples).toBe(1024);
      expect(creatorJob.getJob()).toMatchObject({
        status: 'complete',
        outputPath: expectedPath,
        source: 'web',
        progress: 100,
      });
    });

    it('falls back to Untitled/Unknown and writes no lyrics when there are none', async () => {
      const result = await save({ metadata: undefined, lyrics: undefined });

      expect(result.fileName).toBe('Unknown - Untitled.stem.mp4');
      const args = StemMp4Writer.write.mock.calls[0][0];
      expect(args.metadata).toEqual({ title: 'Untitled', artist: 'Unknown' });
      expect(args.lyricsData).toBeUndefined();
    });

    it('names the file by title alone when the artist is empty', async () => {
      const result = await save({ metadata: { title: 'Solo', artist: '' } });
      expect(result.fileName).toBe('Solo.stem.mp4');
    });

    it('marks the job as errored and rethrows when muxing fails', async () => {
      StemMp4Writer.write.mockRejectedValue(new Error('disk full'));

      await expect(save()).rejects.toThrow('disk full');

      expect(creatorJob.getJob()).toMatchObject({ status: 'error', error: 'disk full' });
    });

    describe('LLM lyric correction', () => {
      const settingsManager = {};
      const corrected = [{ start: 1, end: 2, text: 'fixed line' }];

      beforeEach(() => {
        llmService.getLLMSettingsRaw.mockReturnValue({
          enabled: true,
          provider: 'openai',
          apiKey: 'k',
        });
        llmService.correctLyrics.mockResolvedValue({
          output: { lines: corrected },
          stats: { corrections_applied: 1 },
        });
      });

      it('corrects against the given reference lyrics and reports the steps', async () => {
        const steps = [];
        creatorJob.onChange((job) => steps.push(job.step));

        const result = await save({ settingsManager, referenceLyrics: '  the reference  ' });

        expect(searchLyrics).not.toHaveBeenCalled();
        expect(llmService.correctLyrics).toHaveBeenCalledWith(
          { lines, words },
          'the reference',
          expect.objectContaining({ enabled: true })
        );
        expect(StemMp4Writer.write.mock.calls[0][0].lyricsData).toEqual({ lines: corrected });
        expect(result.llmStats).toEqual({ corrections_applied: 1 });
        expect(steps).toEqual(expect.arrayContaining(['correcting', 'muxing', 'complete']));
      });

      it('looks up reference lyrics on LRCLIB when none were given', async () => {
        searchLyrics.mockResolvedValue({ plainLyrics: 'looked up' });

        await save({ settingsManager });

        expect(searchLyrics).toHaveBeenCalledWith('Title', 'Artist');
        expect(llmService.correctLyrics.mock.calls[0][1]).toBe('looked up');
      });

      it('skips correction when no reference lyrics can be found', async () => {
        searchLyrics.mockResolvedValue(null);

        const result = await save({ settingsManager });

        expect(llmService.correctLyrics).not.toHaveBeenCalled();
        expect(StemMp4Writer.write.mock.calls[0][0].lyricsData).toEqual({ lines });
        expect(result.llmStats).toBe(null);
      });

      it('skips correction when the LLM is disabled', async () => {
        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: false, apiKey: 'k' });
        await save({ settingsManager, referenceLyrics: 'ref' });
        expect(llmService.correctLyrics).not.toHaveBeenCalled();
      });

      it('skips correction for a cloud provider with no API key', async () => {
        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: true, provider: 'openai' });
        await save({ settingsManager, referenceLyrics: 'ref' });
        expect(llmService.correctLyrics).not.toHaveBeenCalled();
      });

      it('runs a local LM Studio server without an API key', async () => {
        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: true, provider: 'lmstudio' });
        await save({ settingsManager, referenceLyrics: 'ref' });
        expect(llmService.correctLyrics).toHaveBeenCalled();
      });

      it('keeps the raw transcription when the LLM returns no lines', async () => {
        llmService.correctLyrics.mockResolvedValue({ output: { lines: [] }, stats: {} });

        const result = await save({ settingsManager, referenceLyrics: 'ref' });

        expect(StemMp4Writer.write.mock.calls[0][0].lyricsData).toEqual({ lines });
        expect(result.llmStats).toBe(null);
      });

      it('keeps the raw transcription and still saves when the LLM fails', async () => {
        llmService.correctLyrics.mockRejectedValue(new Error('rate limited'));

        const result = await save({ settingsManager, referenceLyrics: 'ref' });

        expect(StemMp4Writer.write.mock.calls[0][0].lyricsData).toEqual({ lines });
        expect(result.llmStats).toBe(null);
        expect(creatorJob.getJob().status).toBe('complete');
      });

      it('does not run the LLM when there are no lyric lines', async () => {
        await save({ settingsManager, referenceLyrics: 'ref', lyrics: { lines: [] } });
        expect(llmService.correctLyrics).not.toHaveBeenCalled();
      });
    });

    describe('extra atoms after the mux', () => {
      it('merges chords into the kara atom and writes key and pitch', async () => {
        Atoms.readKaraAtom.mockResolvedValue({ lines, singers: ['s'] });
        const chords = [{ time: 0, chord: 'C' }];
        const pitch = { data: [1, 2, 3] };

        await save({ chords, pitch, metadata: { title: 'T', artist: 'A', key: 'Am' } });

        const out = join(dir, 'A - T.stem.mp4');
        expect(Atoms.writeKaraAtom).toHaveBeenCalledWith(out, { lines, singers: ['s'], chords });
        expect(Atoms.addMusicalKey).toHaveBeenCalledWith(out, 'Am');
        expect(Atoms.writeVpchAtom).toHaveBeenCalledWith(out, pitch);
      });

      it('skips chords, key and an empty pitch track when there are none', async () => {
        await save({ chords: [], pitch: { data: [] } });

        expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
        expect(Atoms.addMusicalKey).not.toHaveBeenCalled();
        expect(Atoms.writeVpchAtom).not.toHaveBeenCalled();
      });

      it('keeps the saved file when chord, key or pitch writes fail', async () => {
        Atoms.readKaraAtom.mockRejectedValue(new Error('bad kara'));
        Atoms.addMusicalKey.mockRejectedValue(new Error('bad key'));
        Atoms.writeVpchAtom.mockRejectedValue(new Error('bad pitch'));

        const result = await save({
          chords: [{ time: 0, chord: 'C' }],
          pitch: { data: [1] },
          metadata: { title: 'T', artist: 'A', key: 'C' },
        });

        expect(result.fileName).toBe('A - T.stem.mp4');
        expect(creatorJob.getJob().status).toBe('complete');
      });
    });

    describe('when the caller owns the job (manageJob: false)', () => {
      it('saves inside the running job without starting, stepping or finishing it', async () => {
        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: true, apiKey: 'k' });
        llmService.correctLyrics.mockResolvedValue({ output: { lines }, stats: {} });
        creatorJob.startJob({ title: 'Host create', startedAt: 1 });
        creatorJob.updateProgress({ step: 'transcribing', progress: 80 });

        const result = await save({
          manageJob: false,
          settingsManager: {},
          referenceLyrics: 'ref',
        });

        expect(result.fileName).toBe('Artist - Title.stem.mp4');
        expect(creatorJob.getJob()).toMatchObject({
          status: 'running',
          title: 'Host create',
          step: 'transcribing',
          progress: 80,
        });
      });

      it('leaves the job alone when the save fails', async () => {
        creatorJob.startJob({ title: 'Host create', startedAt: 1 });
        StemMp4Writer.write.mockRejectedValue(new Error('boom'));

        await expect(save({ manageJob: false })).rejects.toThrow('boom');

        expect(creatorJob.getJob().status).toBe('running');
      });
    });
  });

  describe('updateStemLyrics', () => {
    let file;
    const lines = [{ start: 0, end: 1, text: 'new line' }];

    beforeEach(() => {
      file = join(dir, 'Song.stem.mp4');
      writeFileSync(file, 'stem');
    });

    it('rejects a missing or nonexistent file', async () => {
      await expect(creatorService.updateStemLyrics({})).rejects.toThrow('stem file not found');
      await expect(
        creatorService.updateStemLyrics({ inputPath: join(dir, 'nope.stem.mp4') })
      ).rejects.toThrow('stem file not found');
    });

    it('replaces the lines but keeps the rest of the kara atom', async () => {
      Atoms.readKaraAtom.mockResolvedValue({
        lines: [{ text: 'old' }],
        singers: ['a'],
        chords: [{ chord: 'G' }],
      });

      const result = await creatorService.updateStemLyrics({ inputPath: file, lyrics: { lines } });

      expect(Atoms.writeKaraAtom).toHaveBeenCalledWith(file, {
        lines,
        singers: ['a'],
        chords: [{ chord: 'G' }],
      });
      expect(result).toEqual({ outputPath: file, fileName: 'Song.stem.mp4' });
    });

    it('writes just the lines when the file has no kara atom yet', async () => {
      Atoms.readKaraAtom.mockRejectedValue(new Error('none'));
      await creatorService.updateStemLyrics({ inputPath: file, lyrics: { lines } });
      expect(Atoms.writeKaraAtom).toHaveBeenCalledWith(file, { lines });
    });

    it('updates key and pitch without touching lyrics', async () => {
      const pitch = { data: [1] };
      await creatorService.updateStemLyrics({ inputPath: file, key: 'D', pitch });

      expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
      expect(Atoms.addMusicalKey).toHaveBeenCalledWith(file, 'D');
      expect(Atoms.writeVpchAtom).toHaveBeenCalledWith(file, pitch);
    });

    it('does not fail when the key or pitch write fails', async () => {
      Atoms.addMusicalKey.mockRejectedValue(new Error('k'));
      Atoms.writeVpchAtom.mockRejectedValue(new Error('p'));

      await expect(
        creatorService.updateStemLyrics({ inputPath: file, key: 'D', pitch: { data: [1] } })
      ).resolves.toEqual({ outputPath: file, fileName: 'Song.stem.mp4' });
    });
  });

  describe('importStemFile', () => {
    let tmpPath;
    let songsFolder;
    const kara = {
      lines: [{ start: 0, end: 1, text: 'orig' }],
      words: [{ start: 0, end: 0.5, text: 'orig' }],
      singers: ['lead'],
      chords: [{ time: 0, chord: 'E' }],
    };

    beforeEach(() => {
      tmpPath = join(dir, 'upload.tmp');
      writeFileSync(tmpPath, 'stem-bytes');
      songsFolder = join(dir, 'songs');
      mkdirSync(songsFolder);
      getAudioInfo.mockResolvedValue({ audioStreamCount: 5, title: 'Title', artist: 'Artist' });
      Atoms.readKaraAtom.mockResolvedValue(kara);
    });

    const importIt = (overrides = {}) =>
      creatorService.importStemFile({ tmpPath, songsFolder, correctLyrics: false, ...overrides });

    it('requires a songs folder and an uploaded file', async () => {
      await expect(importIt({ songsFolder: '' })).rejects.toThrow('songs folder is not set');
      await expect(importIt({ tmpPath: join(dir, 'missing') })).rejects.toThrow(
        'uploaded file not found'
      );
    });

    it('rejects a file it cannot read as MP4', async () => {
      getAudioInfo.mockRejectedValue(new Error('bad box'));
      await expect(importIt()).rejects.toThrow('not a readable MP4: bad box');
    });

    it('rejects a single-track file', async () => {
      getAudioInfo.mockResolvedValue({ audioStreamCount: 1 });
      await expect(importIt()).rejects.toThrow('not a stem file');
    });

    it('rejects a stem file without karaoke lyrics', async () => {
      Atoms.readKaraAtom.mockRejectedValue(new Error('none'));
      await expect(importIt()).rejects.toThrow('no karaoke metadata');

      Atoms.readKaraAtom.mockResolvedValue({ lines: [] });
      await expect(importIt()).rejects.toThrow('no karaoke metadata');
    });

    it('copies the file into the library named from its tags', async () => {
      const result = await importIt();

      const out = join(songsFolder, 'Artist - Title.stem.mp4');
      expect(result).toEqual({
        success: true,
        fileName: 'Artist - Title.stem.mp4',
        outputPath: out,
        hadKaraoke: true,
        corrected: false,
        llmStats: null,
      });
      expect(readFileSync(out, 'utf8')).toBe('stem-bytes');
      expect(searchLyrics).not.toHaveBeenCalled();
    });

    it('names the file by title alone, then by the upload name, then "imported"', async () => {
      getAudioInfo.mockResolvedValue({ audioStreamCount: 5, title: 'Only Title' });
      expect((await importIt()).fileName).toBe('Only Title.stem.mp4');

      getAudioInfo.mockResolvedValue({ audioStreamCount: 5 });
      expect((await importIt({ originalName: 'From: Upload.stem.mp4' })).fileName).toBe(
        'From_ Upload.stem.mp4'
      );
      expect((await importIt()).fileName).toBe('imported.stem.mp4');
      expect(existsSync(join(songsFolder, 'imported.stem.mp4'))).toBe(true);
    });

    describe('with lyric correction', () => {
      const corrected = [{ start: 0, end: 1, text: 'fixed' }];

      beforeEach(() => {
        searchLyrics.mockResolvedValue({ plainLyrics: 'reference' });
        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: true, provider: 'lmstudio' });
        llmService.correctLyrics.mockResolvedValue({
          output: { lines: corrected },
          stats: { corrections_applied: 1 },
        });
      });

      const correctIt = () => importIt({ correctLyrics: true, settingsManager: {} });

      it('rewrites the lines and keeps word timing, singers and chords', async () => {
        const result = await correctIt();

        expect(llmService.correctLyrics).toHaveBeenCalledWith(
          { lines: kara.lines, words: kara.words },
          'reference',
          expect.any(Object)
        );
        expect(Atoms.writeKaraAtom).toHaveBeenCalledWith(result.outputPath, {
          ...kara,
          lines: corrected,
        });
        expect(result.corrected).toBe(true);
        expect(result.llmStats).toEqual({ corrections_applied: 1 });
      });

      it('leaves the lyrics alone without reference lyrics or an enabled LLM', async () => {
        searchLyrics.mockResolvedValue({ plainLyrics: '   ' });
        expect((await correctIt()).corrected).toBe(false);

        searchLyrics.mockResolvedValue({ plainLyrics: 'reference' });
        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: false });
        expect((await correctIt()).corrected).toBe(false);

        llmService.getLLMSettingsRaw.mockReturnValue({ enabled: true, provider: 'openai' });
        expect((await correctIt()).corrected).toBe(false);

        expect(llmService.correctLyrics).not.toHaveBeenCalled();
        expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
      });

      it('keeps the original lyrics when the LLM returns nothing or fails', async () => {
        llmService.correctLyrics.mockResolvedValue({ output: { lines: [] } });
        expect((await correctIt()).corrected).toBe(false);

        llmService.correctLyrics.mockRejectedValue(new Error('timeout'));
        const result = await correctIt();
        expect(result.success).toBe(true);
        expect(result.corrected).toBe(false);
        expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
      });

      it('skips correction for a file with no title tag', async () => {
        getAudioInfo.mockResolvedValue({ audioStreamCount: 5, artist: 'Artist' });
        await correctIt();
        expect(searchLyrics).not.toHaveBeenCalled();
      });
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
