import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// webServer.js pulls in streamingHandlers, which imports electron.
vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '0.0.0') },
}));

const WebServer = (await import('./webServer.js')).default;

/**
 * The appState subscriptions are the regression surface here: stop() must
 * detach them (a listener firing after `io = null` crashed the main process
 * during shutdown), and a restart must not stack duplicates.
 */
describe('WebServer state change listeners', () => {
  let webServer;
  let appState;

  const STATE_EVENTS = [
    'mixerChanged',
    'effectsChanged',
    'queueChanged',
    'currentSongChanged',
    'playbackChanged',
  ];

  beforeEach(() => {
    appState = new EventEmitter();
    appState.state = { currentSong: null };
    webServer = new WebServer({ appState });
  });

  it('subscribes once per state event', () => {
    webServer.setupStateChangeListeners();
    for (const event of STATE_EVENTS) {
      expect(appState.listenerCount(event)).toBe(1);
    }
  });

  it('does not stack duplicate listeners across restarts', () => {
    webServer.setupStateChangeListeners();
    webServer.setupStateChangeListeners();
    webServer.setupStateChangeListeners();
    for (const event of STATE_EVENTS) {
      expect(appState.listenerCount(event)).toBe(1);
    }
  });

  it('detaches all listeners on stop()', () => {
    webServer.setupStateChangeListeners();
    webServer.stop();
    for (const event of STATE_EVENTS) {
      expect(appState.listenerCount(event)).toBe(0);
    }
  });

  it('survives state events emitted after stop()', () => {
    webServer.setupStateChangeListeners();
    webServer.stop(); // nulls io

    // The shutdown crash: renderer IPC still updates playback state while the
    // app quits. With the listeners detached this must be a no-op, not a
    // TypeError on `this.io.to`.
    expect(() => {
      appState.emit('playbackChanged', { isPlaying: false });
      appState.emit('mixerChanged', {});
      appState.emit('queueChanged', []);
    }).not.toThrow();
  });

  it('broadcasts to admin clients while running', () => {
    const emit = vi.fn();
    webServer.io = { to: vi.fn(() => ({ emit })), close: vi.fn() };
    webServer.setupStateChangeListeners();

    appState.emit('playbackChanged', { isPlaying: true });
    expect(webServer.io.to).toHaveBeenCalledWith('admin-clients');
    expect(emit).toHaveBeenCalledWith('playback-state-update', { isPlaying: true });
  });
});
