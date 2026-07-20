import { log } from '../logger.js';
/**
 * Settings IPC Handlers
 * Handles application settings persistence
 * Uses unified settingsService for consistent behavior
 */

import { ipcMain } from 'electron';
import { SETTINGS_CHANNELS } from '../../shared/ipcContracts.js';
import {
  getSetting,
  setSetting,
  getAllSettings,
  setSettings,
} from '../../shared/services/settingsService.js';

/**
 * Register all settings-related IPC handlers
 * @param {Object} _mainApp - Main application instance (unused, kept for signature consistency)
 */
export function registerSettingsHandlers(mainApp) {
  log('📡 Registering settings handlers...');

  // Get setting - uses settingsService which applies defaults
  ipcMain.handle(SETTINGS_CHANNELS.GET, (event, key, defaultValue) => {
    return getSetting(key, defaultValue);
  });

  // Set setting - uses settingsService for persistence, AppState sync, and broadcast
  ipcMain.handle(SETTINGS_CHANNELS.SET, (event, key, value) => {
    const result = setSetting(key, value);
    // Mirror renderer-side settings changes to web admin clients. The web save
    // path already emits these; without this, a toggle flipped in the app never
    // updated an open web admin (the reverse direction worked).
    const io = mainApp?.webServer?.io;
    if (io) {
      if (key === 'waveformPreferences') io.to('admin-clients').emit('settings:waveform', value);
      if (key === 'autoTunePreferences') io.to('admin-clients').emit('settings:autotune', value);
    }
    return result;
  });

  // Get all settings - merged with defaults
  ipcMain.handle(SETTINGS_CHANNELS.GET_ALL, () => {
    return getAllSettings();
  });

  // Update batch - uses settingsService
  ipcMain.handle(SETTINGS_CHANNELS.UPDATE_BATCH, (event, updates) => {
    return setSettings(updates);
  });
}
