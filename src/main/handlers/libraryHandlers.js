/**
 * Library IPC Handlers
 * Handles song library management operations
 */

import { ipcMain, dialog } from 'electron';
import fsPromises from 'fs/promises';
import { LIBRARY_CHANNELS } from '../../shared/ipcContracts.js';
import * as libraryService from '../../shared/services/libraryService.js';

/**
 * Register all library-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerLibraryHandlers(mainApp) {
  // Chord backfill (issue #93): the renderer analyzed a legacy song's stems and
  // hands back the chord track; merge it into the file off the main thread.
  ipcMain.handle('library:writeChords', (event, { path: filePath, chords }) => {
    return new Promise((resolve) => {
      import('node:worker_threads').then(({ Worker }) => {
        try {
          const worker = new Worker(new URL('../workers/writeChordsWorker.js', import.meta.url), {
            workerData: { filePath, chords },
          });
          worker.once('message', (m) => resolve(m));
          worker.once('error', (e) => resolve({ ok: false, error: e.message }));
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
  });
  // Get songs folder
  ipcMain.handle(LIBRARY_CHANNELS.GET_SONGS_FOLDER, () => {
    return libraryService.getSongsFolder(mainApp);
  });

  // Set songs folder
  ipcMain.handle(LIBRARY_CHANNELS.SET_SONGS_FOLDER, async () => {
    const result = await dialog.showOpenDialog(mainApp.mainWindow, {
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, folder: null };
    }

    const folder = result.filePaths[0];
    await mainApp.setSongsFolderAndScan(folder);

    return { success: true, folder };
  });

  // Scan folder (with cache updates)
  ipcMain.handle(LIBRARY_CHANNELS.SCAN_FOLDER, async () => {
    const result = await libraryService.scanLibrary(mainApp, (progress) => {
      mainApp.sendToRenderer('library:scanProgress', progress);
    });

    if (result.success) {
      // Update all caches (mainApp, webServer, disk)
      await libraryService.updateLibraryCache(mainApp, result.files);
    }

    return result;
  });

  // Sync library (with cache updates)
  ipcMain.handle(LIBRARY_CHANNELS.SYNC_LIBRARY, async () => {
    const result = await libraryService.syncLibrary(mainApp, (progress) => {
      mainApp.sendToRenderer('library:scanProgress', progress);
    });

    if (result.success) {
      // Update all caches (mainApp, webServer, disk)
      await libraryService.updateLibraryCache(mainApp, result.files);

      // Notify renderer so LibraryPanel reloads (matches scanLibrary behavior)
      mainApp.sendToRenderer('library:scanComplete', { count: result.files.length });

      // Return with 'songs' key for renderer compatibility
      return {
        ...result,
        songs: result.files,
      };
    }

    return result;
  });

  // Get cached songs
  ipcMain.handle(LIBRARY_CHANNELS.GET_CACHED_SONGS, () => {
    return libraryService.getCachedSongs(mainApp);
  });

  // Get song info (with file size)
  ipcMain.handle(LIBRARY_CHANNELS.GET_SONG_INFO, async (event, filePath) => {
    const result = await libraryService.getSongInfo(mainApp, filePath);

    // For compatibility with existing code, wrap result if needed
    if (result.success && result.song) {
      // Get file size if not already present
      if (!result.song.fileSize) {
        try {
          const stats = await fsPromises.stat(filePath);
          result.song.fileSize = stats.size;
        } catch {
          result.song.fileSize = 0;
        }
      }
      return result.song;
    }

    return result;
  });
}
