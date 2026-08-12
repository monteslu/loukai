import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, saveSettings, updateServerSettings } from './serverSettingsService.js';
import { SERVER_DEFAULTS } from '../defaults.js';

/**
 * loadSettings/saveSettings enumerate every key by hand, so a newly added
 * setting silently fails to persist if it isn't listed in both. These cover the
 * round trip rather than the enumeration, so they stay meaningful as keys move.
 */
function makeWebServer(stored = {}) {
  const store = { ...stored };
  return {
    defaultSettings: { ...SERVER_DEFAULTS },
    settings: { ...SERVER_DEFAULTS },
    io: null,
    mainApp: {
      settings: {
        get: vi.fn((key, fallback) => (key in store ? store[key] : fallback)),
        set: vi.fn((key, value) => {
          store[key] = value;
        }),
      },
    },
    _store: store,
  };
}

describe('serverSettingsService persistence', () => {
  let webServer;
  beforeEach(() => {
    webServer = makeWebServer();
  });

  it('defaults the public URL override to off and empty', () => {
    const loaded = loadSettings(webServer);
    expect(loaded.publicUrlEnabled).toBe(false);
    expect(loaded.publicUrl).toBe('');
  });

  it('saves and reloads the public URL override', () => {
    webServer.settings.publicUrlEnabled = true;
    webServer.settings.publicUrl = 'https://karaoke.example.com';
    expect(saveSettings(webServer)).toBe(true);

    // A fresh instance reading the same store must see the values.
    const restarted = makeWebServer(webServer._store);
    const loaded = loadSettings(restarted);
    expect(loaded.publicUrlEnabled).toBe(true);
    expect(loaded.publicUrl).toBe('https://karaoke.example.com');
  });

  it('persists the override through updateServerSettings', () => {
    const result = updateServerSettings(webServer, {
      publicUrlEnabled: true,
      publicUrl: 'karaoke.example.com',
    });
    expect(result.success).toBe(true);
    expect(webServer._store['server.publicUrl']).toBe('karaoke.example.com');

    const loaded = loadSettings(makeWebServer(webServer._store));
    expect(loaded.publicUrl).toBe('karaoke.example.com');
  });

  it('leaves unrelated settings alone on a partial update', () => {
    updateServerSettings(webServer, { publicUrlEnabled: true });
    expect(webServer.settings.serverName).toBe(SERVER_DEFAULTS.serverName);
    expect(webServer.settings.showQrCode).toBe(SERVER_DEFAULTS.showQrCode);
  });

  it('falls back to defaults when no settings manager exists', () => {
    const loaded = loadSettings({ defaultSettings: { ...SERVER_DEFAULTS } });
    expect(loaded).toEqual(SERVER_DEFAULTS);
  });
});
