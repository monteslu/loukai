/**
 * Queue Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as queueService from './queueService.js';

// Mock AppState for testing
class MockAppState {
  constructor() {
    this.state = {
      queue: [],
      currentSong: null,
    };
    this.listeners = {};
  }

  addToQueue(item) {
    const newItem = {
      id: Date.now() + Math.random(),
      path: item.path,
      title: item.title || 'Untitled',
      artist: item.artist || 'Unknown',
      duration: item.duration || 0,
      requester: item.requester || null,
      addedVia: item.addedVia || 'manual',
      addedAt: new Date().toISOString(),
    };
    this.state.queue.push(newItem);
    return newItem;
  }

  removeFromQueue(itemId) {
    const index = this.state.queue.findIndex((item) => item.id === itemId);
    if (index !== -1) {
      const [removed] = this.state.queue.splice(index, 1);
      return removed;
    }
    return null;
  }

  clearQueue() {
    this.state.queue = [];
  }

  getQueue() {
    return [...this.state.queue];
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => callback(data));
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }
}

describe('queueService', () => {
  let appState;

  beforeEach(() => {
    appState = new MockAppState();
  });

  describe('addSongToQueue', () => {
    it('should add a song to an empty queue', () => {
      const song = {
        path: '/music/song1.kai',
        title: 'Test Song',
        artist: 'Test Artist',
        duration: 180,
      };

      const result = queueService.addSongToQueue(appState, song);

      expect(result.success).toBe(true);
      expect(result.queueItem).toBeDefined();
      expect(result.queueItem.title).toBe('Test Song');
      expect(result.queueItem.artist).toBe('Test Artist');
      expect(result.queue).toHaveLength(1);
      expect(result.wasEmpty).toBe(true);
    });

    it('should add a song to a non-empty queue', () => {
      // Add first song
      appState.addToQueue({
        path: '/music/song1.kai',
        title: 'Song 1',
        artist: 'Artist 1',
      });

      const song = {
        path: '/music/song2.kai',
        title: 'Song 2',
        artist: 'Artist 2',
      };

      const result = queueService.addSongToQueue(appState, song);

      expect(result.success).toBe(true);
      expect(result.queue).toHaveLength(2);
      expect(result.wasEmpty).toBe(false);
    });

    it('should return error when path is missing', () => {
      const song = {
        title: 'Test Song',
        artist: 'Test Artist',
      };

      const result = queueService.addSongToQueue(appState, song);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid queue item: path is required');
    });

    it('should return error when queueItem is null', () => {
      const result = queueService.addSongToQueue(appState, null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid queue item: path is required');
    });
  });

  describe('removeSongFromQueue', () => {
    it('should remove a song from queue', () => {
      const song = appState.addToQueue({
        path: '/music/song1.kai',
        title: 'Test Song',
        artist: 'Test Artist',
      });

      const result = queueService.removeSongFromQueue(appState, song.id);

      expect(result.success).toBe(true);
      expect(result.removed).toBeDefined();
      expect(result.removed.id).toBe(song.id);
      expect(result.queue).toHaveLength(0);
    });

    it('should return error when song not found', () => {
      const result = queueService.removeSongFromQueue(appState, 99999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Song not found in queue');
    });
  });

  describe('clearQueue', () => {
    it('should clear all songs from queue', () => {
      // Add multiple songs
      appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });
      appState.addToQueue({ path: '/music/song2.kai', title: 'Song 2' });
      appState.addToQueue({ path: '/music/song3.kai', title: 'Song 3' });

      expect(appState.state.queue).toHaveLength(3);

      const result = queueService.clearQueue(appState);

      expect(result.success).toBe(true);
      expect(result.queue).toHaveLength(0);
      expect(appState.state.queue).toHaveLength(0);
    });

    it('should work on an already empty queue', () => {
      const result = queueService.clearQueue(appState);

      expect(result.success).toBe(true);
      expect(result.queue).toHaveLength(0);
    });
  });

  describe('getQueue', () => {
    it('should return empty queue', () => {
      const result = queueService.getQueue(appState);

      expect(result.success).toBe(true);
      expect(result.queue).toHaveLength(0);
    });

    it('should return queue with songs', () => {
      appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });
      appState.addToQueue({ path: '/music/song2.kai', title: 'Song 2' });

      const result = queueService.getQueue(appState);

      expect(result.success).toBe(true);
      expect(result.queue).toHaveLength(2);
      expect(result.queue[0].title).toBe('Song 1');
      expect(result.queue[1].title).toBe('Song 2');
    });
  });

  describe('getQueueInfo', () => {
    it('should return formatted queue info', () => {
      appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1', artist: 'Artist 1' });
      appState.addToQueue({ path: '/music/song2.kai', title: 'Song 2', artist: 'Artist 2' });

      const result = queueService.getQueueInfo(appState);

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.queue[0].position).toBe(1);
      expect(result.queue[1].position).toBe(2);
      expect(result.currentSong).toBeNull();
    });

    it('should include current song info when playing', () => {
      appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });
      appState.state.currentSong = {
        title: 'Current Song',
        artist: 'Current Artist',
        requester: 'Admin',
      };

      const result = queueService.getQueueInfo(appState);

      expect(result.currentSong).toBeDefined();
      expect(result.currentSong.title).toBe('Current Song');
      expect(result.currentSong.artist).toBe('Current Artist');
      expect(result.currentSong.requester).toBe('Admin');
    });
  });

  describe('reorderQueue', () => {
    it('should move a song to a new position', () => {
      const song1 = appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });
      const _song2 = appState.addToQueue({ path: '/music/song2.kai', title: 'Song 2' });
      const _song3 = appState.addToQueue({ path: '/music/song3.kai', title: 'Song 3' });

      // Move song1 (index 0) to index 2
      const result = queueService.reorderQueue(appState, song1.id, 2);

      expect(result.success).toBe(true);
      expect(result.queue[0].title).toBe('Song 2');
      expect(result.queue[1].title).toBe('Song 3');
      expect(result.queue[2].title).toBe('Song 1');
    });

    it('should return error when song not found', () => {
      appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });

      const result = queueService.reorderQueue(appState, 99999, 0);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Song not found in queue');
    });

    it('should return error when target index is invalid (negative)', () => {
      const song = appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });

      const result = queueService.reorderQueue(appState, song.id, -1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid target index');
    });

    it('should return error when target index is out of bounds', () => {
      const song = appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });

      const result = queueService.reorderQueue(appState, song.id, 10);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid target index');
    });

    it('should emit queueChanged event', () => {
      const song1 = appState.addToQueue({ path: '/music/song1.kai', title: 'Song 1' });
      appState.addToQueue({ path: '/music/song2.kai', title: 'Song 2' });

      const emitSpy = vi.spyOn(appState, 'emit');

      queueService.reorderQueue(appState, song1.id, 1);

      expect(emitSpy).toHaveBeenCalledWith('queueChanged', expect.any(Array));
    });
  });

  describe('loadFromQueue', () => {
    it('should load a KAI file from queue', async () => {
      const song = appState.addToQueue({
        path: '/music/song.kai',
        title: 'Test Song',
        artist: 'Test Artist',
      });

      const mainApp = {
        appState,
        loadKaiFile: vi.fn().mockResolvedValue(true),
      };

      const result = await queueService.loadFromQueue(mainApp, song.id);

      expect(result.success).toBe(true);
      expect(result.song).toBeDefined();
      expect(mainApp.loadKaiFile).toHaveBeenCalledWith('/music/song.kai', song.id);
    });

    it('should load a CDG file from queue (mp3 path)', async () => {
      const song = appState.addToQueue({
        path: '/music/song.mp3',
        title: 'Test Song',
      });

      const mainApp = {
        appState,
        loadCDGFile: vi.fn().mockResolvedValue(true),
      };

      const result = await queueService.loadFromQueue(mainApp, song.id);

      expect(result.success).toBe(true);
      expect(mainApp.loadCDGFile).toHaveBeenCalledWith(
        '/music/song.mp3',
        '/music/song.cdg',
        'cdg-pair',
        song.id
      );
    });

    it('should load a CDG file from queue (cdg path)', async () => {
      const song = appState.addToQueue({
        path: '/music/song.cdg',
        title: 'Test Song',
      });

      const mainApp = {
        appState,
        loadCDGFile: vi.fn().mockResolvedValue(true),
      };

      const result = await queueService.loadFromQueue(mainApp, song.id);

      expect(result.success).toBe(true);
      expect(mainApp.loadCDGFile).toHaveBeenCalledWith(
        '/music/song.mp3',
        '/music/song.cdg',
        'cdg-pair',
        song.id
      );
    });

    it('should handle numeric itemId as number', async () => {
      const song = appState.addToQueue({
        path: '/music/song.kai',
        title: 'Test Song',
      });

      const mainApp = {
        appState,
        loadKaiFile: vi.fn().mockResolvedValue(true),
      };

      const result = await queueService.loadFromQueue(mainApp, song.id);

      expect(result.success).toBe(true);
      expect(mainApp.loadKaiFile).toHaveBeenCalled();
    });

    it('should handle numeric itemId as string', async () => {
      const song = appState.addToQueue({
        path: '/music/song.kai',
        title: 'Test Song',
      });

      const mainApp = {
        appState,
        loadKaiFile: vi.fn().mockResolvedValue(true),
      };

      const result = await queueService.loadFromQueue(mainApp, String(song.id));

      expect(result.success).toBe(true);
      expect(mainApp.loadKaiFile).toHaveBeenCalled();
    });

    it('should return error when song not found in queue', async () => {
      const mainApp = {
        appState,
        loadKaiFile: vi.fn(),
      };

      const result = await queueService.loadFromQueue(mainApp, 99999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Song not found in queue');
      expect(mainApp.loadKaiFile).not.toHaveBeenCalled();
    });

    it('should return error for unsupported file format', async () => {
      const song = appState.addToQueue({
        path: '/music/song.txt',
        title: 'Test Song',
      });

      const mainApp = {
        appState,
        loadKaiFile: vi.fn(),
      };

      const result = await queueService.loadFromQueue(mainApp, song.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported file format');
    });

    it('should handle loader errors gracefully', async () => {
      const song = appState.addToQueue({
        path: '/music/song.kai',
        title: 'Test Song',
      });

      const mainApp = {
        appState,
        loadKaiFile: vi.fn().mockRejectedValue(new Error('File not found')),
      };

      const result = await queueService.loadFromQueue(mainApp, song.id);

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });
  });
});
