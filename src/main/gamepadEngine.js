/**
 * GamepadEngine - SDL-backed controller input for living-room / SteamOS use.
 *
 * Why SDL instead of the renderer's Gamepad API: Chromium only reports
 * `mapping: "standard"` for a short list of well-known pads, so most third-party
 * controllers arrive with uninterpretable button indices. SDL ships the community
 * game-controller mapping database (the same one Steam feeds), so nearly every pad
 * resolves to the standard layout. SDL also reads evdev directly, so input keeps
 * working regardless of window focus.
 *
 * SPIKE STATUS: enumeration + open + event streaming only. The IPC bridge, the
 * `navigator.getGamepads()` shim, and the navigation layer are phase 2/3
 * (see internal-loukai/PLAN-gamepad-sdl.md).
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);

/**
 * node-sdl exposes NAMED buttons/axes; the web Gamepad API uses positional
 * indices. This table is the bridge between the two. Order matters: it is the
 * standard-mapping button order, so the array index IS the standard index.
 */
export const STANDARD_BUTTON_ORDER = [
  'a', // 0
  'b', // 1
  'x', // 2
  'y', // 3
  'leftShoulder', // 4
  'rightShoulder', // 5
  null, // 6  - left trigger, synthesized from the axis
  null, // 7  - right trigger, synthesized from the axis
  'back', // 8
  'start', // 9
  'leftStick', // 10
  'rightStick', // 11
  'dpadUp', // 12
  'dpadDown', // 13
  'dpadLeft', // 14
  'dpadRight', // 15
  'guide', // 16
];

/**
 * Trigger axes are not trustworthy across pads. The X360 pad tested during the
 * spike reports BOTH triggers pinned at ~0.5 forever (a bipolar axis that never
 * moves), so a naive `value > 0.5` reads as "half pressed" at rest. Until a pad
 * is observed producing a real 0..1 sweep, treat a trigger as pressed only when
 * it is clearly past the top of that dead band, and never report a rest value as
 * a partial press. Nothing in the v1 navigation layer binds triggers.
 */
const TRIGGER_PRESS_THRESHOLD = 0.85;
const TRIGGER_REST_EPSILON = 0.02;

export class GamepadEngine extends EventEmitter {
  constructor() {
    super();
    this.sdl = null;
    this.available = false;
    this.controllers = new Map(); // sdl device id -> { device, handle }
  }

  /**
   * Load SDL and open every connected controller. Never throws: a machine
   * without SDL support (or without permission to read input devices) must
   * degrade to "no gamepads", not a failed app launch.
   */
  initialize() {
    try {
      this.sdl = require('@kmamal/sdl');
    } catch (error) {
      console.warn('🎮 SDL unavailable, gamepad support disabled:', error.message);
      return false;
    }

    this.available = true;
    console.log(
      `🎮 SDL ${this.sdl.info.version.runtime.major}.${this.sdl.info.version.runtime.minor} ready`
    );

    for (const device of this.sdl.controller.devices) {
      this.openDevice(device);
    }

    this.sdl.controller.on('deviceAdd', (event) => this.openDevice(event.device));
    this.sdl.controller.on('deviceRemove', (event) => this.closeDevice(event.device));

    return true;
  }

  openDevice(device) {
    if (!device || this.controllers.has(device.id)) return;
    try {
      const handle = this.sdl.controller.openDevice(device);
      this.controllers.set(device.id, { device, handle });
      console.log(`🎮 Controller connected: ${device.name} (${device.type})`);
      this.emit('connected', this.describe(device));
    } catch (error) {
      console.warn(`🎮 Could not open ${device?.name}:`, error.message);
    }
  }

  closeDevice(device) {
    const entry = this.controllers.get(device?.id);
    if (!entry) return;
    try {
      entry.handle.close();
    } catch {
      // Already gone - unplugging races the close.
    }
    this.controllers.delete(device.id);
    console.log(`🎮 Controller disconnected: ${device.name}`);
    this.emit('disconnected', this.describe(device));
  }

  describe(device) {
    return { id: device.id, name: device.name, type: device.type, guid: device.guid };
  }

  /**
   * Snapshot every open controller in web-Gamepad-API shape, so the renderer
   * shim can hand these straight to `navigator.getGamepads()` consumers.
   */
  getSnapshot() {
    const pads = [];
    let index = 0;
    for (const { device, handle } of this.controllers.values()) {
      const axes = handle.axes;
      const buttons = STANDARD_BUTTON_ORDER.map((name, i) => {
        if (i === 6) return this.triggerButton(axes.leftTrigger);
        if (i === 7) return this.triggerButton(axes.rightTrigger);
        const pressed = Boolean(handle.buttons[name]);
        return { pressed, touched: pressed, value: pressed ? 1 : 0 };
      });

      pads.push({
        id: `${device.name} (SDL ${device.type})`,
        index: index++,
        connected: true,
        mapping: 'standard',
        buttons,
        axes: [
          axes.leftStickX ?? 0,
          axes.leftStickY ?? 0,
          axes.rightStickX ?? 0,
          axes.rightStickY ?? 0,
        ],
      });
    }
    return pads;
  }

  triggerButton(value) {
    const v = value ?? 0;
    // Pads that park a trigger at a fixed rest value (commonly ~0.5) must read as
    // fully released, not half-pressed - see TRIGGER_PRESS_THRESHOLD.
    const atRest = Math.abs(v) < TRIGGER_REST_EPSILON || Math.abs(v - 0.5) < TRIGGER_REST_EPSILON;
    if (atRest) return { pressed: false, touched: false, value: 0 };
    return { pressed: v > TRIGGER_PRESS_THRESHOLD, touched: true, value: v };
  }

  shutdown() {
    for (const { device } of [...this.controllers.values()]) {
      this.closeDevice(device);
    }
    this.controllers.clear();
  }
}

export default GamepadEngine;
