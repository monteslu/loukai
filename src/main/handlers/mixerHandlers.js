/**
 * Mixer IPC Handlers
 * Handles all mixer control operations
 */

import { ipcMain } from 'electron';
import { MIXER_CHANNELS } from '../../shared/ipcContracts.js';
import * as mixerService from '../../shared/services/mixerService.js';

/**
 * Register all mixer-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerMixerHandlers(mainApp) {
  // Set master gain
  ipcMain.handle(MIXER_CHANNELS.SET_MASTER_GAIN, (event, bus, gainDb) => {
    return mixerService.setMasterGain(mainApp, bus, gainDb);
  });

  // Toggle master mute
  ipcMain.handle(MIXER_CHANNELS.TOGGLE_MASTER_MUTE, (event, bus) => {
    return mixerService.toggleMasterMute(mainApp, bus);
  });

  // Toggle stem mute
  ipcMain.handle('mixer:toggleMute', (event, stemId, bus) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.toggleMute(stemId, bus);
    }
    return false;
  });

  // Toggle stem solo
  ipcMain.handle('mixer:toggleSolo', (event, stemId) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.toggleSolo(stemId);
    }
    return false;
  });

  // Set stem gain
  ipcMain.handle('mixer:setGain', (event, stemId, gainDb) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.setGain(stemId, gainDb);
    }
    return false;
  });

  // Apply mixer preset
  ipcMain.handle('mixer:applyPreset', (event, presetId) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.applyPreset(presetId);
    }
    return false;
  });

  // Recall mixer scene
  ipcMain.handle('mixer:recallScene', (event, sceneId) => {
    if (mainApp.audioEngine) {
      return mainApp.audioEngine.recallScene(sceneId);
    }
    return false;
  });
}
