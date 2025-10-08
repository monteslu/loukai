/**
 * Autotune IPC Handlers
 * Handles autotune audio effect operations
 */

import { ipcMain } from 'electron';

/**
 * Register all autotune-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerAutotuneHandlers(mainApp) {
  // Enable/disable autotune
  ipcMain.handle('autotune:setEnabled', (event, enabled) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.setAutotuneEnabled(enabled);
    }
    return false;
  });

  // Update autotune settings
  ipcMain.handle('autotune:setSettings', (event, settings) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.setAutotuneSettings(settings);
    }
    return false;
  });
}
