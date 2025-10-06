/**
 * Preferences IPC Handlers
 * Handles user preferences management
 */

import { ipcMain } from 'electron';
import * as preferencesService from '../../shared/services/preferencesService.js';

/**
 * Register all preferences-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerPreferencesHandlers(mainApp) {
  // Update auto-tune preferences
  ipcMain.handle('preferences:setAutoTune', async (event, prefs) => {
    try {
      const result = await preferencesService.updateAutoTunePreferences(mainApp.appState, prefs);
      return result;
    } catch (error) {
      console.error('Failed to update auto-tune preferences:', error);
      return { success: false, error: error.message };
    }
  });

  // Update microphone preferences
  ipcMain.handle('preferences:setMicrophone', async (event, prefs) => {
    try {
      const result = await preferencesService.updateMicrophonePreferences(mainApp.appState, prefs);
      return result;
    } catch (error) {
      console.error('Failed to update microphone preferences:', error);
      return { success: false, error: error.message };
    }
  });

  // Update effects preferences
  ipcMain.handle('preferences:setEffects', async (event, prefs) => {
    try {
      const result = await preferencesService.updateEffectsPreferences(mainApp.appState, prefs);
      return result;
    } catch (error) {
      console.error('Failed to update effects preferences:', error);
      return { success: false, error: error.message };
    }
  });
}
