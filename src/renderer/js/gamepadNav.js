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
/** Sliders move several steps per press; one 0.5 dB step per tap is unusable. */
const SLIDER_STEP_MULTIPLIER = 4;

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

/**
 * Controls the gamepad must never land on. Anything that hands control to an
 * external browser is a dead end from the couch: the new window is not driven by
 * the controller and there is no way back. Mouse and keyboard users still get
 * them; they are only removed from gamepad traversal.
 */
const GAMEPAD_SKIP = '[data-gamepad-skip]';

/**
 * Modal scrims. The app's dialogs are full-screen `fixed inset-0` overlays, not
 * <dialog> elements, so they are matched by that shape and then size-checked.
 */
const OVERLAY = '.fixed.inset-0';

/** Inside the window, so off-canvas panels are not navigable. */
function isOnScreen(r) {
  return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

/**
 * True when a scrolling/clipping ancestor has collapsed to nothing around this
 * element. A collapsed drawer keeps its children in the DOM at full size (the
 * sidebar animates to `w-0` rather than unmounting), so the child's own box
 * still looks perfectly visible: only the ancestor reveals that it is hidden.
 */
function isClippedByAncestor(el, r) {
  let n = el.parentElement;
  while (n && n !== document.body) {
    const cs = getComputedStyle(n);
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const nr = n.getBoundingClientRect();
      if (nr.width <= 1 || nr.height <= 1) return true;
      // Fully outside the clipping box means it is scrolled or slid out of view.
      if (r.right <= nr.left || r.left >= nr.right || r.bottom <= nr.top || r.top >= nr.bottom) {
        return true;
      }
    }
    n = n.parentElement;
  }
  return false;
}

/** Range sliders are adjusted by the d-pad rather than activated by A. */
function isSlider(el) {
  return el?.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'range';
}

/**
 * True for controls that capture typing. Checkboxes, sliders and buttons are
 * <input> too, so the TYPE matters, not the tag: treating those as text would
 * strand the focus ring on the first checkbox it reached.
 */
function isTextInput(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
}

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
    return isTextInput(document.activeElement);
  }

  poll() {
    if (!this.enabled) return;
    const pad = (navigator.getGamepads?.() || []).find(Boolean);
    if (!pad) {
      this.prev.clear();
      return;
    }

    // A modal that just opened leaves focus behind the scrim. Pull the ring into
    // it right away rather than making the user press a direction first to
    // discover the dialog is even reachable.
    this.syncOverlayFocus();

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
      case 'LEFT':
      case 'RIGHT':
        // On a slider, left/right is the volume/gain gesture people expect. Up
        // and down still move focus away, so a slider is never a trap.
        if (isSlider(document.activeElement)) {
          this.adjustSlider(document.activeElement, name === 'RIGHT' ? 1 : -1);
          break;
        }
        this.moveFocus(name);
        break;
      case 'UP':
      case 'DOWN':
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

  /**
   * Move the ring into a newly opened modal, and restore sane focus when it
   * closes. Without this the ring sits on whatever was focused behind the scrim.
   */
  syncOverlayFocus() {
    const overlay = this.topOverlay();
    if (overlay === this.lastOverlay) return;
    this.lastOverlay = overlay;
    if (!overlay) return;

    const inside = this.visibleFocusables();
    // Prefer the explicit close affordance so B and A agree on the obvious action.
    const close = inside.find((el) => el.hasAttribute('data-gamepad-close'));
    this.focus(close || inside[0]);
  }

  /**
   * The topmost open modal overlay, if any. Modals here are full-screen
   * `fixed inset-0` scrims (the song info dialog, the shared confirm dialog)
   * rather than <dialog> elements, so they are detected by shape.
   */
  topOverlay() {
    const overlays = [...document.querySelectorAll(OVERLAY)].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      // A scrim covers essentially the whole window; a toast or dropdown does not.
      return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
    });
    if (overlays.length === 0) return null;
    // Highest stacking order wins when several are open.
    return overlays.reduce((top, el) =>
      Number(getComputedStyle(el).zIndex || 0) >= Number(getComputedStyle(top).zIndex || 0)
        ? el
        : top
    );
  }

  /**
   * Everything focusable and actually on screen right now. When a modal is open,
   * navigation is trapped inside it: otherwise the ring wanders the library
   * behind the scrim while the dialog sits there uncloseable.
   */
  visibleFocusables() {
    const overlay = this.topOverlay();
    const root = overlay || document;
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.closest(GAMEPAD_SKIP)) return false;
      // A gamepad cannot type, so landing on a text field is a dead end: the ring
      // parks there and the only escape is B. Skip them until there is a way to
      // enter text with a controller (platform OSK or our own).
      if (isTextInput(el)) return false;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return isOnScreen(r) && !isClippedByAncestor(el, r);
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
    // A click does not change a range input's value, so A would be a no-op on a
    // slider. Nudge it up instead, which is at least a visible response.
    if (isSlider(el)) {
      this.adjustSlider(el, 1);
      return;
    }
    el.click();
  }

  /**
   * Move a range input by one step and tell the app about it. React controls
   * these inputs, so setting `.value` alone updates the DOM but never the state
   * behind it: the change must be dispatched through the native value setter for
   * React's synthetic `onChange` to fire.
   */
  adjustSlider(el, direction) {
    const step = Number(el.step) || 1;
    const min = el.min === '' ? 0 : Number(el.min);
    const max = el.max === '' ? 100 : Number(el.max);
    const next = Math.min(
      max,
      Math.max(min, Number(el.value) + step * direction * SLIDER_STEP_MULTIPLIER)
    );
    if (next === Number(el.value)) return;

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, String(next));
    else el.value = String(next);

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
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
    // Exit fullscreen directly rather than relying on a keydown listener. A
    // gamepad can put the canvas fullscreen, and if nothing handles Escape that
    // would be a trap with no way back to the UI.
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    // Close an open modal. These dialogs close by clicking their scrim or their
    // X button and do not listen for Escape, so dispatching a key here would do
    // nothing and leave the dialog stuck open.
    const overlay = this.topOverlay();
    if (overlay) {
      const closer = overlay.querySelector('[data-gamepad-close]');
      if (closer) closer.click();
      else overlay.click(); // the scrim's own click handler dismisses it
      return;
    }
    // Otherwise let whatever listens for Escape handle it (dialogs, overlays).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
}

export default GamepadNav;
