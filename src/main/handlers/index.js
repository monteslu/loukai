/**
 * IPC Handler Registration
 * Central registration point for all IPC handlers
 */

import { log } from '../logger.js';

log('📦 Loading handler modules...');

import { registerAudioHandlers } from './audioHandlers.js';
log('✓ audioHandlers');
import { registerMixerHandlers } from './mixerHandlers.js';
log('✓ mixerHandlers');
import { registerPlayerHandlers } from './playerHandlers.js';
log('✓ playerHandlers');
import { registerLibraryHandlers } from './libraryHandlers.js';
log('✓ libraryHandlers');
import { registerSettingsHandlers } from './settingsHandlers.js';
log('✓ settingsHandlers');
import { registerQueueHandlers } from './queueHandlers.js';
log('✓ queueHandlers');
import { registerWebServerHandlers } from './webServerHandlers.js';
log('✓ webServerHandlers');
import { registerCanvasHandlers } from './canvasHandlers.js';
log('✓ canvasHandlers');
import { registerEffectsHandlers } from './effectsHandlers.js';
log('✓ effectsHandlers');
import { registerEditorHandlers } from './editorHandlers.js';
log('✓ editorHandlers');
import { registerPreferencesHandlers } from './preferencesHandlers.js';
log('✓ preferencesHandlers');
import { registerFileHandlers } from './fileHandlers.js';
log('✓ fileHandlers');
import { registerRendererHandlers } from './rendererHandlers.js';
log('✓ rendererHandlers');
import { registerAppHandlers } from './appHandlers.js';
log('✓ appHandlers');
import { registerAutotuneHandlers } from './autotuneHandlers.js';
log('✓ autotuneHandlers');
import { registerCreatorHandlers } from './creatorHandlers.js';
log('✓ creatorHandlers');

/**
 * Register all IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerAllHandlers(mainApp) {
  log('📡 Registering IPC handlers...');

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

    // Creator handlers
    registerCreatorHandlers(mainApp);

    log('✅ All IPC handlers registered');
  } catch (error) {
    console.error('❌ Failed to register IPC handlers:', error);
    throw error;
  }
}
