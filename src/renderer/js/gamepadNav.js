/**
 * Gamepad navigation: drive the app from the couch.
 *
 * Reads the SDL-backed `navigator.getGamepads()` (see the shim in preload.js) and
 * turns controller input into focus movement and activation. The whole UI is
 * already built from real <button> elements, so activation is just a click on
 * whatever has focus, and the browser's own semantics do the rest.
 *
 * Why focus is moved directly instead of synthesizing Tab keypresses: browsers
 * deliberately ignore synthetic Tab for focus traversal, so a fake keydown would
 * do nothing. Directional movement is geometric (nearest focusable in the pressed
 * direction), which matches what a person expects from a d-pad far better than
 * DOM order does.
 *
 * Bindings (v1 is deliberately small):
 *   D-pad / left stick  move focus
 *   A                   activate the focused control
 *   B                   Escape (close dialogs, leave fullscreen)
 *   Start               play/pause
 *   LB / RB             previous / next tab
 */

const REPEAT_DELAY_MS = 400;
const REPEAT_RATE_MS = 120;
const STICK_THRESHOLD = 0.6;
const POLL_INTERVAL_MS = 50;

// Standard Gamepad API indices.
const BTN = {
  A: 0,
  B: 1,
  LB: 4,
  RB: 5,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

/** Input types that capture typing; everything else is a control the d-pad drives. */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export class GamepadNav {
  constructor({ onTabStep, onTogglePlayback } = {}) {
    this.onTabStep = onTabStep;
    this.onTogglePlayback = onTogglePlayback;
    this.timer = null;
    this.prev = new Map(); // button index -> { pressed, nextRepeatAt }
    this.enabled = true;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.prev.clear();
  }

  /**
   * Text entry must win over navigation, or the gamepad would fight the editor
   * (see issue #96, where keyboard handling in the editor was already fragile).
   * B still passes through so a controller can always back out of a text field.
   */
  isTextEntryFocused() {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    // Only inputs that actually swallow typing count. Checkboxes, sliders and
    // buttons are <input> too, and suppressing navigation on those would strand
    // the focus ring on the first checkbox it landed on.
    return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
  }

  poll() {
    if (!this.enabled) return;
    const pad = (navigator.getGamepads?.() || []).find(Boolean);
    if (!pad) {
      this.prev.clear();
      return;
    }

    const now = performance.now();
    const textEntry = this.isTextEntryFocused();

    for (const [name, index] of Object.entries(BTN)) {
      const pressed = Boolean(pad.buttons[index]?.pressed);
      const repeats = name === 'UP' || name === 'DOWN' || name === 'LEFT' || name === 'RIGHT';
      if (this.edge(index, pressed, now, repeats)) {
        // While typing, only B (back out) is honored.
        if (textEntry && name !== 'B') continue;
        this.dispatch(name);
      }
    }

    // Left stick doubles as the d-pad so either works.
    this.stickEdge(pad, now, textEntry);
  }

  /**
   * True on a fresh press, and again on each auto-repeat tick while held.
   * Repeat only applies to directions: nobody wants a held A button to fire
   * activation dozens of times.
   */
  edge(index, pressed, now, repeats) {
    const state = this.prev.get(index) || { pressed: false, nextRepeatAt: 0 };
    let fired = false;

    if (pressed && !state.pressed) {
      fired = true;
      state.nextRepeatAt = now + REPEAT_DELAY_MS;
    } else if (pressed && repeats && now >= state.nextRepeatAt) {
      fired = true;
      state.nextRepeatAt = now + REPEAT_RATE_MS;
    }

    state.pressed = pressed;
    this.prev.set(index, state);
    return fired;
  }

  stickEdge(pad, now, textEntry) {
    const [x = 0, y = 0] = pad.axes;
    const dir =
      y < -STICK_THRESHOLD
        ? 'UP'
        : y > STICK_THRESHOLD
          ? 'DOWN'
          : x < -STICK_THRESHOLD
            ? 'LEFT'
            : x > STICK_THRESHOLD
              ? 'RIGHT'
              : null;

    // Key the stick off a synthetic index so it repeats like the d-pad without
    // colliding with real button state.
    const STICK_KEY = -1;
    const state = this.prev.get(STICK_KEY) || { dir: null, nextRepeatAt: 0 };
    let fired = false;

    if (dir && dir !== state.dir) {
      fired = true;
      state.nextRepeatAt = now + REPEAT_DELAY_MS;
    } else if (dir && now >= state.nextRepeatAt) {
      fired = true;
      state.nextRepeatAt = now + REPEAT_RATE_MS;
    }

    state.dir = dir;
    this.prev.set(STICK_KEY, state);

    if (fired && dir && !textEntry) this.dispatch(dir);
  }

  dispatch(name) {
    switch (name) {
      case 'UP':
      case 'DOWN':
      case 'LEFT':
      case 'RIGHT':
        this.moveFocus(name);
        break;
      case 'A':
        this.activate();
        break;
      case 'B':
        this.back();
        break;
      case 'START':
        this.togglePlayback();
        break;
      case 'LB':
        this.onTabStep?.(-1);
        break;
      case 'RB':
        this.onTabStep?.(1);
        break;
      default:
        break;
    }
  }

  /** Everything focusable and actually on screen right now. */
  visibleFocusables() {
    return [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  /**
   * Geometric focus movement: pick the nearest candidate in the pressed
   * direction, preferring things that line up with the current element over
   * things that are merely close.
   */
  moveFocus(direction) {
    const candidates = this.visibleFocusables();
    if (candidates.length === 0) return;

    const active = document.activeElement;
    const current = active && candidates.includes(active) ? active.getBoundingClientRect() : null;

    // Nothing focused yet: start at the top-left-most control.
    if (!current) {
      const first = candidates.slice().sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.top - rb.top || ra.left - rb.left;
      })[0];
      this.focus(first);
      return;
    }

    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;

    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === active) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;

      const inDirection =
        (direction === 'UP' && dy < -1) ||
        (direction === 'DOWN' && dy > 1) ||
        (direction === 'LEFT' && dx < -1) ||
        (direction === 'RIGHT' && dx > 1);
      if (!inDirection) continue;

      // Distance along the travel axis, plus a heavy penalty for drifting off
      // axis, so "down" lands on the row below rather than something diagonal.
      const along = direction === 'UP' || direction === 'DOWN' ? Math.abs(dy) : Math.abs(dx);
      const off = direction === 'UP' || direction === 'DOWN' ? Math.abs(dx) : Math.abs(dy);
      const score = along + off * 3;

      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) this.focus(best);
  }

  focus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    // Not every focusable implements scrollIntoView (and jsdom does not at all).
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    // Marks the focus ring as gamepad-driven so it can be styled boldly for a
    // 10-foot view without affecting mouse users.
    el.classList.add('gamepad-focus');
    if (this.lastFocused && this.lastFocused !== el) {
      this.lastFocused.classList.remove('gamepad-focus');
    }
    this.lastFocused = el;
  }

  activate() {
    const el = document.activeElement;
    if (!el || el === document.body) return;
    el.click();
  }

  /**
   * Click the real transport button rather than reaching into player internals,
   * so play/pause stays correct however the app wires playback.
   */
  togglePlayback() {
    if (this.onTogglePlayback) {
      this.onTogglePlayback();
      return;
    }
    document.querySelector('[data-gamepad-action="play-pause"]')?.click();
  }

  back() {
    const el = document.activeElement;
    // Leaving a text field is the most common "back" while typing.
    if (this.isTextEntryFocused() && el?.blur) {
      el.blur();
      return;
    }
    // Reuse whatever Escape already does (close dialogs, exit fullscreen).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
}

export default GamepadNav;
