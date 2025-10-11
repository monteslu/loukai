/**
 * Editor IPC Handlers
 * Handles KAI file editing operations
 */

import { ipcMain } from 'electron';

/**
 * Register all editor-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerEditorHandlers(mainApp) {
  // Load KAI file for editing (without loading into player)
  ipcMain.handle('editor:loadKai', async (event, filePath) => {
    try {
      console.log('Load KAI file for editing:', filePath);

      const editorService = await import('../../shared/services/editorService.js');
      const result = await editorService.loadSong(filePath);

      console.log('KAI file loaded for editing, has lyrics:', result.kaiData.lyrics?.length || 0);

      return {
        success: true,
        data: result.kaiData,
      };
    } catch (error) {
      console.error('Failed to load KAI file for editing:', error);
      return { success: false, error: error.message };
    }
  });

  // Save KAI file
  ipcMain.handle('editor:saveKai', async (event, kaiData, originalPath) => {
    try {
      console.log('Save KAI file request:', originalPath);
      console.log('Updated lyrics:', kaiData.lyrics.length, 'lines');

      const editorService = await import('../../shared/services/editorService.js');
      const _result = await editorService.saveSong(originalPath, {
        format: 'kai',
        metadata: kaiData.song || {},
        lyrics: kaiData.lyrics,
      });

      console.log('KAI file saved successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to save KAI file:', error);
      return { success: false, error: error.message };
    }
  });

  // Reload KAI file in player
  ipcMain.handle('editor:reloadKai', async (event, filePath) => {
    try {
      console.log('Reload KAI file request:', filePath);

      // Reload the KAI file using the existing loadKaiFile method
      const result = await mainApp.loadKaiFile(filePath);

      if (result && result.success) {
        console.log('KAI file reloaded successfully');
        return { success: true };
      } else {
        console.error('Failed to reload KAI file');
        return { success: false, error: 'Failed to reload file' };
      }
    } catch (error) {
      console.error('Failed to reload KAI file:', error);
      return { success: false, error: error.message };
    }
  });
}
