import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GamepadNav } from './gamepadNav.js';

/** Build a standard-shaped pad with the named buttons held down. */
function pad({ buttons = [], axes = [0, 0, 0, 0] } = {}) {
  const list = Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i) }));
  return { id: 'test pad', mapping: 'standard', buttons: list, axes };
}

const BTN = { A: 0, B: 1, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** Place buttons at known screen positions so geometric focus is testable. */
function layout(positions) {
  document.body.innerHTML = '';
  return positions.map(({ top, left, width = 100, height = 30, tag = 'button' }, i) => {
    const el = document.createElement(tag);
    el.textContent = `el${i}`;
    el.getBoundingClientRect = () => ({
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
    });
    // jsdom reports no layout, so make the visibility filter pass.
    Object.defineProperty(el, 'offsetParent', { get: () => document.body });
    document.body.appendChild(el);
    return el;
  });
}

describe('GamepadNav', () => {
  let nav;

  beforeEach(() => {
    document.body.innerHTML = '';
    nav = new GamepadNav();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  function setPad(p) {
    navigator.getGamepads = () => [p];
  }

  describe('text entry suppression', () => {
    it('ignores navigation while a text field has focus', () => {
      // Guards against reintroducing editor keyboard bugs (issue #96).
      const [button, input] = layout([
        { top: 0, left: 0 },
        { top: 100, left: 0, tag: 'input' },
      ]);
      input.type = 'text';
      input.focus();
      const moveFocus = vi.spyOn(nav, 'moveFocus');
      const activate = vi.spyOn(nav, 'activate');

      setPad(pad({ buttons: [BTN.DOWN, BTN.A] }));
      nav.poll();

      expect(moveFocus).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(button).toBeTruthy();
    });

    it('still lets B back out of a text field', () => {
      const [input] = layout([{ top: 0, left: 0, tag: 'input' }]);
      input.type = 'text';
      input.focus();
      expect(document.activeElement).toBe(input);

      setPad(pad({ buttons: [BTN.B] }));
      nav.poll();

      expect(document.activeElement).not.toBe(input);
    });

    it('still navigates when a checkbox or slider has focus', () => {
      // Checkboxes and range sliders are <input> but capture no typing. Treating
      // them as text entry stranded the focus ring on the first one it reached.
      const [checkbox, slider, button] = layout([
        { top: 0, left: 0, tag: 'input' },
        { top: 50, left: 0, tag: 'input' },
        { top: 100, left: 0 },
      ]);
      checkbox.type = 'checkbox';
      slider.type = 'range';

      checkbox.focus();
      expect(nav.isTextEntryFocused()).toBe(false);
      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(slider);

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(button);
    });

    it('treats real text inputs as typing', () => {
      const [input] = layout([{ top: 0, left: 0, tag: 'input' }]);
      input.type = 'text';
      input.focus();
      expect(nav.isTextEntryFocused()).toBe(true);
    });

    it('ignores stick movement while typing', () => {
      const [input] = layout([{ top: 0, left: 0, tag: 'input' }]);
      input.type = 'text';
      input.focus();
      const moveFocus = vi.spyOn(nav, 'moveFocus');

      setPad(pad({ axes: [0, 1, 0, 0] })); // stick fully down
      nav.poll();

      expect(moveFocus).not.toHaveBeenCalled();
    });
  });

  describe('directional focus', () => {
    it('moves to the element below on DOWN', () => {
      const [top, bottom] = layout([
        { top: 0, left: 0 },
        { top: 100, left: 0 },
      ]);
      top.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(bottom);
    });

    it('prefers the aligned element over a closer diagonal one', () => {
      // "Down" should land on the row directly below, not drift sideways.
      const [start, diagonal, aligned] = layout([
        { top: 0, left: 0 },
        { top: 40, left: 500 },
        { top: 100, left: 0 },
      ]);
      start.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(aligned);
      expect(document.activeElement).not.toBe(diagonal);
    });

    it('does not move when nothing lies in that direction', () => {
      const [only] = layout([{ top: 100, left: 0 }]);
      only.focus();

      nav.moveFocus('UP');
      expect(document.activeElement).toBe(only);
    });

    it('focuses the top-left control when nothing is focused yet', () => {
      const [lower, upper] = layout([
        { top: 200, left: 0 },
        { top: 10, left: 0 },
      ]);
      document.body.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(upper);
      expect(document.activeElement).not.toBe(lower);
    });

    it('skips disabled controls', () => {
      const [start, disabled, enabled] = layout([
        { top: 0, left: 0 },
        { top: 50, left: 0 },
        { top: 100, left: 0 },
      ]);
      disabled.setAttribute('disabled', '');
      start.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(enabled);
    });
  });

  describe('external-window controls', () => {
    it('never lands on controls that open an external browser', () => {
      // A browser window is not driven by the controller, so landing there from
      // the couch is a dead end with no way back.
      const [start, external, safe] = layout([
        { top: 0, left: 0 },
        { top: 50, left: 0 },
        { top: 100, left: 0 },
      ]);
      external.setAttribute('data-gamepad-skip', 'external');
      start.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(safe);
      expect(document.activeElement).not.toBe(external);
    });

    it('never lands on a text field, since a gamepad cannot type', () => {
      const [start, textField, safe] = layout([
        { top: 0, left: 0 },
        { top: 50, left: 0, tag: 'input' },
        { top: 100, left: 0 },
      ]);
      textField.type = 'text';
      start.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(safe);
      expect(document.activeElement).not.toBe(textField);
    });

    it('still lands on checkboxes and sliders', () => {
      const [start, checkbox] = layout([
        { top: 0, left: 0 },
        { top: 50, left: 0, tag: 'input' },
      ]);
      checkbox.type = 'checkbox';
      start.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(checkbox);
    });

    it('skips anything inside a skipped container', () => {
      document.body.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-gamepad-skip', 'external');
      const inner = document.createElement('button');
      inner.getBoundingClientRect = () => ({
        top: 50,
        left: 0,
        width: 100,
        height: 30,
        right: 100,
        bottom: 80,
      });
      Object.defineProperty(inner, 'offsetParent', { get: () => document.body });
      wrapper.appendChild(inner);
      document.body.appendChild(wrapper);

      expect(nav.visibleFocusables()).not.toContain(inner);
    });
  });

  describe('activation', () => {
    it('A clicks the focused control', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      const onClick = vi.fn();
      button.addEventListener('click', onClick);
      button.focus();

      setPad(pad({ buttons: [BTN.A] }));
      nav.poll();

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('Start clicks the tagged transport button', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      button.setAttribute('data-gamepad-action', 'play-pause');
      const onClick = vi.fn();
      button.addEventListener('click', onClick);

      setPad(pad({ buttons: [BTN.START] }));
      nav.poll();

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shoulder buttons step tabs', () => {
      const onTabStep = vi.fn();
      const tabNav = new GamepadNav({ onTabStep });

      setPad(pad({ buttons: [BTN.RB] }));
      tabNav.poll();
      expect(onTabStep).toHaveBeenCalledWith(1);

      setPad(pad({ buttons: [BTN.LB] }));
      tabNav.poll();
      expect(onTabStep).toHaveBeenCalledWith(-1);
    });
  });

  describe('edge detection and repeat', () => {
    it('fires once per press, not once per poll', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      const onClick = vi.fn();
      button.addEventListener('click', onClick);
      button.focus();

      setPad(pad({ buttons: [BTN.A] }));
      nav.poll();
      nav.poll();
      nav.poll();

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not auto-repeat activation while A is held', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      const onClick = vi.fn();
      button.addEventListener('click', onClick);
      button.focus();

      setPad(pad({ buttons: [BTN.A] }));
      nav.poll();
      performance.now.mockReturnValue(5000); // long past any repeat delay
      nav.poll();

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('auto-repeats direction when held past the delay', () => {
      layout([
        { top: 0, left: 0 },
        { top: 100, left: 0 },
        { top: 200, left: 0 },
      ]);
      const moveFocus = vi.spyOn(nav, 'moveFocus');

      setPad(pad({ buttons: [BTN.DOWN] }));
      nav.poll(); // initial press
      expect(moveFocus).toHaveBeenCalledTimes(1);

      performance.now.mockReturnValue(1000 + 500); // past REPEAT_DELAY_MS
      nav.poll();
      expect(moveFocus).toHaveBeenCalledTimes(2);
    });
  });

  describe('modals', () => {
    function openModal() {
      document.body.innerHTML = '';
      const behind = document.createElement('button');
      behind.textContent = 'behind';
      behind.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        width: 100,
        height: 30,
        right: 100,
        bottom: 30,
      });
      Object.defineProperty(behind, 'offsetParent', { get: () => document.body });
      document.body.appendChild(behind);

      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0';
      overlay.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        right: window.innerWidth,
        bottom: window.innerHeight,
      });
      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('data-gamepad-close', '');
      closeBtn.textContent = 'x';
      closeBtn.getBoundingClientRect = () => ({
        top: 10,
        left: 10,
        width: 30,
        height: 30,
        right: 40,
        bottom: 40,
      });
      Object.defineProperty(closeBtn, 'offsetParent', { get: () => overlay });
      overlay.appendChild(closeBtn);
      document.body.appendChild(overlay);
      return { behind, overlay, closeBtn };
    }

    it('traps navigation inside an open modal', () => {
      // Otherwise the ring wanders the library behind the scrim while the dialog
      // sits there uncloseable.
      const { behind, closeBtn } = openModal();
      const focusables = nav.visibleFocusables();
      expect(focusables).toContain(closeBtn);
      expect(focusables).not.toContain(behind);
    });

    it('pulls focus into a modal as soon as it opens', () => {
      const { closeBtn } = openModal();
      navigator.getGamepads = () => [pad()];
      nav.poll();
      expect(document.activeElement).toBe(closeBtn);
    });

    it('B closes the modal via its close button', () => {
      const { closeBtn } = openModal();
      const onClick = vi.fn();
      closeBtn.addEventListener('click', onClick);

      nav.back();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('B clicks the scrim when a modal has no tagged close button', () => {
      const { overlay, closeBtn } = openModal();
      closeBtn.removeAttribute('data-gamepad-close');
      const onClick = vi.fn();
      overlay.addEventListener('click', onClick);

      nav.back();
      expect(onClick).toHaveBeenCalled();
    });
  });

  describe('fullscreen', () => {
    it('B exits fullscreen instead of relying on an Escape listener', () => {
      // A gamepad can put the canvas fullscreen; with no Escape handler mounted
      // that would strand the user with no way back to the UI.
      const exitFullscreen = vi.fn();
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('canvas'),
        configurable: true,
      });
      document.exitFullscreen = exitFullscreen;

      nav.back();

      expect(exitFullscreen).toHaveBeenCalled();
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        configurable: true,
      });
    });

    it('reaches a focusable canvas wrapper', () => {
      // The canvas area is a role=button wrapper so the gamepad can toggle
      // fullscreen, the most useful action in a living room.
      const [start, canvasArea] = layout([
        { top: 0, left: 0 },
        { top: 100, left: 0, tag: 'div' },
      ]);
      canvasArea.setAttribute('role', 'button');
      canvasArea.setAttribute('tabindex', '0');
      const onClick = vi.fn();
      canvasArea.addEventListener('click', onClick);
      start.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(canvasArea);

      nav.activate();
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  it('is inert when no controller is connected', () => {
    navigator.getGamepads = () => [];
    const moveFocus = vi.spyOn(nav, 'moveFocus');
    expect(() => nav.poll()).not.toThrow();
    expect(moveFocus).not.toHaveBeenCalled();
  });
});
