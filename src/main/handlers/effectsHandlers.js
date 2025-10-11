/**
 * Effects IPC Handlers
 * Handles all visual effects management operations
 */

import { ipcMain } from 'electron';
import * as effectsService from '../../shared/services/effectsService.js';

/**
 * Register all effects-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerEffectsHandlers(mainApp) {
  // Get list of all effects
  ipcMain.handle('effects:getList', async () => {
    try {
      // Send message to renderer to get effects list
      return await mainApp.sendToRendererAndWait('effects:getList');
    } catch (error) {
      console.error('Failed to get effects list:', error);
      return [];
    }
  });

  // Get currently selected effect
  ipcMain.handle('effects:getCurrent', async () => {
    try {
      return await mainApp.sendToRendererAndWait('effects:getCurrent');
    } catch (error) {
      console.error('Failed to get current effect:', error);
      return null;
    }
  });

  // Get list of disabled effects
  ipcMain.handle('effects:getDisabled', async () => {
    try {
      return await mainApp.sendToRendererAndWait('effects:getDisabled');
    } catch (error) {
      console.error('Failed to get disabled effects:', error);
      return [];
    }
  });

  // Select an effect
  ipcMain.handle('effects:select', (event, effectName) => {
    try {
      // Update AppState so web admin and other clients can see current effect
      mainApp.appState.updateEffectsState({ current: effectName });
      return { success: true };
    } catch (error) {
      console.error('Failed to select effect:', error);
      return { success: false, error: error.message };
    }
  });

  // Toggle effect enabled/disabled
  ipcMain.handle('effects:toggle', (event, effectName, enabled) => {
    try {
      mainApp.sendToRenderer('effects:toggle', { effectName, enabled });
      return { success: true };
    } catch (error) {
      console.error('Failed to toggle effect:', error);
      return { success: false, error: error.message };
    }
  });

  // Go to next effect
  ipcMain.handle('effects:next', async () => {
    try {
      const result = await effectsService.nextEffect(mainApp);
      return result;
    } catch (error) {
      console.error('Failed to go to next effect:', error);
      return { success: false, error: error.message };
    }
  });

  // Go to previous effect
  ipcMain.handle('effects:previous', async () => {
    try {
      const result = await effectsService.previousEffect(mainApp);
      return result;
    } catch (error) {
      console.error('Failed to go to previous effect:', error);
      return { success: false, error: error.message };
    }
  });

  // Select random effect
  ipcMain.handle('effects:random', async () => {
    try {
      const result = await effectsService.randomEffect(mainApp);
      return result;
    } catch (error) {
      console.error('Failed to select random effect:', error);
      return { success: false, error: error.message };
    }
  });
}
