/**
 * Effects Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as effectsService from './effectsService.js';

// Mock MainApp for testing
class MockMainApp {
  constructor() {
    this.getEffectsList = vi.fn();
    this.selectEffect = vi.fn();
    this.toggleEffect = vi.fn();
    this.sendToRenderer = vi.fn();
    this.sendToRendererAndWait = vi.fn();
    this.appState = {
      getSnapshot: vi.fn(() => ({
        effects: {
          current: 'defaultEffect',
        },
      })),
      updateEffectsState: vi.fn(),
    };
    this.settings = {
      get: vi.fn(() => ({
        disabledEffects: [],
      })),
      set: vi.fn(),
      save: vi.fn(() => Promise.resolve()),
    };
  }
}

describe('effectsService', () => {
  let mainApp;

  beforeEach(() => {
    mainApp = new MockMainApp();
  });

  describe('getEffects', () => {
    it('should return effects list with current effect and disabled effects', async () => {
      const mockEffects = ['effect1', 'effect2', 'effect3'];
      mainApp.getEffectsList.mockResolvedValue(mockEffects);
      mainApp.appState.getSnapshot.mockReturnValue({
        effects: { current: 'effect2' },
      });
      mainApp.settings.get.mockReturnValue({
        disabledEffects: ['effect3'],
      });

      const result = await effectsService.getEffects(mainApp);

      expect(result.success).toBe(true);
      expect(result.effects).toEqual(mockEffects);
      expect(result.currentEffect).toBe('effect2');
      expect(result.disabledEffects).toEqual(['effect3']);
    });

    it('should handle missing getEffectsList function', async () => {
      mainApp.getEffectsList = undefined;

      const result = await effectsService.getEffects(mainApp);

      expect(result.success).toBe(true);
      expect(result.effects).toEqual([]);
    });

    it('should handle missing effects in state', async () => {
      mainApp.getEffectsList.mockResolvedValue([]);
      mainApp.appState.getSnapshot.mockReturnValue({});

      const result = await effectsService.getEffects(mainApp);

      expect(result.success).toBe(true);
      expect(result.currentEffect).toBeNull();
    });

    it('should handle missing waveformPreferences', async () => {
      mainApp.getEffectsList.mockResolvedValue([]);
      mainApp.settings.get.mockReturnValue({});

      const result = await effectsService.getEffects(mainApp);

      expect(result.success).toBe(true);
      expect(result.disabledEffects).toEqual([]);
    });

    it('should handle errors', async () => {
      mainApp.getEffectsList.mockRejectedValue(new Error('Failed to get effects'));

      const result = await effectsService.getEffects(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to get effects');
      expect(result.effects).toEqual([]);
      expect(result.currentEffect).toBeNull();
      expect(result.disabledEffects).toEqual([]);
    });
  });

  describe('setEffect', () => {
    it('should set effect successfully', async () => {
      mainApp.sendToRendererAndWait.mockResolvedValue();

      const result = await effectsService.setEffect(mainApp, 'myEffect');

      expect(result.success).toBe(true);
      expect(result.effectName).toBe('myEffect');
      expect(mainApp.appState.updateEffectsState).toHaveBeenCalledWith({ current: 'myEffect' });
      expect(mainApp.sendToRendererAndWait).toHaveBeenCalledWith(
        'effects:set',
        { effectName: 'myEffect' },
        2000
      );
    });

    it('should return error when effect name is missing', async () => {
      const result = await effectsService.setEffect(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name is required');
      expect(mainApp.appState.updateEffectsState).not.toHaveBeenCalled();
      expect(mainApp.sendToRendererAndWait).not.toHaveBeenCalled();
    });

    it('should return error when effect name is null', async () => {
      const result = await effectsService.setEffect(mainApp, null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name is required');
    });

    it('should handle renderer communication errors', async () => {
      mainApp.sendToRendererAndWait.mockRejectedValue(new Error('Renderer timeout'));

      const result = await effectsService.setEffect(mainApp, 'myEffect');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Renderer timeout');
    });
  });

  describe('selectEffect', () => {
    it('should select effect successfully', async () => {
      mainApp.selectEffect.mockResolvedValue();

      const result = await effectsService.selectEffect(mainApp, 'effect1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Selected effect: effect1');
      expect(mainApp.selectEffect).toHaveBeenCalledWith('effect1');
    });

    it('should return error when effect name is missing', async () => {
      const result = await effectsService.selectEffect(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name is required');
      expect(mainApp.selectEffect).not.toHaveBeenCalled();
    });

    it('should handle missing selectEffect function', async () => {
      mainApp.selectEffect = undefined;

      const result = await effectsService.selectEffect(mainApp, 'effect1');

      expect(result.success).toBe(true);
    });

    it('should handle selectEffect errors', async () => {
      mainApp.selectEffect.mockRejectedValue(new Error('Selection failed'));

      const result = await effectsService.selectEffect(mainApp, 'effect1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Selection failed');
    });
  });

  describe('toggleEffect', () => {
    it('should enable effect successfully', async () => {
      mainApp.toggleEffect.mockResolvedValue();

      const result = await effectsService.toggleEffect(mainApp, 'effect1', true);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Effect effect1 enabled');
      expect(mainApp.toggleEffect).toHaveBeenCalledWith('effect1', true);
    });

    it('should disable effect successfully', async () => {
      mainApp.toggleEffect.mockResolvedValue();

      const result = await effectsService.toggleEffect(mainApp, 'effect1', false);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Effect effect1 disabled');
      expect(mainApp.toggleEffect).toHaveBeenCalledWith('effect1', false);
    });

    it('should return error when effect name is missing', async () => {
      const result = await effectsService.toggleEffect(mainApp, '', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name and enabled status required');
      expect(mainApp.toggleEffect).not.toHaveBeenCalled();
    });

    it('should return error when enabled is not boolean', async () => {
      const result = await effectsService.toggleEffect(mainApp, 'effect1', 'yes');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name and enabled status required');
    });

    it('should handle missing toggleEffect function', async () => {
      mainApp.toggleEffect = undefined;

      const result = await effectsService.toggleEffect(mainApp, 'effect1', true);

      expect(result.success).toBe(true);
    });

    it('should handle toggleEffect errors', async () => {
      mainApp.toggleEffect.mockRejectedValue(new Error('Toggle failed'));

      const result = await effectsService.toggleEffect(mainApp, 'effect1', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Toggle failed');
    });
  });

  describe('nextEffect', () => {
    it('should send next effect command', () => {
      const result = effectsService.nextEffect(mainApp);

      expect(result.success).toBe(true);
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('effects:next');
    });

    it('should handle sendToRenderer errors', () => {
      mainApp.sendToRenderer.mockImplementation(() => {
        throw new Error('Send failed');
      });

      const result = effectsService.nextEffect(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Send failed');
    });
  });

  describe('previousEffect', () => {
    it('should send previous effect command', () => {
      const result = effectsService.previousEffect(mainApp);

      expect(result.success).toBe(true);
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('effects:previous');
    });

    it('should handle sendToRenderer errors', () => {
      mainApp.sendToRenderer.mockImplementation(() => {
        throw new Error('Send failed');
      });

      const result = effectsService.previousEffect(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Send failed');
    });
  });

  describe('randomEffect', () => {
    it('should send random effect command', () => {
      const result = effectsService.randomEffect(mainApp);

      expect(result.success).toBe(true);
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('effects:random');
    });

    it('should handle sendToRenderer errors', () => {
      mainApp.sendToRenderer.mockImplementation(() => {
        throw new Error('Send failed');
      });

      const result = effectsService.randomEffect(mainApp);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Send failed');
    });
  });

  describe('disableEffect', () => {
    it('should disable effect and save to settings', async () => {
      mainApp.settings.get.mockReturnValue({
        disabledEffects: [],
      });

      const result = await effectsService.disableEffect(mainApp, 'effect1');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual(['effect1']);
      expect(mainApp.settings.set).toHaveBeenCalledWith('waveformPreferences', {
        disabledEffects: ['effect1'],
      });
      expect(mainApp.settings.save).toHaveBeenCalled();
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('effects:disable', 'effect1');
    });

    it('should add to existing disabled effects', async () => {
      mainApp.settings.get.mockReturnValue({
        disabledEffects: ['effect1', 'effect2'],
      });

      const result = await effectsService.disableEffect(mainApp, 'effect3');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual(['effect1', 'effect2', 'effect3']);
    });

    it('should not duplicate if already disabled', async () => {
      mainApp.settings.get.mockReturnValue({
        disabledEffects: ['effect1'],
      });

      const result = await effectsService.disableEffect(mainApp, 'effect1');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual(['effect1']);
      expect(mainApp.settings.save).not.toHaveBeenCalled();
    });

    it('should return error when effect name is missing', async () => {
      const result = await effectsService.disableEffect(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name is required');
      expect(mainApp.settings.save).not.toHaveBeenCalled();
    });

    it('should handle missing disabledEffects array', async () => {
      mainApp.settings.get.mockReturnValue({});

      const result = await effectsService.disableEffect(mainApp, 'effect1');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual(['effect1']);
    });

    it('should handle settings save errors', async () => {
      mainApp.settings.get.mockReturnValue({ disabledEffects: [] });
      mainApp.settings.save.mockRejectedValue(new Error('Save failed'));

      const result = await effectsService.disableEffect(mainApp, 'effect1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Save failed');
    });
  });

  describe('enableEffect', () => {
    it('should enable effect and save to settings', async () => {
      mainApp.settings.get.mockReturnValue({
        disabledEffects: ['effect1', 'effect2', 'effect3'],
      });

      const result = await effectsService.enableEffect(mainApp, 'effect2');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual(['effect1', 'effect3']);
      expect(mainApp.settings.set).toHaveBeenCalledWith('waveformPreferences', {
        disabledEffects: ['effect1', 'effect3'],
      });
      expect(mainApp.settings.save).toHaveBeenCalled();
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('effects:enable', 'effect2');
    });

    it('should handle effect not in disabled list', async () => {
      mainApp.settings.get.mockReturnValue({
        disabledEffects: ['effect1'],
      });

      const result = await effectsService.enableEffect(mainApp, 'effect2');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual(['effect1']);
    });

    it('should return error when effect name is missing', async () => {
      const result = await effectsService.enableEffect(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Effect name is required');
      expect(mainApp.settings.save).not.toHaveBeenCalled();
    });

    it('should handle missing disabledEffects array', async () => {
      mainApp.settings.get.mockReturnValue({});

      const result = await effectsService.enableEffect(mainApp, 'effect1');

      expect(result.success).toBe(true);
      expect(result.disabled).toEqual([]);
    });

    it('should handle settings save errors', async () => {
      mainApp.settings.get.mockReturnValue({ disabledEffects: ['effect1'] });
      mainApp.settings.save.mockRejectedValue(new Error('Save failed'));

      const result = await effectsService.enableEffect(mainApp, 'effect1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Save failed');
    });
  });
});
