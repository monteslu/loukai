/**
 * Mixer Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mixerService from './mixerService.js';

// Mock AppState
class MockAppState {
  constructor() {
    this.state = {
      mixer: {
        PA: { gain: 0, muted: false },
        IEM: { gain: 0, muted: false },
        mic: { gain: -6, muted: false },
      },
    };
    this.updateMixerState = vi.fn();
  }

  getSnapshot() {
    return { ...this.state };
  }
}

// Mock MainApp for testing
class MockMainApp {
  constructor() {
    this.appState = new MockAppState();
    this.sendToRenderer = vi.fn();
  }
}

describe('mixerService', () => {
  let mainApp;
  let appState;

  beforeEach(() => {
    mainApp = new MockMainApp();
    appState = mainApp.appState;
  });

  describe('getMixerState', () => {
    it('should return mixer state successfully', () => {
      const result = mixerService.getMixerState(appState);

      expect(result.success).toBe(true);
      expect(result.mixer).toBeDefined();
      expect(result.mixer.PA).toEqual({ gain: 0, muted: false });
      expect(result.mixer.IEM).toEqual({ gain: 0, muted: false });
      expect(result.mixer.mic).toEqual({ gain: -6, muted: false });
    });

    it('should handle getSnapshot errors', () => {
      appState.getSnapshot = vi.fn(() => {
        throw new Error('Snapshot failed');
      });

      const result = mixerService.getMixerState(appState);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Snapshot failed');
    });

    it('should return mixer even if empty', () => {
      appState.state.mixer = {};

      const result = mixerService.getMixerState(appState);

      expect(result.success).toBe(true);
      expect(result.mixer).toEqual({});
    });
  });

  describe('setMasterGain', () => {
    it('should set PA gain successfully', () => {
      const result = mixerService.setMasterGain(mainApp, 'PA', 3);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('PA');
      expect(result.gainDb).toBe(3);
      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: expect.objectContaining({
            gain: 3,
            muted: false,
          }),
        })
      );
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('mixer:setMasterGain', {
        bus: 'PA',
        gainDb: 3,
      });
    });

    it('should set IEM gain successfully', () => {
      const result = mixerService.setMasterGain(mainApp, 'IEM', -2);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('IEM');
      expect(result.gainDb).toBe(-2);
    });

    it('should set mic gain successfully', () => {
      const result = mixerService.setMasterGain(mainApp, 'mic', -10);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('mic');
      expect(result.gainDb).toBe(-10);
    });

    it('should preserve other mixer state when updating', () => {
      appState.state.mixer.PA.muted = true;

      mixerService.setMasterGain(mainApp, 'PA', 5);

      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: {
            gain: 5,
            muted: true, // Preserved
          },
        })
      );
    });

    it('should return error when bus is missing', () => {
      const result = mixerService.setMasterGain(mainApp, '', 0);

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) and gainDb required');
      expect(appState.updateMixerState).not.toHaveBeenCalled();
      expect(mainApp.sendToRenderer).not.toHaveBeenCalled();
    });

    it('should return error when gainDb is not a number', () => {
      const result = mixerService.setMasterGain(mainApp, 'PA', 'loud');

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) and gainDb required');
    });

    it('should handle zero gain', () => {
      const result = mixerService.setMasterGain(mainApp, 'PA', 0);

      expect(result.success).toBe(true);
      expect(result.gainDb).toBe(0);
    });

    it('should handle negative gain', () => {
      const result = mixerService.setMasterGain(mainApp, 'PA', -12);

      expect(result.success).toBe(true);
      expect(result.gainDb).toBe(-12);
    });

    it('should handle large positive gain', () => {
      const result = mixerService.setMasterGain(mainApp, 'PA', 20);

      expect(result.success).toBe(true);
      expect(result.gainDb).toBe(20);
    });

    it('should handle unknown bus gracefully', () => {
      const result = mixerService.setMasterGain(mainApp, 'unknownBus', 0);

      expect(result.success).toBe(true);
      expect(appState.updateMixerState).not.toHaveBeenCalled();
      expect(mainApp.sendToRenderer).toHaveBeenCalled();
    });

    it('should handle sendToRenderer errors', () => {
      mainApp.sendToRenderer = vi.fn(() => {
        throw new Error('Renderer not available');
      });

      const result = mixerService.setMasterGain(mainApp, 'PA', 0);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Renderer not available');
    });
  });

  describe('toggleMasterMute', () => {
    it('should toggle PA mute from false to true', () => {
      appState.state.mixer.PA.muted = false;

      const result = mixerService.toggleMasterMute(mainApp, 'PA');

      expect(result.success).toBe(true);
      expect(result.bus).toBe('PA');
      expect(result.muted).toBe(true);
      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: expect.objectContaining({
            muted: true,
          }),
        })
      );
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('mixer:toggleMasterMute', {
        bus: 'PA',
        muted: true,
      });
    });

    it('should toggle PA mute from true to false', () => {
      appState.state.mixer.PA.muted = true;

      const result = mixerService.toggleMasterMute(mainApp, 'PA');

      expect(result.success).toBe(true);
      expect(result.muted).toBe(false);
    });

    it('should toggle IEM mute', () => {
      appState.state.mixer.IEM.muted = false;

      const result = mixerService.toggleMasterMute(mainApp, 'IEM');

      expect(result.success).toBe(true);
      expect(result.bus).toBe('IEM');
      expect(result.muted).toBe(true);
    });

    it('should toggle mic mute', () => {
      appState.state.mixer.mic.muted = false;

      const result = mixerService.toggleMasterMute(mainApp, 'mic');

      expect(result.success).toBe(true);
      expect(result.bus).toBe('mic');
      expect(result.muted).toBe(true);
    });

    it('should preserve gain when toggling mute', () => {
      appState.state.mixer.PA.gain = 5;
      appState.state.mixer.PA.muted = false;

      mixerService.toggleMasterMute(mainApp, 'PA');

      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: {
            gain: 5, // Preserved
            muted: true,
          },
        })
      );
    });

    it('should return error when bus is missing', () => {
      const result = mixerService.toggleMasterMute(mainApp, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) required');
      expect(appState.updateMixerState).not.toHaveBeenCalled();
      expect(mainApp.sendToRenderer).not.toHaveBeenCalled();
    });

    it('should return error when bus is null', () => {
      const result = mixerService.toggleMasterMute(mainApp, null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) required');
    });

    it('should handle unknown bus gracefully', () => {
      const result = mixerService.toggleMasterMute(mainApp, 'unknownBus');

      expect(result.success).toBe(true);
      expect(result.muted).toBe(false); // Default when bus doesn't exist
      expect(appState.updateMixerState).not.toHaveBeenCalled();
    });

    it('should handle sendToRenderer errors', () => {
      mainApp.sendToRenderer = vi.fn(() => {
        throw new Error('Renderer error');
      });

      const result = mixerService.toggleMasterMute(mainApp, 'PA');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Renderer error');
    });
  });

  describe('setMasterMute', () => {
    it('should mute PA bus', () => {
      appState.state.mixer.PA.muted = false;

      const result = mixerService.setMasterMute(mainApp, 'PA', true);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('PA');
      expect(result.muted).toBe(true);
      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: expect.objectContaining({
            muted: true,
          }),
        })
      );
      expect(mainApp.sendToRenderer).toHaveBeenCalledWith('mixer:setMasterMute', {
        bus: 'PA',
        muted: true,
      });
    });

    it('should unmute PA bus', () => {
      appState.state.mixer.PA.muted = true;

      const result = mixerService.setMasterMute(mainApp, 'PA', false);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('PA');
      expect(result.muted).toBe(false);
      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: expect.objectContaining({
            muted: false,
          }),
        })
      );
    });

    it('should mute IEM bus', () => {
      const result = mixerService.setMasterMute(mainApp, 'IEM', true);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('IEM');
      expect(result.muted).toBe(true);
    });

    it('should mute mic bus', () => {
      const result = mixerService.setMasterMute(mainApp, 'mic', true);

      expect(result.success).toBe(true);
      expect(result.bus).toBe('mic');
      expect(result.muted).toBe(true);
    });

    it('should preserve gain when setting mute', () => {
      appState.state.mixer.PA.gain = 10;

      mixerService.setMasterMute(mainApp, 'PA', true);

      expect(appState.updateMixerState).toHaveBeenCalledWith(
        expect.objectContaining({
          PA: {
            gain: 10, // Preserved
            muted: true,
          },
        })
      );
    });

    it('should return error when bus is missing', () => {
      const result = mixerService.setMasterMute(mainApp, '', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) and muted status required');
      expect(appState.updateMixerState).not.toHaveBeenCalled();
      expect(mainApp.sendToRenderer).not.toHaveBeenCalled();
    });

    it('should return error when muted is not boolean', () => {
      const result = mixerService.setMasterMute(mainApp, 'PA', 'yes');

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) and muted status required');
    });

    it('should return error when muted is null', () => {
      const result = mixerService.setMasterMute(mainApp, 'PA', null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('bus (PA/IEM/mic) and muted status required');
    });

    it('should handle unknown bus gracefully', () => {
      const result = mixerService.setMasterMute(mainApp, 'unknownBus', true);

      expect(result.success).toBe(true);
      expect(appState.updateMixerState).not.toHaveBeenCalled();
      expect(mainApp.sendToRenderer).toHaveBeenCalled();
    });

    it('should handle sendToRenderer errors', () => {
      mainApp.sendToRenderer = vi.fn(() => {
        throw new Error('Communication error');
      });

      const result = mixerService.setMasterMute(mainApp, 'PA', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Communication error');
    });
  });
});
