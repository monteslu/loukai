/**
 * Vitest Setup File
 * Runs before all tests to configure the testing environment
 */

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});

// Mock Electron IPC for renderer tests
global.window = global.window || {};
global.window.kaiAPI = {
  app: {
    getState: vi.fn(),
  },
  player: {
    onPlaybackState: vi.fn(),
  },
  queue: {
    addSong: vi.fn(),
    removeSong: vi.fn(),
    clear: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    set: vi.fn(),
  },
  events: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
};
