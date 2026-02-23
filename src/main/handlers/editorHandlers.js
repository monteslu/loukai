import { log } from '../logger.js';
/**
 * Editor IPC Handlers
 * Handles song editing operations (KAI and M4A formats)
 */

import { ipcMain } from 'electron';

/**
 * Register all editor-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerEditorHandlers(mainApp) {
  // Load song file for editing (KAI or M4A)
  ipcMain.handle('editor:loadKai', async (event, filePath) => {
    try {
      log('Load song file for editing:', filePath);

      const editorService = await import('../../shared/services/editorService.js');
      const result = await editorService.loadSong(filePath);

      log(
        `${result.format.toUpperCase()} file loaded for editing, has lyrics:`,
        result.kaiData.lyrics?.length || 0
      );

      return {
        success: true,
        data: result.kaiData,
        format: result.format, // Include format in response
      };
    } catch (error) {
      console.error('Failed to load song file for editing:', error);
      return { success: false, error: error.message };
    }
  });

  // Save song file (KAI or M4A)
  ipcMain.handle('editor:saveKai', async (event, kaiData, originalPath) => {
    try {
      log('Save song file request:', originalPath);
      log('Updated lyrics:', kaiData.lyrics?.length || 0, 'lines');

      // Determine format from file extension
      const lowerPath = originalPath.toLowerCase();
      let format;
      if (lowerPath.endsWith('.kai')) {
        format = 'kai';
      } else if (lowerPath.endsWith('.m4a') || lowerPath.endsWith('.mp4')) {
        format = 'm4a-stems';
      } else {
        throw new Error('Unsupported file format');
      }

      const editorService = await import('../../shared/services/editorService.js');
      const _result = await editorService.saveSong(originalPath, {
        format: format,
        metadata: kaiData.song || kaiData.metadata || {},
        lyrics: kaiData.lyrics,
      });

      log(`${format.toUpperCase()} file saved successfully`);
      return { success: true };
    } catch (error) {
      console.error('Failed to save song file:', error);
      return { success: false, error: error.message };
    }
  });

  // Reload song file in player (KAI or M4A)
  ipcMain.handle('editor:reloadKai', async (event, filePath) => {
    try {
      log('Reload song file request:', filePath);

      // Determine format and call appropriate loader
      const lowerPath = filePath.toLowerCase();
      let result;

      if (lowerPath.endsWith('.kai')) {
        result = await mainApp.loadKaiFile(filePath);
      } else if (lowerPath.endsWith('.m4a') || lowerPath.endsWith('.mp4')) {
        result = await mainApp.loadM4AFile(filePath);
      } else {
        throw new Error('Unsupported file format');
      }

      if (result && result.success) {
        log('Song file reloaded successfully');
        return { success: true };
      } else {
        console.error('Failed to reload song file');
        return { success: false, error: 'Failed to reload file' };
      }
    } catch (error) {
      console.error('Failed to reload song file:', error);
      return { success: false, error: error.message };
    }
  });
}
