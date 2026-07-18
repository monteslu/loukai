import { log } from '../logger.js';
/**
 * Editor IPC Handlers
 * Handles song editing operations (KAI and M4A formats)
 */

import { ipcMain } from 'electron';
import { STEM_MP4_FORMAT } from '../../shared/formatUtils.js';

/**
 * Register all editor-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerEditorHandlers(mainApp) {
  // Load song file for editing (KAI or M4A)
  ipcMain.handle('editor:load', async (event, filePath) => {
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
  ipcMain.handle('editor:save', async (event, songData, originalPath) => {
    try {
      log('Save song file request:', originalPath);
      log('Updated lyrics:', songData.lyrics?.length || 0, 'lines');

      const lowerPath = originalPath.toLowerCase();
      if (!lowerPath.endsWith('.m4a') && !lowerPath.endsWith('.mp4')) {
        throw new Error('Unsupported file format');
      }
      const format = STEM_MP4_FORMAT;

      const editorService = await import('../../shared/services/editorService.js');
      const _result = await editorService.saveSong(originalPath, {
        format: format,
        metadata: songData.song || songData.metadata || {},
        lyrics: songData.lyrics,
      });

      log(`${format.toUpperCase()} file saved successfully`);
      return { success: true };
    } catch (error) {
      console.error('Failed to save song file:', error);
      return { success: false, error: error.message };
    }
  });

  // Reload song file in player
  ipcMain.handle('editor:reload', async (event, filePath) => {
    try {
      log('Reload song file request:', filePath);

      const lowerPath = filePath.toLowerCase();
      if (!lowerPath.endsWith('.m4a') && !lowerPath.endsWith('.mp4')) {
        throw new Error('Unsupported file format');
      }
      const result = await mainApp.loadM4AFile(filePath);

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
