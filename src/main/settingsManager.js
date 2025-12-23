import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { ALL_DEFAULTS, mergeWithDefaults } from '../shared/defaults.js';

class SettingsManager {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = null;
    this.saveTimeout = null;
    this.isDirty = false;
  }

  async load() {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      this.settings = JSON.parse(data);
    } catch {
      // Try to restore from backup if main file is corrupted
      const backupPath = this.settingsPath + '.backup';
      try {
        const backupData = await fs.readFile(backupPath, 'utf8');
        this.settings = JSON.parse(backupData);

        // Save the restored settings back to main file
        await this.save();
      } catch {
        // Backup also failed or doesn't exist, use defaults
        this.settings = { ...ALL_DEFAULTS };
      }
    }
    return this.settings;
  }

  /**
   * Get all settings merged with defaults
   */
  getAll() {
    if (!this.settings) {
      return { ...ALL_DEFAULTS };
    }
    return mergeWithDefaults(this.settings);
  }

  async save() {
    if (!this.isDirty) {
      return; // No changes since last save
    }

    try {
      // Validate that settings can be serialized to JSON
      const jsonString = JSON.stringify(this.settings, null, 2);

      // Validate that it can be parsed back (catch any JSON issues)
      JSON.parse(jsonString);

      // Create backup of existing file before overwriting
      const backupPath = this.settingsPath + '.backup';
      try {
        await fs.copyFile(this.settingsPath, backupPath);
      } catch (backupError) {
        // File might not exist yet, that's okay
        if (backupError.code !== 'ENOENT') {
          console.warn('⚠️ Could not create settings backup:', backupError.message);
        }
      }

      // Write directly
      await fs.writeFile(this.settingsPath, jsonString, 'utf8');

      this.isDirty = false;
    } catch (error) {
      console.error('❌ Failed to save settings:', error);
      throw error; // Propagate error so caller knows save failed
    }
  }

  get(key, defaultValue = undefined) {
    if (!this.settings) {
      throw new Error('Settings not loaded. Call load() first.');
    }

    // Check if key exists in saved settings
    if (this.settings[key] !== undefined) {
      return this.settings[key];
    }

    // Fall back to provided default, then ALL_DEFAULTS
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // Check ALL_DEFAULTS for this key
    if (key in ALL_DEFAULTS) {
      return ALL_DEFAULTS[key];
    }

    return null;
  }

  set(key, value) {
    if (!this.settings) {
      throw new Error('Settings not loaded. Call load() first.');
    }
    this.settings[key] = value;
    this.isDirty = true;

    // Debounce saves - wait 1 second after last change before saving
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save();
    }, 1000);
  }

  /**
   * Force immediate save (used on app quit)
   */
  async saveNow() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.isDirty) {
      await this.save();
    }
  }

  getSongsFolder() {
    return this.get('songsFolder');
  }

  setSongsFolder(folderPath) {
    this.set('songsFolder', folderPath);
  }
}

export default SettingsManager;
