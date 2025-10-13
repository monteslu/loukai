/**
 * IPC Handler Registration
 * Central registration point for all IPC handlers
 */

import { registerAudioHandlers } from './audioHandlers.js';
import { registerMixerHandlers } from './mixerHandlers.js';
import { registerPlayerHandlers } from './playerHandlers.js';
import { registerLibraryHandlers } from './libraryHandlers.js';
import { registerSettingsHandlers } from './settingsHandlers.js';
import { registerQueueHandlers } from './queueHandlers.js';
import { registerWebServerHandlers } from './webServerHandlers.js';
import { registerCanvasHandlers } from './canvasHandlers.js';
import { registerEffectsHandlers } from './effectsHandlers.js';
import { registerEditorHandlers } from './editorHandlers.js';
import { registerPreferencesHandlers } from './preferencesHandlers.js';
import { registerFileHandlers } from './fileHandlers.js';
import { registerRendererHandlers } from './rendererHandlers.js';
import { registerAppHandlers } from './appHandlers.js';
import { registerAutotuneHandlers } from './autotuneHandlers.js';

/**
 * Register all IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerAllHandlers(mainApp) {
  console.log('📡 Registering IPC handlers...');

  try {
    // Core handlers
    registerAudioHandlers(mainApp);
    registerMixerHandlers(mainApp);
    registerPlayerHandlers(mainApp);
    registerLibraryHandlers(mainApp);
    registerSettingsHandlers(mainApp);
    registerQueueHandlers(mainApp);

    // Feature handlers
    registerWebServerHandlers(mainApp);
    registerCanvasHandlers(mainApp);
    registerEffectsHandlers(mainApp);
    registerEditorHandlers(mainApp);
    registerPreferencesHandlers(mainApp);
    registerAutotuneHandlers(mainApp);

    // System handlers
    registerFileHandlers(mainApp);
    registerRendererHandlers(mainApp);
    registerAppHandlers(mainApp);

    console.log('✅ All IPC handlers registered');
  } catch (error) {
    console.error('❌ Failed to register IPC handlers:', error);
    throw error;
  }
}
