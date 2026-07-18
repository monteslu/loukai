/**
 * Editor Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as editorService from './editorService.js';

// Mock M4ALoader (loadSong) and stem-mp4 Atoms (saveSong uses the BUFFER variants:
// one file read, chained in-memory atom edits, one file write — issue #67).
vi.mock('../../utils/m4aLoader.js', () => ({
  default: {
    load: vi.fn(),
  },
}));

vi.mock('stem-mp4', () => ({
  Atoms: {
    readKaraAtomBuffer: vi.fn(),
    writeKaraAtomBuffer: vi.fn(),
    addStandardMetadataBuffer: vi.fn(),
    addMusicalKeyBuffer: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('music-metadata', () => ({
  parseBuffer: vi.fn(),
}));

import M4ALoader from '../../utils/m4aLoader.js';
import { Atoms } from 'stem-mp4';
import { readFile, writeFile } from 'fs/promises';
import { parseBuffer } from 'music-metadata';

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

      expect(result.format).toBe('stem-mp4');
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

      expect(result.format).toBe('stem-mp4');
      expect(M4ALoader.load).toHaveBeenCalledWith('/music/test.mp4');
    });

    it('should throw error when path is missing', async () => {
      await expect(editorService.loadSong('')).rejects.toThrow('Path is required');
      await expect(editorService.loadSong(null)).rejects.toThrow('Path is required');
      expect(M4ALoader.load).not.toHaveBeenCalled();
    });

    it('should throw error for CDG format', async () => {
      await expect(editorService.loadSong('/music/test.cdg')).rejects.toThrow(
        'Only Stem MP4 format is supported for editing'
      );
      expect(M4ALoader.load).not.toHaveBeenCalled();
    });

    it('should throw error for MP3 format', async () => {
      await expect(editorService.loadSong('/music/test.mp3')).rejects.toThrow(
        'Only Stem MP4 format is supported for editing'
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

    const FILE_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const KARA_OUT = new Uint8Array([0x10]);
    const META_OUT = new Uint8Array([0x20]);
    const KEY_OUT = new Uint8Array([0x30]);

    beforeEach(() => {
      readFile.mockResolvedValue(FILE_BYTES);
      writeFile.mockResolvedValue();
      Atoms.readKaraAtomBuffer.mockReturnValue({
        lines: mockM4AData.lyrics,
        timing: { offset_sec: 0, encoder_delay_samples: 0 },
        singers: [],
        tags: [],
      });
      parseBuffer.mockResolvedValue({
        common: {
          title: 'Original Title',
          artist: 'Original Artist',
          album: 'Original Album',
          year: 2020,
          genre: ['Pop'],
        },
        native: {},
      });
      Atoms.writeKaraAtomBuffer.mockReturnValue(KARA_OUT);
      Atoms.addStandardMetadataBuffer.mockReturnValue(META_OUT);
      Atoms.addMusicalKeyBuffer.mockReturnValue(KEY_OUT);
    });

    it('should save M4A metadata updates successfully', async () => {
      const updates = {
        format: 'stem-mp4',
        metadata: {
          title: 'New Title',
          artist: 'New Artist',
        },
        lyrics: mockM4AData.lyrics,
      };

      const result = await editorService.saveSong('/music/test.m4a', updates);

      expect(result.success).toBe(true);
      // ONE read, ONE write — the whole point of the issue-67 fix.
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(Atoms.writeKaraAtomBuffer).toHaveBeenCalled();
      expect(Atoms.addStandardMetadataBuffer).toHaveBeenCalledWith(
        KARA_OUT,
        expect.objectContaining({
          title: 'New Title',
          artist: 'New Artist',
        })
      );
      // No key in the updates → no key atom pass; the metadata output is written.
      expect(Atoms.addMusicalKeyBuffer).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith('/music/test.m4a', META_OUT);
      // The save must NOT run the full loader (audio track extraction).
      expect(M4ALoader.load).not.toHaveBeenCalled();
    });

    it('should accept the legacy m4a-stems format on save', async () => {
      const updates = {
        format: 'm4a-stems',
        metadata: { title: 'Legacy Title' },
        lyrics: mockM4AData.lyrics,
      };

      const result = await editorService.saveSong('/music/test.m4a', updates);

      expect(result.success).toBe(true);
      expect(Atoms.addStandardMetadataBuffer).toHaveBeenCalledWith(
        KARA_OUT,
        expect.objectContaining({ title: 'Legacy Title' })
      );
    });

    it('should save lyrics updates', async () => {
      const newLyrics = [
        { start: 0, end: 2, text: 'Updated Line 1' },
        { start: 2, end: 4, text: 'Updated Line 2' },
        { start: 4, end: 6, text: 'New Line 3' },
      ];

      const updates = {
        format: 'stem-mp4',
        metadata: {},
        lyrics: newLyrics,
      };

      await editorService.saveSong('/music/test.m4a', updates);

      expect(Atoms.writeKaraAtomBuffer).toHaveBeenCalledWith(
        FILE_BYTES,
        expect.objectContaining({
          lines: expect.arrayContaining([expect.objectContaining({ text: 'Updated Line 1' })]),
        })
      );
    });

    it('should write the musical key atom when the key changes', async () => {
      const updates = {
        format: 'stem-mp4',
        metadata: { key: 'Am' },
        lyrics: mockM4AData.lyrics,
      };

      await editorService.saveSong('/music/test.m4a', updates);

      expect(Atoms.addMusicalKeyBuffer).toHaveBeenCalledWith(META_OUT, 'Am');
      expect(writeFile).toHaveBeenCalledWith('/music/test.m4a', KEY_OUT);
    });

    it('should throw error when path is missing', async () => {
      const updates = { format: 'stem-mp4', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('', updates)).rejects.toThrow('Path is required');
      await expect(editorService.saveSong(null, updates)).rejects.toThrow('Path is required');
      expect(Atoms.writeKaraAtomBuffer).not.toHaveBeenCalled();
    });

    it('should throw error for unsupported format', async () => {
      const updates = { format: 'cdg', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.cdg', updates)).rejects.toThrow(
        'Unsupported format: cdg. Only stem-mp4 format is supported.'
      );
      expect(Atoms.writeKaraAtomBuffer).not.toHaveBeenCalled();
    });

    it('handles a file with no kara atom and no parseable metadata', async () => {
      // Both readers fail → save still works from the update values + defaults.
      Atoms.readKaraAtomBuffer.mockImplementation(() => {
        throw new Error('no kara atom');
      });
      parseBuffer.mockRejectedValue(new Error('unparseable'));

      const updates = {
        format: 'stem-mp4',
        metadata: { title: 'Fresh Title' },
        lyrics: [{ start: 0, end: 1, text: 'First line' }],
      };

      const result = await editorService.saveSong('/music/test.m4a', updates);

      expect(result.success).toBe(true);
      expect(Atoms.writeKaraAtomBuffer).toHaveBeenCalledWith(
        FILE_BYTES,
        expect.objectContaining({
          lines: [expect.objectContaining({ text: 'First line' })],
        })
      );
      expect(Atoms.addStandardMetadataBuffer).toHaveBeenCalledWith(
        KARA_OUT,
        expect.objectContaining({ title: 'Fresh Title' })
      );
    });

    it('preserves the existing iTunes musical key when the update has none', async () => {
      parseBuffer.mockResolvedValue({
        common: { title: 'T' },
        native: {
          iTunes: [{ id: '----:com.apple.iTunes:initialkey', value: Buffer.from('F#m') }],
        },
      });

      const updates = { format: 'stem-mp4', metadata: { title: 'T2' }, lyrics: [] };
      await editorService.saveSong('/music/test.m4a', updates);

      // Key untouched in the update → no key atom rewrite (existing key stays in file).
      expect(Atoms.addMusicalKeyBuffer).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith('/music/test.m4a', META_OUT);
    });

    it('falls back to the existing kara lines when no lyrics are passed', async () => {
      const updates = { format: 'stem-mp4', metadata: { title: 'Only Meta' } };
      await editorService.saveSong('/music/test.m4a', updates);

      expect(Atoms.writeKaraAtomBuffer).toHaveBeenCalledWith(
        FILE_BYTES,
        expect.objectContaining({
          lines: expect.arrayContaining([expect.objectContaining({ text: 'Line 1' })]),
        })
      );
    });

    it('should propagate file read errors during save', async () => {
      readFile.mockRejectedValue(new Error('Failed to load'));

      const updates = { format: 'stem-mp4', metadata: {}, lyrics: [] };

      await expect(editorService.saveSong('/music/test.m4a', updates)).rejects.toThrow(
        'Failed to load'
      );
      expect(Atoms.writeKaraAtomBuffer).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
