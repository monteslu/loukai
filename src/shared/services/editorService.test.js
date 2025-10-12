/**
 * Editor Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as editorService from './editorService.js';

// Mock KaiLoader and KaiWriter
vi.mock('../../utils/kaiLoader.js', () => ({
  default: {
    load: vi.fn(),
  },
}));

vi.mock('../../utils/kaiWriter.js', () => ({
  default: {
    save: vi.fn(),
  },
}));

import KaiLoader from '../../utils/kaiLoader.js';
import KaiWriter from '../../utils/kaiWriter.js';

describe('editorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSong', () => {
    it('should load a KAI format song successfully', async () => {
      const mockKaiData = {
        song: {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
        },
        lyrics: [
          { time: 0, text: 'Line 1' },
          { time: 2, text: 'Line 2' },
        ],
      };

      KaiLoader.load.mockResolvedValue(mockKaiData);

      const result = await editorService.loadSong('/music/test.kai');

      expect(result.format).toBe('kai');
      expect(result.kaiData).toBeDefined();
      expect(result.kaiData.song.title).toBe('Test Song');
      expect(result.kaiData.originalFilePath).toBe('/music/test.kai');
      expect(KaiLoader.load).toHaveBeenCalledWith('/music/test.kai');
    });

    it('should throw error when path is missing', async () => {
      await expect(editorService.loadSong('')).rejects.toThrow('Path is required');
      await expect(editorService.loadSong(null)).rejects.toThrow('Path is required');
      expect(KaiLoader.load).not.toHaveBeenCalled();
    });

    it('should detect KAI format from extension', async () => {
      KaiLoader.load.mockResolvedValue({ song: {}, lyrics: [] });

      await editorService.loadSong('/music/song.KAI');
      await editorService.loadSong('/music/song.Kai');
      await editorService.loadSong('/music/song.kai');

      expect(KaiLoader.load).toHaveBeenCalledTimes(3);
    });

    it('should throw error for CDG format', async () => {
      await expect(editorService.loadSong('/music/test.cdg')).rejects.toThrow(
        'CDG format not yet supported in editor'
      );
      expect(KaiLoader.load).not.toHaveBeenCalled();
    });

    it('should throw error for MP3 format', async () => {
      await expect(editorService.loadSong('/music/test.mp3')).rejects.toThrow(
        'CDG format not yet supported in editor'
      );
      expect(KaiLoader.load).not.toHaveBeenCalled();
    });

    it('should handle KaiLoader errors', async () => {
      KaiLoader.load.mockRejectedValue(new Error('File not found'));

      await expect(editorService.loadSong('/music/test.kai')).rejects.toThrow('File not found');
    });
  });

  describe('saveSong', () => {
    const mockKaiData = {
      song: {
        title: 'Original Title',
        artist: 'Original Artist',
        album: 'Original Album',
        year: 2020,
        genre: 'Pop',
        key: 'C',
      },
      lyrics: [
        { time: 0, text: 'Line 1' },
        { time: 2, text: 'Line 2' },
      ],
      originalSongJson: {
        meta: {},
      },
    };

    beforeEach(() => {
      KaiLoader.load.mockResolvedValue(mockKaiData);
      KaiWriter.save.mockResolvedValue({ success: true });
    });

    it('should save metadata updates successfully', async () => {
      const updates = {
        format: 'kai',
        metadata: {
          title: 'New Title',
          artist: 'New Artist',
        },
        lyrics: mockKaiData.lyrics,
      };

      const result = await editorService.saveSong('/music/test.kai', updates);

      expect(result.success).toBe(true);
      expect(KaiLoader.load).toHaveBeenCalledWith('/music/test.kai');
      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          song: expect.objectContaining({
            title: 'New Title',
            artist: 'New Artist',
          }),
        }),
        '/music/test.kai'
      );
    });

    it('should save all metadata fields', async () => {
      const updates = {
        format: 'kai',
        metadata: {
          title: 'New Title',
          artist: 'New Artist',
          album: 'New Album',
          year: 2025,
          genre: 'Rock',
          key: 'D',
        },
        lyrics: mockKaiData.lyrics,
      };

      await editorService.saveSong('/music/test.kai', updates);

      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          song: {
            title: 'New Title',
            artist: 'New Artist',
            album: 'New Album',
            year: 2025,
            genre: 'Rock',
            key: 'D',
          },
        }),
        '/music/test.kai'
      );
    });

    it('should save lyrics updates', async () => {
      const newLyrics = [
        { time: 0, text: 'Updated Line 1' },
        { time: 2, text: 'Updated Line 2' },
        { time: 4, text: 'New Line 3' },
      ];

      const updates = {
        format: 'kai',
        metadata: {},
        lyrics: newLyrics,
      };

      await editorService.saveSong('/music/test.kai', updates);

      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lyrics: newLyrics,
        }),
        '/music/test.kai'
      );
    });

    it('should preserve original lyrics if not provided', async () => {
      const updates = {
        format: 'kai',
        metadata: { title: 'New Title' },
        lyrics: undefined,
      };

      await editorService.saveSong('/music/test.kai', updates);

      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lyrics: mockKaiData.lyrics,
        }),
        '/music/test.kai'
      );
    });

    it('should preserve original metadata fields if not updated', async () => {
      const updates = {
        format: 'kai',
        metadata: { title: 'New Title' },
        lyrics: mockKaiData.lyrics,
      };

      await editorService.saveSong('/music/test.kai', updates);

      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          song: expect.objectContaining({
            title: 'New Title',
            artist: 'Original Artist', // Preserved
            album: 'Original Album', // Preserved
            year: 2020, // Preserved
            genre: 'Pop', // Preserved
            key: 'C', // Preserved
          }),
        }),
        '/music/test.kai'
      );
    });

    it('should save AI correction rejections', async () => {
      const updates = {
        format: 'kai',
        metadata: {
          rejections: [
            {
              line_num: 5,
              start_time: 10.5,
              end_time: 12.0,
              old_text: 'wrong lyric',
              new_text: 'correct lyric',
              reason: 'User correction',
              retention_rate: 0.8,
            },
          ],
        },
        lyrics: mockKaiData.lyrics,
      };

      await editorService.saveSong('/music/test.kai', updates);

      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            corrections: expect.objectContaining({
              rejected: [
                {
                  line: 5,
                  start: 10.5,
                  end: 12.0,
                  old: 'wrong lyric',
                  new: 'correct lyric',
                  reason: 'User correction',
                  word_retention: 0.8,
                },
              ],
            }),
          }),
        }),
        '/music/test.kai'
      );
    });

    it('should save AI correction suggestions', async () => {
      const updates = {
        format: 'kai',
        metadata: {
          suggestions: [
            {
              suggested_text: 'new suggested line',
              start_time: 15.0,
              end_time: 17.5,
              confidence: 0.95,
              reason: 'AI detected missing line',
              pitch_activity: 0.7,
            },
          ],
        },
        lyrics: mockKaiData.lyrics,
      };

      await editorService.saveSong('/music/test.kai', updates);

      expect(KaiWriter.save).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            corrections: expect.objectContaining({
              missing_lines_suggested: [
                {
                  suggested_text: 'new suggested line',
                  start: 15.0,
                  end: 17.5,
                  confidence: 0.95,
                  reason: 'AI detected missing line',
                  pitch_activity: 0.7,
                },
              ],
            }),
          }),
        }),
        '/music/test.kai'
      );
    });

    it('should save both rejections and suggestions', async () => {
      const updates = {
        format: 'kai',
        metadata: {
          rejections: [
            {
              line_num: 5,
              start_time: 10.5,
              end_time: 12.0,
              old_text: 'wrong',
              new_text: 'correct',
              reason: 'User correction',
              retention_rate: 0.8,
            },
          ],
          suggestions: [
            {
              suggested_text: 'new line',
              start_time: 15.0,
              end_time: 17.5,
              confidence: 0.95,
              reason: 'Missing line',
              pitch_activity: 0.7,
            },
          ],
        },
        lyrics: mockKaiData.lyrics,
      };

      await editorService.saveSong('/music/test.kai', updates);

      const saveCall = KaiWriter.save.mock.calls[0][0];
      expect(saveCall.meta.corrections.rejected).toHaveLength(1);
      expect(saveCall.meta.corrections.missing_lines_suggested).toHaveLength(1);
    });

    it('should throw error when path is missing', async () => {
      const updates = { format: 'kai', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('', updates)).rejects.toThrow('Path is required');
      await expect(editorService.saveSong(null, updates)).rejects.toThrow('Path is required');
      expect(KaiWriter.save).not.toHaveBeenCalled();
    });

    it('should throw error for unsupported format', async () => {
      const updates = { format: 'cdg', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.cdg', updates)).rejects.toThrow(
        'Unsupported format: cdg'
      );
      expect(KaiWriter.save).not.toHaveBeenCalled();
    });

    it('should throw error when KaiLoader fails', async () => {
      KaiLoader.load.mockRejectedValue(new Error('Failed to load'));

      const updates = { format: 'kai', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.kai', updates)).rejects.toThrow(
        'Failed to load'
      );
      expect(KaiWriter.save).not.toHaveBeenCalled();
    });

    it('should throw error when KaiWriter fails', async () => {
      KaiWriter.save.mockResolvedValue({ success: false, error: 'Write failed' });

      const updates = { format: 'kai', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.kai', updates)).rejects.toThrow(
        'Write failed'
      );
    });

    it('should throw generic error when KaiWriter fails without error message', async () => {
      KaiWriter.save.mockResolvedValue({ success: false });

      const updates = { format: 'kai', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.kai', updates)).rejects.toThrow(
        'Failed to save KAI file'
      );
    });
  });
});
