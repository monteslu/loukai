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
export function registerSettingsHandlers(_mainApp) {
  console.log('📡 Registering settings handlers...');

  // Get setting - uses settingsService which applies defaults
  ipcMain.handle(SETTINGS_CHANNELS.GET, (event, key, defaultValue) => {
    return getSetting(key, defaultValue);
  });

  // Set setting - uses settingsService for persistence, AppState sync, and broadcast
  ipcMain.handle(SETTINGS_CHANNELS.SET, async (event, key, value) => {
    return setSetting(key, value);
  });

  // Get all settings - merged with defaults
  ipcMain.handle(SETTINGS_CHANNELS.GET_ALL, () => {
    return getAllSettings();
  });

  // Update batch - uses settingsService
  ipcMain.handle(SETTINGS_CHANNELS.UPDATE_BATCH, async (event, updates) => {
    return setSettings(updates);
  });
}
