/**
 * Queue IPC Handlers
 * Handles song queue management operations
 */

import { ipcMain } from 'electron';
import { QUEUE_CHANNELS } from '../../shared/ipcContracts.js';
import * as queueService from '../../shared/services/queueService.js';

/**
 * Register all queue-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerQueueHandlers(mainApp) {
  // Add song to queue (with auto-load and legacy songQueue sync)
  ipcMain.handle(QUEUE_CHANNELS.ADD_SONG, async (event, queueItem) => {
    const result = queueService.addSongToQueue(mainApp.appState, queueItem);

    // Update legacy songQueue for compatibility
    mainApp.songQueue = result.queue;

    // If queue was empty, automatically load and start playing the first song
    if (result.success && result.wasEmpty) {
      console.log(`🎵 Queue was empty, auto-loading "${result.queueItem.title}"`);
      try {
        // Use the returned queueItem which has the generated ID
        await mainApp.loadKaiFile(result.queueItem.path, result.queueItem.id);
        console.log('✅ Successfully auto-loaded song from queue');
      } catch (error) {
        console.error('❌ Failed to auto-load song from queue:', error);
      }
    }

    return result;
  });

  // Remove song from queue (with legacy songQueue sync)
  ipcMain.handle(QUEUE_CHANNELS.REMOVE_SONG, async (event, itemId) => {
    const result = queueService.removeSongFromQueue(mainApp.appState, itemId);

    // Update legacy songQueue for compatibility
    if (result.success) {
      mainApp.songQueue = result.queue;
    }

    return result;
  });

  // Get queue
  ipcMain.handle(QUEUE_CHANNELS.GET, () => {
    return queueService.getQueue(mainApp.appState);
  });

  // Clear queue (with legacy songQueue sync)
  ipcMain.handle(QUEUE_CHANNELS.CLEAR, async () => {
    const result = queueService.clearQueue(mainApp.appState);

    // Update legacy songQueue for compatibility
    mainApp.songQueue = [];

    return result;
  });

  // Reorder queue (with legacy songQueue sync)
  ipcMain.handle('queue:reorderQueue', async (event, songId, newIndex) => {
    const result = queueService.reorderQueue(mainApp.appState, songId, newIndex);

    // Update legacy songQueue for compatibility
    if (result.success) {
      mainApp.songQueue = result.queue;
    }

    return result;
  });

  // Load song from queue by ID
  ipcMain.handle('queue:load', async (event, itemId) => {
    const result = await queueService.loadFromQueue(mainApp, itemId);
    return result;
  });
}
