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

  describe('hidden drawers', () => {
    /**
     * The sidebar collapses by sliding off-screen (margin-left: -320px), keeping
     * its full width and its children's boxes intact. Per-element size checks
     * therefore see it as perfectly visible, and the ring walked into a drawer
     * the user could not see, which reads as the app losing focus.
     */
    function offScreenDrawer() {
      document.body.innerHTML = '';
      const drawer = document.createElement('div');
      drawer.slideTo = (left) => {
        drawer.getBoundingClientRect = () => ({
          top: 0,
          left,
          width: 320,
          height: 600,
          right: left + 320,
          bottom: 600,
        });
      };
      drawer.slideTo(-320);
      Object.defineProperty(drawer, 'offsetParent', { get: () => document.body });
      const inner = document.createElement('button');
      inner.textContent = 'hidden control';
      inner.getBoundingClientRect = () => ({
        top: 10,
        left: -300,
        width: 279,
        height: 24,
        right: -21,
        bottom: 34,
      });
      Object.defineProperty(inner, 'offsetParent', { get: () => drawer });
      drawer.appendChild(inner);
      document.body.appendChild(drawer);

      const onScreen = document.createElement('button');
      onScreen.textContent = 'visible';
      onScreen.getBoundingClientRect = () => ({
        top: 10,
        left: 100,
        width: 100,
        height: 30,
        right: 200,
        bottom: 40,
      });
      Object.defineProperty(onScreen, 'offsetParent', { get: () => document.body });
      document.body.appendChild(onScreen);
      return { inner, onScreen, drawer };
    }

    it('ignores controls in a drawer slid off-screen', () => {
      const { inner, onScreen } = offScreenDrawer();
      const focusables = nav.visibleFocusables();
      expect(focusables).not.toContain(inner);
      expect(focusables).toContain(onScreen);
    });

    it('still navigates the drawer once it slides back on-screen', () => {
      const { inner, drawer } = offScreenDrawer();
      // The real sidebar slides the whole panel back, children with it.
      drawer.slideTo(0);
      inner.getBoundingClientRect = () => ({
        top: 10,
        left: 20,
        width: 279,
        height: 24,
        right: 299,
        bottom: 34,
      });
      expect(nav.visibleFocusables()).toContain(inner);
    });

    it('ignores controls clipped by a zero-width ancestor', () => {
      document.body.innerHTML = '';
      const collapsed = document.createElement('div');
      collapsed.style.overflow = 'hidden';
      collapsed.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        width: 0,
        height: 600,
        right: 0,
        bottom: 600,
      });
      Object.defineProperty(collapsed, 'offsetParent', { get: () => document.body });
      const inner = document.createElement('button');
      inner.getBoundingClientRect = () => ({
        top: 10,
        left: 0,
        width: 279,
        height: 24,
        right: 279,
        bottom: 34,
      });
      Object.defineProperty(inner, 'offsetParent', { get: () => collapsed });
      collapsed.appendChild(inner);
      document.body.appendChild(collapsed);

      expect(nav.visibleFocusables()).not.toContain(inner);
    });
  });

  describe('focus ring target', () => {
    it('rings the wrapping label for a checkbox, not the 16px box', () => {
      document.body.innerHTML = '';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        width: 16,
        height: 16,
        right: 16,
        bottom: 16,
      });
      Object.defineProperty(box, 'offsetParent', { get: () => label });
      const text = document.createElement('span');
      text.textContent = 'Enable Waveforms';
      label.append(box, text);
      document.body.appendChild(label);

      nav.focus(box);

      expect(label.classList.contains('gamepad-focus')).toBe(true);
      expect(box.classList.contains('gamepad-focus')).toBe(false);
      expect(document.activeElement).toBe(box); // real focus stays on the input
    });

    it('rings a plain button directly', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      nav.focus(button);
      expect(button.classList.contains('gamepad-focus')).toBe(true);
    });

    it('clears the ring when navigation stops', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      nav.start();
      nav.focus(button);
      expect(button.classList.contains('gamepad-focus')).toBe(true);

      nav.stop();
      expect(button.classList.contains('gamepad-focus')).toBe(false);
    });
  });

  describe('scrolling', () => {
    it('can reach controls below the fold', () => {
      // The viewport check must not exclude off-screen-but-scrollable content,
      // or the ring gets stuck at the bottom edge of the window.
      document.body.innerHTML = '';
      const below = document.createElement('button');
      below.getBoundingClientRect = () => ({
        top: window.innerHeight + 200,
        left: 20,
        width: 100,
        height: 30,
        right: 120,
        bottom: window.innerHeight + 230,
      });
      Object.defineProperty(below, 'offsetParent', { get: () => document.body });
      document.body.appendChild(below);

      expect(nav.visibleFocusables()).toContain(below);
    });

    it('centers the focused element instead of scrolling the bare minimum', () => {
      const [button] = layout([{ top: 0, left: 0 }]);
      const scrollIntoView = vi.fn();
      button.scrollIntoView = scrollIntoView;

      nav.focus(button);

      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    });
  });

  describe('sliders', () => {
    function slider(props = {}) {
      document.body.innerHTML = '';
      const el = document.createElement('input');
      el.type = 'range';
      el.min = props.min ?? '-60';
      el.max = props.max ?? '12';
      el.step = props.step ?? '0.5';
      el.value = props.value ?? '0';
      el.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        width: 200,
        height: 20,
        right: 200,
        bottom: 20,
      });
      Object.defineProperty(el, 'offsetParent', { get: () => document.body });
      document.body.appendChild(el);
      el.focus();
      return el;
    }

    it('RIGHT raises the value instead of moving focus off the slider', () => {
      // Clicking a range input does nothing, so without this a slider is a
      // control the gamepad can reach but never operate.
      const el = slider({ value: '0' });
      setPad(pad({ buttons: [BTN.RIGHT] }));
      nav.poll();

      expect(Number(el.value)).toBeGreaterThan(0);
      expect(document.activeElement).toBe(el);
    });

    it('LEFT lowers the value', () => {
      const el = slider({ value: '0' });
      setPad(pad({ buttons: [BTN.LEFT] }));
      nav.poll();

      expect(Number(el.value)).toBeLessThan(0);
    });

    it('fires input and change so React state updates', () => {
      // React-controlled inputs ignore a bare .value assignment; the event has to
      // go through the native setter or the UI silently reverts.
      const el = slider({ value: '0' });
      const onInput = vi.fn();
      const onChange = vi.fn();
      el.addEventListener('input', onInput);
      el.addEventListener('change', onChange);

      nav.adjustSlider(el, 1);

      expect(onInput).toHaveBeenCalled();
      expect(onChange).toHaveBeenCalled();
    });

    it('clamps at the ends', () => {
      const atMax = slider({ value: '12' });
      nav.adjustSlider(atMax, 1);
      expect(Number(atMax.value)).toBe(12);

      const atMin = slider({ value: '-60' });
      nav.adjustSlider(atMin, -1);
      expect(Number(atMin.value)).toBe(-60);
    });

    it('UP and DOWN still leave the slider, so it is never a trap', () => {
      const el = slider();
      const other = document.createElement('button');
      other.getBoundingClientRect = () => ({
        top: 100,
        left: 0,
        width: 100,
        height: 30,
        right: 100,
        bottom: 130,
      });
      Object.defineProperty(other, 'offsetParent', { get: () => document.body });
      document.body.appendChild(other);
      el.focus();

      nav.moveFocus('DOWN');
      expect(document.activeElement).toBe(other);
    });

    it('A nudges the slider rather than doing nothing', () => {
      const el = slider({ value: '0' });
      setPad(pad({ buttons: [BTN.A] }));
      nav.poll();
      expect(Number(el.value)).toBeGreaterThan(0);
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
