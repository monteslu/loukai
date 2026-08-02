import { describe, it, expect, beforeEach } from 'vitest';
import { GamepadEngine, STANDARD_BUTTON_ORDER } from './gamepadEngine.js';

/** Minimal stand-in for an open node-sdl controller handle. */
function fakeHandle(overrides = {}) {
  return {
    buttons: { a: false, b: false, dpadUp: false, dpadLeft: false, ...overrides.buttons },
    axes: {
      leftStickX: 0,
      leftStickY: 0,
      rightStickX: 0,
      rightStickY: 0,
      leftTrigger: 0.5, // the observed rest value on a real X360 pad
      rightTrigger: 0.5,
      ...overrides.axes,
    },
    close() {},
  };
}

function engineWithPad(handleOverrides) {
  const engine = new GamepadEngine();
  engine.available = true;
  engine.controllers.set(1, {
    device: { id: 1, name: 'Test Pad', type: 'xbox360', guid: 'abc' },
    handle: fakeHandle(handleOverrides),
  });
  return engine;
}

describe('GamepadEngine', () => {
  describe('getSnapshot', () => {
    let engine;
    beforeEach(() => {
      engine = engineWithPad();
    });

    it('reports the standard mapping so getGamepads() consumers work', () => {
      const [pad] = engine.getSnapshot();
      expect(pad.mapping).toBe('standard');
      expect(pad.connected).toBe(true);
      expect(pad.buttons).toHaveLength(STANDARD_BUTTON_ORDER.length);
      expect(pad.axes).toHaveLength(4);
    });

    it('maps SDL named buttons onto standard indices', () => {
      const pressed = engineWithPad({ buttons: { a: true, dpadUp: true } });
      const [pad] = pressed.getSnapshot();
      expect(pad.buttons[0].pressed).toBe(true); // a
      expect(pad.buttons[12].pressed).toBe(true); // dpadUp
      expect(pad.buttons[1].pressed).toBe(false); // b
    });

    it('treats a trigger parked at its rest value as released', () => {
      // Real X360 pads pin both triggers at ~0.5 forever; a naive threshold
      // would report a permanent half-press.
      const [pad] = engine.getSnapshot();
      expect(pad.buttons[6].pressed).toBe(false);
      expect(pad.buttons[6].value).toBe(0);
      expect(pad.buttons[7].pressed).toBe(false);
    });

    it('reports a fully pulled trigger as pressed', () => {
      const pulled = engineWithPad({ axes: { leftTrigger: 1 } });
      const [pad] = pulled.getSnapshot();
      expect(pad.buttons[6].pressed).toBe(true);
    });
  });

  describe('hasChanged', () => {
    it('ignores analog jitter below the epsilon', () => {
      const engine = new GamepadEngine();
      const a = [{ id: 'p', buttons: [{ pressed: false }], axes: [0, 0, 0, 0] }];
      const b = [{ id: 'p', buttons: [{ pressed: false }], axes: [0.005, 0, 0, 0] }];
      expect(engine.hasChanged(b, a)).toBe(false);
    });

    it('detects real stick movement', () => {
      const engine = new GamepadEngine();
      const a = [{ id: 'p', buttons: [{ pressed: false }], axes: [0, 0, 0, 0] }];
      const b = [{ id: 'p', buttons: [{ pressed: false }], axes: [0.9, 0, 0, 0] }];
      expect(engine.hasChanged(b, a)).toBe(true);
    });

    it('detects button edges', () => {
      const engine = new GamepadEngine();
      const a = [{ id: 'p', buttons: [{ pressed: false }], axes: [0, 0, 0, 0] }];
      const b = [{ id: 'p', buttons: [{ pressed: true }], axes: [0, 0, 0, 0] }];
      expect(engine.hasChanged(b, a)).toBe(true);
    });

    it('detects connect and disconnect', () => {
      const engine = new GamepadEngine();
      const pad = { id: 'p', buttons: [{ pressed: false }], axes: [0, 0, 0, 0] };
      expect(engine.hasChanged([pad], [])).toBe(true);
      expect(engine.hasChanged([], [pad])).toBe(true);
    });
  });

  describe('poll', () => {
    it('emits only when state actually changes', () => {
      const engine = engineWithPad();
      const seen = [];
      engine.on('state', (pads) => seen.push(pads));

      engine.poll(); // first poll establishes the baseline and emits
      engine.poll(); // identical state must stay silent
      engine.poll();
      expect(seen).toHaveLength(1);

      engine.controllers.get(1).handle.buttons.a = true;
      engine.poll();
      expect(seen).toHaveLength(2);
      expect(seen[1][0].buttons[0].pressed).toBe(true);
    });

    it('emits an empty state when the last controller goes away', () => {
      const engine = engineWithPad();
      const seen = [];
      engine.poll();
      engine.on('state', (pads) => seen.push(pads));

      engine.controllers.clear();
      engine.poll();
      expect(seen).toEqual([[]]);

      engine.poll(); // already empty, so no repeat
      expect(seen).toHaveLength(1);
    });
  });

  describe('availability', () => {
    it('reports no pads and never throws when SDL is unavailable', () => {
      // A machine without SDL (or without permission to read input devices) must
      // degrade to "no gamepads" rather than breaking app launch.
      const engine = new GamepadEngine();
      expect(engine.available).toBe(false);
      expect(engine.getSnapshot()).toEqual([]);
      expect(() => engine.start()).not.toThrow(); // start() is a no-op unless available
      expect(engine.pollTimer).toBe(null);
      expect(() => engine.shutdown()).not.toThrow();
    });
  });
});
