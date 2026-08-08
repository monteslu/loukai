import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GAMEPAD_CHANNELS } from '../shared/ipcContracts.js';

// The shim lives inline in preload.js (Electron loads the preload raw and its
// module resolution won't reach a sibling file). Extract and evaluate the real
// shipped source so these tests can't drift from what actually runs.
const preloadSource = readFileSync(path.join(process.cwd(), 'src/main/preload.js'), 'utf8');
const shimStart = preloadSource.indexOf('function installGamepadShim');
const shimEnd = preloadSource.indexOf('window.kaiGamepad =');
if (shimStart === -1 || shimEnd === -1) {
  throw new Error('installGamepadShim not found in preload.js - did the shim move?');
}
const installGamepadShim = new Function(
  `${preloadSource.slice(shimStart, shimEnd)}\nreturn installGamepadShim;`
)();

function makeHarness() {
  const handlers = new Map();
  const nativePads = [{ id: 'chromium pad' }];
  const target = { getGamepads: () => nativePads };

  const state = installGamepadShim({
    on: (channel, handler) => handlers.set(channel, handler),
    invoke: vi.fn().mockResolvedValue([]),
    channels: GAMEPAD_CHANNELS,
    target,
  });

  return {
    target,
    state,
    nativePads,
    emit: (channel, payload) => handlers.get(channel)?.({}, payload),
  };
}

const sdlPad = () => ({
  id: 'SDL pad',
  index: 0,
  connected: true,
  mapping: 'standard',
  buttons: [{ pressed: true }],
  axes: [0, 0, 0, 0],
});

describe('gamepadShim', () => {
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => 123 });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      'Event',
      class {
        constructor(type) {
          this.type = type;
        }
      }
    );
  });

  it('falls back to Chromium when SDL reports no pads', () => {
    // The shim can only ADD controller support, never remove it: a box with no
    // SDL, no controller, or no evdev permission must behave exactly as before.
    const h = makeHarness();
    expect(h.target.getGamepads()).toBe(h.nativePads);
  });

  it('serves SDL pads once main sends state', () => {
    const h = makeHarness();
    h.emit(GAMEPAD_CHANNELS.STATE_CHANGE, [sdlPad()]);

    const pads = h.target.getGamepads();
    expect(pads).toHaveLength(1);
    expect(pads[0].id).toBe('SDL pad');
    expect(pads[0].mapping).toBe('standard');
    expect(pads[0].timestamp).toBe(123);
  });

  it('reverts to the native implementation on disconnect', () => {
    const h = makeHarness();
    h.emit(GAMEPAD_CHANNELS.STATE_CHANGE, [sdlPad()]);
    expect(h.target.getGamepads()[0].id).toBe('SDL pad');

    h.emit(GAMEPAD_CHANNELS.DISCONNECTED, { id: 1 });
    expect(h.target.getGamepads()).toBe(h.nativePads);
  });

  it('dispatches standard connect/disconnect events', () => {
    const h = makeHarness();
    h.emit(GAMEPAD_CHANNELS.CONNECTED, { id: 1, name: 'Test Pad' });
    expect(window.dispatchEvent).toHaveBeenCalled();
    expect(window.dispatchEvent.mock.calls[0][0].type).toBe('gamepadconnected');

    h.emit(GAMEPAD_CHANNELS.DISCONNECTED, { id: 1, name: 'Test Pad' });
    expect(window.dispatchEvent.mock.calls[1][0].type).toBe('gamepaddisconnected');
  });

  it('survives an environment with no navigator', () => {
    // The test env (jsdom) supplies a global navigator, so pass an explicit null
    // target to simulate a context that has none.
    expect(
      installGamepadShim({
        on: () => {},
        invoke: () => Promise.resolve([]),
        channels: GAMEPAD_CHANNELS,
        target: null,
      })
    ).toBe(null);
  });

  it('keeps the preload channel literals in sync with the contract', () => {
    // preload.js is loaded raw (CommonJS) and cannot import the ESM contracts
    // module, so it duplicates the channel names. Catch drift here.
    const preload = readFileSync(path.join(process.cwd(), 'src/main/preload.js'), 'utf8');
    for (const channel of Object.values(GAMEPAD_CHANNELS)) {
      expect(preload).toContain(`'${channel}'`);
    }
  });
});
