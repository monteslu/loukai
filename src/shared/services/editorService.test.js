/**
 * Editor Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as editorService from './editorService.js';

// Mock M4ALoader and m4a-stems Atoms
vi.mock('../../utils/m4aLoader.js', () => ({
  default: {
    load: vi.fn(),
  },
}));

vi.mock('m4a-stems', () => ({
  Atoms: {
    writeKaraAtom: vi.fn(),
    addStandardMetadata: vi.fn(),
    writeVpchAtom: vi.fn(),
    writeKonsAtom: vi.fn(),
    addMusicalKey: vi.fn(),
  },
}));

import M4ALoader from '../../utils/m4aLoader.js';
import { Atoms } from 'm4a-stems';

describe('editorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSong', () => {
    it('should load an M4A format song successfully', async () => {
      const mockM4AData = {
        metadata: {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
        },
        lyrics: [
          { start: 0, end: 2, text: 'Line 1' },
          { start: 2, end: 4, text: 'Line 2' },
        ],
        audio: {
          sources: [],
        },
      };

      M4ALoader.load.mockResolvedValue(mockM4AData);

      const result = await editorService.loadSong('/music/test.m4a');

      expect(result.format).toBe('m4a-stems');
      expect(result.kaiData).toBeDefined();
      expect(result.kaiData.metadata.title).toBe('Test Song');
      expect(result.kaiData.originalFilePath).toBe('/music/test.m4a');
      expect(M4ALoader.load).toHaveBeenCalledWith('/music/test.m4a');
    });

    it('should load MP4 files as M4A format', async () => {
      const mockM4AData = {
        metadata: { title: 'Test' },
        lyrics: [],
        audio: { sources: [] },
      };

      M4ALoader.load.mockResolvedValue(mockM4AData);

      const result = await editorService.loadSong('/music/test.mp4');

      expect(result.format).toBe('m4a-stems');
      expect(M4ALoader.load).toHaveBeenCalledWith('/music/test.mp4');
    });

    it('should throw error when path is missing', async () => {
      await expect(editorService.loadSong('')).rejects.toThrow('Path is required');
      await expect(editorService.loadSong(null)).rejects.toThrow('Path is required');
      expect(M4ALoader.load).not.toHaveBeenCalled();
    });

    it('should throw error for CDG format', async () => {
      await expect(editorService.loadSong('/music/test.cdg')).rejects.toThrow(
        'Only M4A stems format is supported for editing'
      );
      expect(M4ALoader.load).not.toHaveBeenCalled();
    });

    it('should throw error for MP3 format', async () => {
      await expect(editorService.loadSong('/music/test.mp3')).rejects.toThrow(
        'Only M4A stems format is supported for editing'
      );
      expect(M4ALoader.load).not.toHaveBeenCalled();
    });

    it('should handle M4ALoader errors', async () => {
      M4ALoader.load.mockRejectedValue(new Error('File not found'));

      await expect(editorService.loadSong('/music/test.m4a')).rejects.toThrow('File not found');
    });
  });

  describe('saveSong', () => {
    const mockM4AData = {
      metadata: {
        title: 'Original Title',
        artist: 'Original Artist',
        album: 'Original Album',
        year: 2020,
        genre: 'Pop',
        key: 'C',
      },
      lyrics: [
        { start: 0, end: 2, text: 'Line 1' },
        { start: 2, end: 4, text: 'Line 2' },
      ],
      audio: {
        sources: [{ name: 'vocals', trackIndex: 0 }],
        timing: {},
        presets: [],
      },
      features: {},
      singers: [],
      meta: {},
    };

    beforeEach(() => {
      M4ALoader.load.mockResolvedValue(mockM4AData);
      Atoms.writeKaraAtom.mockResolvedValue();
      Atoms.addStandardMetadata.mockResolvedValue();
      Atoms.writeVpchAtom.mockResolvedValue();
      Atoms.writeKonsAtom.mockResolvedValue();
      Atoms.addMusicalKey.mockResolvedValue();
    });

    it('should save M4A metadata updates successfully', async () => {
      const updates = {
        format: 'm4a-stems',
        metadata: {
          title: 'New Title',
          artist: 'New Artist',
        },
        lyrics: mockM4AData.lyrics,
      };

      const result = await editorService.saveSong('/music/test.m4a', updates);

      expect(result.success).toBe(true);
      expect(M4ALoader.load).toHaveBeenCalledWith('/music/test.m4a');
      expect(Atoms.writeKaraAtom).toHaveBeenCalled();
      expect(Atoms.addStandardMetadata).toHaveBeenCalledWith(
        '/music/test.m4a',
        expect.objectContaining({
          title: 'New Title',
          artist: 'New Artist',
        })
      );
    });

    it('should save lyrics updates', async () => {
      const newLyrics = [
        { start: 0, end: 2, text: 'Updated Line 1' },
        { start: 2, end: 4, text: 'Updated Line 2' },
        { start: 4, end: 6, text: 'New Line 3' },
      ];

      const updates = {
        format: 'm4a-stems',
        metadata: {},
        lyrics: newLyrics,
      };

      await editorService.saveSong('/music/test.m4a', updates);

      expect(Atoms.writeKaraAtom).toHaveBeenCalledWith(
        '/music/test.m4a',
        expect.objectContaining({
          lines: expect.arrayContaining([expect.objectContaining({ text: 'Updated Line 1' })]),
        })
      );
    });

    it('should throw error when path is missing', async () => {
      const updates = { format: 'm4a-stems', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('', updates)).rejects.toThrow('Path is required');
      await expect(editorService.saveSong(null, updates)).rejects.toThrow('Path is required');
      expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
    });

    it('should throw error for unsupported format', async () => {
      const updates = { format: 'cdg', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.cdg', updates)).rejects.toThrow(
        'Unsupported format: cdg. Only m4a-stems format is supported.'
      );
      expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
    });

    it('should write musical key when changed', async () => {
      const updates = {
        format: 'm4a-stems',
        metadata: { key: 'Am' },
        lyrics: [],
      };

      await editorService.saveSong('/music/test.m4a', updates);

      expect(Atoms.addMusicalKey).toHaveBeenCalledWith('/music/test.m4a', 'Am');
    });

    it('should handle M4ALoader errors during save', async () => {
      M4ALoader.load.mockRejectedValue(new Error('Failed to load'));

      const updates = { format: 'm4a-stems', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.m4a', updates)).rejects.toThrow(
        'Failed to load'
      );
      expect(Atoms.writeKaraAtom).not.toHaveBeenCalled();
    });
  });
});
