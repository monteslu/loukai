/**
 * Library Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as libraryService from './libraryService.js';

// Mock MainApp for testing
class MockMainApp {
  constructor() {
    this.cachedLibrary = null;
    this.settings = {
      getSongsFolder: vi.fn(),
    };
    this.webServer = null;
    this.scanForKaiFiles = vi.fn();
    this.scanForKaiFilesWithProgress = vi.fn();
    this.findAllKaiFiles = vi.fn();
    this.scanFilesystemForSync = vi.fn();
    this.parseMetadataWithProgress = vi.fn();
    this.extractM4AMetadata = vi.fn();
    this.extractCDGArchiveMetadata = vi.fn();
  }
}

describe('libraryService', () => {
  let mainApp;

  beforeEach(() => {
    mainApp = new MockMainApp();
  });

  describe('getSongsFolder', () => {
    it('should return the songs folder path', () => {
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');

      const result = libraryService.getSongsFolder(mainApp);

      expect(result.success).toBe(true);
      expect(result.folder).toBe('/music/karaoke');
    });

    it('should return null if folder not set', () => {
      mainApp.settings.getSongsFolder.mockReturnValue(null);

      const result = libraryService.getSongsFolder(mainApp);

      expect(result.success).toBe(true);
      expect(result.folder).toBeNull();
    });

    it('should handle errors gracefully', () => {
      mainApp.settings.getSongsFolder.mockImplementation(() => {
        throw new Error('Settings not available');
      });

      const result = libraryService.getSongsFolder(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Settings not available');
    });
  });

  describe('getCachedSongs', () => {
    it('should return cached songs when available', () => {
      const mockSongs = [
        { title: 'Song 1', artist: 'Artist 1', path: '/music/song1.kai' },
        { title: 'Song 2', artist: 'Artist 2', path: '/music/song2.kai' },
      ];
      mainApp.cachedLibrary = mockSongs;

      const result = libraryService.getCachedSongs(mainApp);

      expect(result.success).toBe(true);
      expect(result.files).toEqual(mockSongs);
      expect(result.cached).toBe(true);
    });

    it('should return empty array when no cache', () => {
      const result = libraryService.getCachedSongs(mainApp);

      expect(result.success).toBe(true);
      expect(result.files).toEqual([]);
      expect(result.cached).toBe(false);
    });
  });

  describe('getLibrarySongs', () => {
    it('should return cached library if available', async () => {
      const mockSongs = [{ title: 'Cached Song', path: '/music/cached.kai' }];
      mainApp.cachedLibrary = mockSongs;

      const result = await libraryService.getLibrarySongs(mainApp);

      expect(result.success).toBe(true);
      expect(result.songs).toEqual(mockSongs);
      expect(result.fromCache).toBe(true);
    });

    it('should scan when cache is empty', async () => {
      const mockSongs = [{ title: 'Scanned Song', path: '/music/scanned.kai' }];
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.scanForKaiFiles.mockResolvedValue(mockSongs);

      const result = await libraryService.getLibrarySongs(mainApp);

      expect(result.success).toBe(true);
      expect(result.songs).toEqual(mockSongs);
      expect(result.fromCache).toBe(false);
      expect(mainApp.scanForKaiFiles).toHaveBeenCalledWith('/music/karaoke');
    });

    it('should return error when songs folder not set', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue(null);

      const result = await libraryService.getLibrarySongs(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Songs folder not set');
      expect(result.songs).toEqual([]);
    });

    it('should handle scan errors gracefully', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.scanForKaiFiles.mockRejectedValue(new Error('Scan failed'));

      const result = await libraryService.getLibrarySongs(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Scan failed');
      expect(result.songs).toEqual([]);
    });
  });

  describe('scanLibrary', () => {
    it('should scan library and cache results', async () => {
      const mockFiles = [
        { title: 'Song 1', path: '/music/song1.kai' },
        { title: 'Song 2', path: '/music/song2.kai' },
      ];
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.findAllKaiFiles.mockResolvedValue(mockFiles);
      mainApp.scanForKaiFilesWithProgress.mockResolvedValue(mockFiles);

      const result = await libraryService.scanLibrary(mainApp);

      expect(result.success).toBe(true);
      expect(result.files).toEqual(mockFiles);
      expect(result.count).toBe(2);
      expect(result.cached).toBe(true);
      expect(mainApp.cachedLibrary).toEqual(mockFiles);
    });

    it('should call progress callback during scan', async () => {
      const mockFiles = [{ title: 'Song 1', path: '/music/song1.kai' }];
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.findAllKaiFiles.mockResolvedValue(mockFiles);
      mainApp.scanForKaiFilesWithProgress.mockResolvedValue(mockFiles);

      const progressCallback = vi.fn();
      await libraryService.scanLibrary(mainApp, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith({ current: 0, total: 1 });
      expect(progressCallback).toHaveBeenCalledWith({ current: 1, total: 1 });
    });

    it('should return error when songs folder not set', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue(null);

      const result = await libraryService.scanLibrary(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Songs folder not set');
    });

    it('should handle scan errors gracefully', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.findAllKaiFiles.mockRejectedValue(new Error('Access denied'));

      const result = await libraryService.scanLibrary(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  describe('syncLibrary', () => {
    it('should sync library incrementally', async () => {
      const cachedFiles = [{ title: 'Old Song', path: '/music/old.kai', file: '/music/old.kai' }];
      const filesystemScan = [
        { path: '/music/old.kai' }, // Still exists
        { path: '/music/new.kai' }, // New file
      ];
      const newMetadata = [{ title: 'New Song', path: '/music/new.kai', file: '/music/new.kai' }];

      mainApp.cachedLibrary = cachedFiles;
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.scanFilesystemForSync.mockResolvedValue(filesystemScan);
      mainApp.parseMetadataWithProgress.mockResolvedValue(newMetadata);

      const result = await libraryService.syncLibrary(mainApp);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(mainApp.cachedLibrary).toHaveLength(2);
    });

    it('should detect removed files', async () => {
      const cachedFiles = [
        { title: 'Song 1', path: '/music/song1.kai', file: '/music/song1.kai' },
        { title: 'Song 2', path: '/music/song2.kai', file: '/music/song2.kai' },
      ];
      const filesystemScan = [
        { path: '/music/song1.kai' }, // Song 2 was removed
      ];

      mainApp.cachedLibrary = cachedFiles;
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.scanFilesystemForSync.mockResolvedValue(filesystemScan);
      mainApp.parseMetadataWithProgress.mockResolvedValue([]);

      const result = await libraryService.syncLibrary(mainApp);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.added).toBe(0);
      expect(result.removed).toBe(1);
      expect(result.removedPaths).toContain('/music/song2.kai');
    });

    it('should call progress callback during sync', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.scanFilesystemForSync.mockResolvedValue([]);
      mainApp.parseMetadataWithProgress.mockResolvedValue([]);

      const progressCallback = vi.fn();
      await libraryService.syncLibrary(mainApp, progressCallback);

      expect(progressCallback).toHaveBeenCalled();
    });

    it('should return error when songs folder not set', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue(null);

      const result = await libraryService.syncLibrary(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Songs folder not set');
    });

    it('should handle sync errors gracefully', async () => {
      mainApp.settings.getSongsFolder.mockReturnValue('/music/karaoke');
      mainApp.scanFilesystemForSync.mockRejectedValue(new Error('Sync failed'));

      const result = await libraryService.syncLibrary(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync failed');
    });
  });

  describe('searchSongs', () => {
    beforeEach(() => {
      mainApp.cachedLibrary = [
        { title: 'Dancing Queen', artist: 'ABBA', album: 'Arrival' },
        { title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera' },
        { title: 'Hotel California', artist: 'Eagles', album: 'Hotel California' },
        { title: 'Stairway to Heaven', artist: 'Led Zeppelin', album: 'Led Zeppelin IV' },
      ];
    });

    it('should find songs by title', () => {
      const result = libraryService.searchSongs(mainApp, 'queen');

      expect(result.success).toBe(true);
      expect(result.songs).toHaveLength(2);
      expect(result.songs[0].title).toBe('Dancing Queen'); // Title match first
      expect(result.songs[1].title).toBe('Bohemian Rhapsody'); // Artist match second
    });

    it('should find songs by artist', () => {
      const result = libraryService.searchSongs(mainApp, 'eagles');

      expect(result.success).toBe(true);
      expect(result.songs).toHaveLength(1);
      expect(result.songs[0].title).toBe('Hotel California');
    });

    it('should find songs by album', () => {
      const result = libraryService.searchSongs(mainApp, 'arrival');

      expect(result.success).toBe(true);
      expect(result.songs).toHaveLength(1);
      expect(result.songs[0].title).toBe('Dancing Queen');
    });

    it('should return empty array for empty query', () => {
      const result = libraryService.searchSongs(mainApp, '');

      expect(result.success).toBe(true);
      expect(result.songs).toEqual([]);
    });

    it('should return empty array when no cache', () => {
      mainApp.cachedLibrary = null;
      const result = libraryService.searchSongs(mainApp, 'test');

      expect(result.success).toBe(true);
      expect(result.songs).toEqual([]);
    });

    it('should limit results to 50 songs', () => {
      // Create 60 songs
      mainApp.cachedLibrary = Array.from({ length: 60 }, (_, i) => ({
        title: `Test Song ${i}`,
        artist: 'Test Artist',
      }));

      const result = libraryService.searchSongs(mainApp, 'test');

      expect(result.success).toBe(true);
      expect(result.songs).toHaveLength(50);
    });

    it('should prioritize title matches over artist/album matches', () => {
      const result = libraryService.searchSongs(mainApp, 'california');

      expect(result.success).toBe(true);
      expect(result.songs).toHaveLength(1);
      expect(result.songs[0].title).toBe('Hotel California');
    });

    it('should handle search errors gracefully', () => {
      // Simulate error by setting cachedLibrary to invalid data
      mainApp.cachedLibrary = [{ invalid: 'data' }];
      mainApp.cachedLibrary.filter = () => {
        throw new Error('Search failed');
      };

      const result = libraryService.searchSongs(mainApp, 'test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search failed');
      expect(result.songs).toEqual([]);
    });
  });

  describe('getSongInfo', () => {
    it('should return song from cache if available', async () => {
      const mockSong = { title: 'Test Song', path: '/music/test.kai' };
      mainApp.cachedLibrary = [mockSong];

      const result = await libraryService.getSongInfo(mainApp, '/music/test.kai');

      expect(result.success).toBe(true);
      expect(result.song).toEqual(mockSong);
      expect(result.fromCache).toBe(true);
    });

    it('should extract metadata for M4A file not in cache', async () => {
      const mockMetadata = { title: 'New Song', artist: 'New Artist', hasKaraoke: true };
      mainApp.extractM4AMetadata.mockResolvedValue(mockMetadata);

      const result = await libraryService.getSongInfo(mainApp, '/music/new.m4a');

      expect(result.success).toBe(true);
      expect(result.song.title).toBe('New Song');
      expect(result.song.format).toBe('m4a-stems');
      expect(result.fromCache).toBe(false);
      expect(mainApp.extractM4AMetadata).toHaveBeenCalledWith('/music/new.m4a');
    });

    it('should extract metadata for CDG archive', async () => {
      const mockMetadata = { title: 'Archive Song', artist: 'Archive Artist' };
      mainApp.extractCDGArchiveMetadata.mockResolvedValue(mockMetadata);

      const result = await libraryService.getSongInfo(mainApp, '/music/archive.kar');

      expect(result.success).toBe(true);
      expect(result.song.title).toBe('Archive Song');
      expect(result.song.format).toBe('cdg-archive');
      expect(mainApp.extractCDGArchiveMetadata).toHaveBeenCalledWith('/music/archive.kar');
    });

    it('should return error for missing file path', async () => {
      const result = await libraryService.getSongInfo(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File path is required');
    });

    it('should return error for CDG pair (requires both files)', async () => {
      const result = await libraryService.getSongInfo(mainApp, '/music/song.mp3');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CDG pair requires both MP3 and CDG paths');
    });

    it('should handle metadata extraction errors', async () => {
      mainApp.extractM4AMetadata.mockRejectedValue(new Error('Corrupt file'));

      const result = await libraryService.getSongInfo(mainApp, '/music/corrupt.m4a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Corrupt file');
    });
  });

  describe('clearLibraryCache', () => {
    it('should clear the library cache', () => {
      mainApp.cachedLibrary = [{ title: 'Test Song' }];

      const result = libraryService.clearLibraryCache(mainApp);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Library cache cleared');
      expect(mainApp.cachedLibrary).toBeNull();
    });
  });

  describe('updateLibraryCache', () => {
    it('should update main app cache', async () => {
      const mockFiles = [{ title: 'Song 1' }, { title: 'Song 2' }];
      // Don't set settings.getSongsFolder to avoid Electron imports in tests
      mainApp.settings = {};

      const result = await libraryService.updateLibraryCache(mainApp, mockFiles);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(mainApp.cachedLibrary).toEqual(mockFiles);
    });

    it('should update web server cache if available', async () => {
      const mockFiles = [{ title: 'Song 1' }];
      // Don't set settings.getSongsFolder to avoid Electron imports in tests
      mainApp.settings = {};
      mainApp.webServer = {
        cachedSongs: [],
        songsCacheTime: 0,
        fuse: {},
        io: {
          emit: vi.fn(),
        },
      };

      const result = await libraryService.updateLibraryCache(mainApp, mockFiles);

      expect(result.success).toBe(true);
      expect(mainApp.webServer.cachedSongs).toEqual(mockFiles);
      expect(mainApp.webServer.fuse).toBeNull();
      expect(mainApp.webServer.io.emit).toHaveBeenCalledWith(
        'library-refreshed',
        expect.objectContaining({ count: 1 })
      );
    });

    it('should handle errors gracefully', async () => {
      // Simulate error by making cachedLibrary assignment fail
      Object.defineProperty(mainApp, 'cachedLibrary', {
        set: () => {
          throw new Error('Cache update failed');
        },
      });

      const result = await libraryService.updateLibraryCache(mainApp, []);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cache update failed');
    });
  });
});
