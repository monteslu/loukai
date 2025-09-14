const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;

class SettingsManager {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = null;
  }

  async load() {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      this.settings = JSON.parse(data);
      console.log('📁 Settings loaded:', this.settings);
    } catch (error) {
      // File doesn't exist or is corrupted, use defaults
      this.settings = {
        songsFolder: null,
        lastOpenedFile: null,
        windowBounds: null
      };
      console.log('📁 Using default settings');
    }
    return this.settings;
  }

  async save() {
    try {
      await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2));
      console.log('💾 Settings saved');
    } catch (error) {
      console.error('❌ Failed to save settings:', error);
    }
  }

  get(key, defaultValue = null) {
    if (!this.settings) {
      throw new Error('Settings not loaded. Call load() first.');
    }
    return this.settings[key] !== undefined ? this.settings[key] : defaultValue;
  }

  set(key, value) {
    if (!this.settings) {
      throw new Error('Settings not loaded. Call load() first.');
    }
    this.settings[key] = value;
    // Auto-save on changes
    this.save();
  }

  getSongsFolder() {
    return this.get('songsFolder');
  }

  setSongsFolder(folderPath) {
    this.set('songsFolder', folderPath);
  }
}

module.exports = SettingsManager;