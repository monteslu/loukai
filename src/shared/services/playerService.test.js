/**
 * Player Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as playerService from './playerService.js';

// Mock MainApp for testing
class MockMainApp {
  constructor() {
    this.mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
      },
    };
    this.appState = {
      state: {
        playback: {
          isPlaying: false,
          position: 0,
          duration: 0,
          songPath: null,
          lastUpdate: Date.now(),
        },
        currentSong: null,
      },
      getQueue: vi.fn(() => []),
      removeFromQueue: vi.fn(),
    };
    this.songQueue = [];
    this.currentSong = null;
    this.loadKaiFile = vi.fn();
  }
}

describe('playerService', () => {
  let mainApp;

  beforeEach(() => {
    mainApp = new MockMainApp();
  });

  describe('play', () => {
    it('should send play command when window is available', () => {
      const result = playerService.play(mainApp);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Play command sent');
      expect(mainApp.mainWindow.webContents.send).toHaveBeenCalledWith('player:togglePlayback');
    });

    it('should return error when window is null', () => {
      mainApp.mainWindow = null;

      const result = playerService.play(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Main window not available');
    });

    it('should return error when window is destroyed', () => {
      mainApp.mainWindow.isDestroyed.mockReturnValue(true);

      const result = playerService.play(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Main window not available');
    });
  });

  describe('pause', () => {
    it('should send pause command when window is available', () => {
      const result = playerService.pause(mainApp);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Pause command sent');
      expect(mainApp.mainWindow.webContents.send).toHaveBeenCalledWith('player:togglePlayback');
    });

    it('should return error when window is not available', () => {
      mainApp.mainWindow = null;

      const result = playerService.pause(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Main window not available');
    });
  });

  describe('restart', () => {
    it('should send restart command when window is available', () => {
      const result = playerService.restart(mainApp);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Restart command sent');
      expect(mainApp.mainWindow.webContents.send).toHaveBeenCalledWith('player:restart');
    });

    it('should return error when window is not available', () => {
      mainApp.mainWindow = null;

      const result = playerService.restart(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Main window not available');
    });
  });

  describe('seek', () => {
    it('should send seek command with position', () => {
      const result = playerService.seek(mainApp, 30);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Seek command sent');
      expect(result.position).toBe(30);
      expect(mainApp.mainWindow.webContents.send).toHaveBeenCalledWith('player:setPosition', 30);
    });

    it('should validate position is a number', () => {
      const result = playerService.seek(mainApp, 'invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Position must be a number');
      expect(mainApp.mainWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle zero position', () => {
      const result = playerService.seek(mainApp, 0);

      expect(result.success).toBe(true);
      expect(result.position).toBe(0);
    });

    it('should return error when window is not available', () => {
      mainApp.mainWindow = null;

      const result = playerService.seek(mainApp, 30);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Main window not available');
    });
  });

  describe('loadSong', () => {
    it('should load a song successfully', async () => {
      mainApp.loadKaiFile.mockResolvedValue({
        success: true,
        song: { title: 'Test Song', artist: 'Test Artist' },
      });

      const result = await playerService.loadSong(mainApp, '/music/test.kai');

      expect(result.success).toBe(true);
      expect(result.song.title).toBe('Test Song');
      expect(result.message).toBe('Song loaded successfully');
      expect(mainApp.loadKaiFile).toHaveBeenCalledWith('/music/test.kai');
    });

    it('should return error when file path is missing', async () => {
      const result = await playerService.loadSong(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File path is required');
      expect(mainApp.loadKaiFile).not.toHaveBeenCalled();
    });

    it('should return error when load fails', async () => {
      mainApp.loadKaiFile.mockResolvedValue({
        success: false,
      });

      const result = await playerService.loadSong(mainApp, '/music/test.kai');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to load song');
    });

    it('should handle exceptions', async () => {
      mainApp.loadKaiFile.mockRejectedValue(new Error('File not found'));

      const result = await playerService.loadSong(mainApp, '/music/test.kai');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });
  });

  describe('playNext', () => {
    it('should play next song from queue', async () => {
      const mockQueue = [
        { id: 1, path: '/music/song1.kai', title: 'Song 1' },
        { id: 2, path: '/music/song2.kai', title: 'Song 2' },
      ];

      // The function calls getQueue three times:
      // First to check if queue is empty
      // Second to update legacy songQueue
      // Third to get the updated queue and find next song
      mainApp.appState.getQueue.mockReturnValueOnce(mockQueue);
      mainApp.appState.getQueue.mockReturnValueOnce([mockQueue[1]]);
      mainApp.appState.getQueue.mockReturnValueOnce([mockQueue[1]]);
      mainApp.loadKaiFile.mockResolvedValue({ success: true });

      const result = await playerService.playNext(mainApp);

      expect(result.success).toBe(true);
      expect(result.song).toBeDefined();
      expect(result.song.title).toBe('Song 2');
      expect(result.message).toBe('Playing next song');
      expect(mainApp.appState.removeFromQueue).toHaveBeenCalledWith(1);
      expect(mainApp.loadKaiFile).toHaveBeenCalledWith('/music/song2.kai', 2);
    });

    it('should return error when queue is empty', async () => {
      mainApp.appState.getQueue.mockReturnValue([]);

      const result = await playerService.playNext(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue is empty');
    });

    it('should handle last song in queue', async () => {
      const mockQueue = [{ id: 1, path: '/music/last.kai', title: 'Last Song' }];
      mainApp.appState.getQueue.mockReturnValueOnce(mockQueue).mockReturnValueOnce([]); // Empty after removing last song

      const result = await playerService.playNext(mainApp);

      expect(result.success).toBe(true);
      expect(result.song).toBeNull();
      expect(result.message).toBe('No more songs in queue');
    });

    it('should handle errors during playback', async () => {
      const mockQueue = [
        { id: 1, path: '/music/song1.kai', title: 'Song 1' },
        { id: 2, path: '/music/song2.kai', title: 'Song 2' },
      ];
      const queueAfterRemoval = mockQueue.slice(1);

      mainApp.appState.getQueue
        .mockReturnValueOnce(mockQueue)
        .mockReturnValueOnce(queueAfterRemoval)
        .mockReturnValueOnce(queueAfterRemoval);
      mainApp.loadKaiFile.mockRejectedValue(new Error('Load failed'));

      const result = await playerService.playNext(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Load failed');
    });
  });

  describe('getPlaybackState', () => {
    it('should return current playback state', () => {
      mainApp.appState.state.playback = {
        isPlaying: true,
        position: 45.5,
        duration: 180,
        songPath: '/music/test.kai',
        lastUpdate: 1234567890,
      };
      mainApp.appState.state.currentSong = {
        title: 'Test Song',
        artist: 'Test Artist',
      };

      const result = playerService.getPlaybackState(mainApp);

      expect(result.success).toBe(true);
      expect(result.playback.isPlaying).toBe(true);
      expect(result.playback.position).toBe(45.5);
      expect(result.playback.duration).toBe(180);
      expect(result.playback.songPath).toBe('/music/test.kai');
      expect(result.currentSong.title).toBe('Test Song');
    });

    it('should handle null current song', () => {
      mainApp.appState.state.currentSong = null;

      const result = playerService.getPlaybackState(mainApp);

      expect(result.success).toBe(true);
      expect(result.playback).toBeDefined();
      expect(result.currentSong).toBeNull();
    });
  });

  describe('getCurrentSong', () => {
    it('should return current song with metadata', () => {
      mainApp.currentSong = {
        metadata: {
          path: '/music/test.kai',
          title: 'Test Song',
          artist: 'Test Artist',
        },
        requester: 'John',
      };

      const result = playerService.getCurrentSong(mainApp);

      expect(result.success).toBe(true);
      expect(result.song.title).toBe('Test Song');
      expect(result.song.artist).toBe('Test Artist');
      expect(result.song.requester).toBe('John');
    });

    it('should use filePath if path is missing', () => {
      mainApp.currentSong = {
        metadata: {
          title: 'Test Song',
          artist: 'Test Artist',
        },
        filePath: '/music/test.kai',
      };

      const result = playerService.getCurrentSong(mainApp);

      expect(result.success).toBe(true);
      expect(result.song.path).toBe('/music/test.kai');
    });

    it('should default requester to KJ', () => {
      mainApp.currentSong = {
        metadata: {
          path: '/music/test.kai',
          title: 'Test Song',
          artist: 'Test Artist',
        },
      };

      const result = playerService.getCurrentSong(mainApp);

      expect(result.success).toBe(true);
      expect(result.song.requester).toBe('KJ');
    });

    it('should return null when no song is loaded', () => {
      mainApp.currentSong = null;

      const result = playerService.getCurrentSong(mainApp);

      expect(result.success).toBe(true);
      expect(result.song).toBeNull();
    });

    it('should return null when current song has no metadata', () => {
      mainApp.currentSong = {};

      const result = playerService.getCurrentSong(mainApp);

      expect(result.success).toBe(true);
      expect(result.song).toBeNull();
    });
  });
});
