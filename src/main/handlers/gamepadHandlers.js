/**
 * Gamepad IPC Handlers
 * Relays SDL controller state from the main process to the renderer, where the
 * preload shim backs `navigator.getGamepads()` with it.
 */

import { ipcMain } from 'electron';
import { GAMEPAD_CHANNELS } from '../../shared/ipcContracts.js';

/**
 * Register gamepad IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerGamepadHandlers(mainApp) {
  // The renderer primes its shim with this on load, so a controller that was
  // already connected at launch works without waiting for the first input.
  ipcMain.handle(GAMEPAD_CHANNELS.GET_SNAPSHOT, () => {
    return mainApp.gamepadEngine?.getSnapshot() ?? [];
  });

  const engine = mainApp.gamepadEngine;
  if (!engine) return;

  engine.on('state', (pads) => mainApp.sendToRenderer(GAMEPAD_CHANNELS.STATE_CHANGE, pads));
  engine.on('connected', (device) => mainApp.sendToRenderer(GAMEPAD_CHANNELS.CONNECTED, device));
  engine.on('disconnected', (device) =>
    mainApp.sendToRenderer(GAMEPAD_CHANNELS.DISCONNECTED, device)
  );
}
