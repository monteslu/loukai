/**
 * File IPC Handlers
 * Handles file operations like open dialogs and file loading
 */

import { ipcMain, dialog } from 'electron';
import { validateSongPath } from '../utils/pathValidator.js';

/**
 * Register all file-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerFileHandlers(mainApp) {
  // Open file dialog to select karaoke file (M4A or KAI)
  ipcMain.handle('file:openKai', async () => {
    const result = await dialog.showOpenDialog(mainApp.mainWindow, {
      filters: [
        { name: 'Karaoke Files', extensions: ['m4a', 'kai'] },
        { name: 'M4A Stems (recommended)', extensions: ['m4a'] },
        { name: 'KAI Files (legacy)', extensions: ['kai'] },
      ],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return await mainApp.loadKaiFile(result.filePaths[0]);
    }
    return null;
  });

  // Load KAI file from path (with path traversal protection)
  ipcMain.handle('file:loadKaiFromPath', async (event, filePath) => {
    // Get the songs folder from settings
    const songsFolder = mainApp.settings?.getSongsFolder?.();
    
    // Validate the path is within the songs directory
    const validation = validateSongPath(filePath, songsFolder);
    if (!validation.valid) {
      console.error('🚫 Path validation failed:', validation.error, filePath);
      return { error: validation.error };
    }

    return await mainApp.loadKaiFile(validation.resolvedPath);
  });
}
