/**
 * Settings Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to test the module fresh each time, so we'll use dynamic imports
// and resetModules to avoid state pollution between tests
describe('settingsService', () => {
  let settingsService;
  let mockSettingsManager;
  let mockAppState;
  let mockBroadcastFn;

  beforeEach(async () => {
    // Reset module state before each test
    vi.resetModules();

    // Create fresh mocks
    mockSettingsManager = {
      get: vi.fn(),
      set: vi.fn(),
      getAll: vi.fn(() => ({})),
    };

    mockAppState = {
      state: {
        mixer: { PA: { gain: 0 }, IEM: { gain: 0 } },
        effects: { reverb: 0.5 },
      },
      update: vi.fn(),
      updatePreferences: vi.fn(),
      setAudioDevices: vi.fn(),
    };

    mockBroadcastFn = vi.fn();

    // Import fresh module
    settingsService = await import('./settingsService.js');
  });

  describe('initSettingsService', () => {
    it('should initialize the service', () => {
      expect(settingsService.isInitialized()).toBe(false);

      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      expect(settingsService.isInitialized()).toBe(true);
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      expect(settingsService.isInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);
      expect(settingsService.isInitialized()).toBe(true);
    });
  });

  describe('getSetting', () => {
    it('should return default value when not initialized', () => {
      const result = settingsService.getSetting('someKey', 'defaultValue');
      expect(result).toBe('defaultValue');
    });

    it('should return saved value when available', () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);
      mockSettingsManager.get.mockReturnValue('savedValue');

      const result = settingsService.getSetting('someKey');

      expect(mockSettingsManager.get).toHaveBeenCalledWith('someKey');
      expect(result).toBe('savedValue');
    });

    it('should return explicit default when saved value is undefined', () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);
      mockSettingsManager.get.mockReturnValue(undefined);

      const result = settingsService.getSetting('someKey', 'explicitDefault');

      expect(result).toBe('explicitDefault');
    });

    it('should support dot notation for defaults lookup', () => {
      // This tests the getDefaultForKey internal function
      const result = settingsService.getSetting('nonexistent.nested.key', 'fallback');
      expect(result).toBe('fallback');
    });
  });

  describe('getAllSettings', () => {
    it('should return defaults when not initialized', () => {
      const result = settingsService.getAllSettings();
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should merge saved settings with defaults', () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);
      mockSettingsManager.getAll.mockReturnValue({ customKey: 'customValue' });

      const result = settingsService.getAllSettings();

      expect(mockSettingsManager.getAll).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('setSetting', () => {
    it('should return error when not initialized', async () => {
      const result = await settingsService.setSetting('key', 'value');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Settings service not initialized');
    });

    it('should persist, sync, and broadcast by default', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      const result = await settingsService.setSetting('mixer', { PA: { gain: 5 } });

      expect(result.success).toBe(true);
      expect(mockSettingsManager.set).toHaveBeenCalledWith('mixer', { PA: { gain: 5 } });
      expect(mockBroadcastFn).toHaveBeenCalledWith('mixer', { PA: { gain: 5 } });
    });

    it('should skip broadcast when skipBroadcast is true', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('key', 'value', { skipBroadcast: true });

      expect(mockBroadcastFn).not.toHaveBeenCalled();
    });

    it('should skip persist when skipPersist is true', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('key', 'value', { skipPersist: true });

      expect(mockSettingsManager.set).not.toHaveBeenCalled();
    });

    it('should sync mixer settings to AppState', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('mixer', { PA: { gain: 10 } });

      expect(mockAppState.update).toHaveBeenCalledWith('mixer', { PA: { gain: 10 } });
    });

    it('should sync effects settings to AppState', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('effects', { reverb: 0.8 });

      expect(mockAppState.update).toHaveBeenCalled();
    });

    it('should sync autoTune settings via updatePreferences', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('autoTune', { enabled: true });

      expect(mockAppState.updatePreferences).toHaveBeenCalledWith('autoTune', { enabled: true });
    });

    it('should sync microphone settings via updatePreferences', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('microphone', { gain: 0.5 });

      expect(mockAppState.updatePreferences).toHaveBeenCalledWith('microphone', { gain: 0.5 });
    });

    it('should sync audioDevices via setAudioDevices', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('audioDevices', { PA: 'device1' });

      expect(mockAppState.setAudioDevices).toHaveBeenCalledWith({ PA: 'device1' });
    });

    it('should sync iemMonoVocals via updatePreferences', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSetting('iemMonoVocals', true);

      expect(mockAppState.updatePreferences).toHaveBeenCalledWith('iemMonoVocals', true);
    });
  });

  describe('setSettings', () => {
    it('should update multiple settings', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      const result = await settingsService.setSettings({
        key1: 'value1',
        key2: 'value2',
      });

      expect(result.success).toBe(true);
      expect(mockSettingsManager.set).toHaveBeenCalledWith('key1', 'value1');
      expect(mockSettingsManager.set).toHaveBeenCalledWith('key2', 'value2');
    });

    it('should broadcast batch update', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSettings({ key1: 'value1', key2: 'value2' });

      expect(mockBroadcastFn).toHaveBeenCalledWith('settings:batch', {
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('should skip broadcast when option is set', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);

      await settingsService.setSettings({ key1: 'value1' }, { skipBroadcast: true });

      expect(mockBroadcastFn).not.toHaveBeenCalled();
    });
  });

  describe('loadAndSync', () => {
    it('should load all settings and sync to AppState', async () => {
      settingsService.initSettingsService(mockSettingsManager, mockAppState, mockBroadcastFn);
      mockSettingsManager.getAll.mockReturnValue({
        mixer: { PA: { gain: 5 } },
        effects: { reverb: 0.3 },
      });

      const result = await settingsService.loadAndSync();

      expect(result).toBeDefined();
      expect(mockAppState.update).toHaveBeenCalled();
    });
  });

  describe('getBroadcastChannel', () => {
    it('should return correct channel for mixer', () => {
      const channel = settingsService.getBroadcastChannel('mixer');
      expect(channel).toBe('mixer:state');
    });

    it('should return correct channel for effects', () => {
      const channel = settingsService.getBroadcastChannel('effects');
      expect(channel).toBe('effects:changed');
    });

    it('should return correct channel for waveformPreferences', () => {
      const channel = settingsService.getBroadcastChannel('waveformPreferences');
      expect(channel).toBe('waveform:settingsChanged');
    });

    it('should return correct channel for autoTune', () => {
      const channel = settingsService.getBroadcastChannel('autoTune');
      expect(channel).toBe('autotune:settingsChanged');
    });

    it('should return correct channel for microphone', () => {
      const channel = settingsService.getBroadcastChannel('microphone');
      expect(channel).toBe('preferences:updated');
    });

    it('should return correct channel for settings:batch', () => {
      const channel = settingsService.getBroadcastChannel('settings:batch');
      expect(channel).toBe('settings:updated');
    });

    it('should return default channel for unknown keys', () => {
      const channel = settingsService.getBroadcastChannel('unknownKey');
      expect(channel).toBe('settings:unknownKey');
    });
  });

  describe('default export', () => {
    it('should export all functions', () => {
      expect(settingsService.default).toBeDefined();
      expect(settingsService.default.initSettingsService).toBeDefined();
      expect(settingsService.default.isInitialized).toBeDefined();
      expect(settingsService.default.getSetting).toBeDefined();
      expect(settingsService.default.getAllSettings).toBeDefined();
      expect(settingsService.default.setSetting).toBeDefined();
      expect(settingsService.default.setSettings).toBeDefined();
      expect(settingsService.default.loadAndSync).toBeDefined();
      expect(settingsService.default.getBroadcastChannel).toBeDefined();
    });
  });
});
