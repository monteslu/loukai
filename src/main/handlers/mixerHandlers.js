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

  // Per-bus per-stem mixer (stem×bus mixer, #49). Replaces the dormant ghost-mixer
  // channels (toggleMute/toggleSolo/setGain/applyPreset/recallScene) that routed to
  // the state-only main-process audioEngine stub and never reached audio.
  ipcMain.handle(MIXER_CHANNELS.SET_STEM_GAIN, (event, bus, stem, gain) => {
    return mixerService.setStemGain(mainApp, bus, stem, gain);
  });

  ipcMain.handle('mixer:setKeyShift', (event, semitones) => {
    return mixerService.setKeyShift(mainApp, semitones);
  });

  ipcMain.handle(MIXER_CHANNELS.SET_STEM_MUTE, (event, bus, stem, muted) => {
    return mixerService.setStemMute(mainApp, bus, stem, muted);
  });

  ipcMain.handle(MIXER_CHANNELS.TOGGLE_STEM_MUTE, (event, bus, stem) => {
    return mixerService.toggleStemMute(mainApp, bus, stem);
  });
}
