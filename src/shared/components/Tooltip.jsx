/**
 * Tooltip - hover/focus hint rendered by React instead of the OS.
 *
 * DESIGN EXCEPTION, same family as PortalSelect: we prefer native HTML, but a
 * `title` attribute is not drawn by the page at all — Chromium asks the OS for
 * a popup surface, and those are broken on Electron's native Wayland (the same
 * bug class as electron#44607, which is why PortalSelect exists). The symptom
 * is a tooltip that flashes and vanishes instead of staying put.
 *
 * Rendering the hint into document.body keeps it inside Chromium's own
 * compositing, so it behaves identically on every platform and can be styled
 * and dark-mode aware.
 *
 * Usage — wrap the trigger, don't pass a `title`:
 *   <Tooltip text="Next Track">
 *     <button onClick={next}>…</button>
 *   </Tooltip>
 *
 * The child is cloned with the hover/focus handlers and a ref, so it must be a
 * single element that forwards DOM props (a plain tag, or a component that
 * spreads the rest onto its root). Focus is a first-class trigger, which the
 * gamepad focus ring gets for free.
 *
 * This workaround should be removed when Electron fixes Wayland popups.
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  cloneElement,
  isValidElement,
} from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 400;
const GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

/** True for controls where focus means "typing here", not "highlighted". */
function isTextEntry(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return el.isContentEditable === true;
  // Checkboxes/radios/buttons take focus without accepting text.
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(el.type);
}

/** Clamp horizontally so a tooltip near a screen edge stays fully on screen. */
function clampToViewport(left, width) {
  const max = window.innerWidth - VIEWPORT_MARGIN_PX - width / 2;
  const min = VIEWPORT_MARGIN_PX + width / 2;
  return Math.min(Math.max(left, min), max);
}

/**
 * @param suppressed - force-hide while the caller is mid-gesture (a
 *   hold-to-repeat button shouldn't keep a bubble over the control it repeats).
 */
export function Tooltip({
  text,
  children,
  placement = 'top',
  delay = SHOW_DELAY_MS,
  suppressed = false,
}) {
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const timerRef = useRef(null);
  const bubbleRef = useRef(null);
  const [bubbleWidth, setBubbleWidth] = useState(0);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRect(null);
  }, []);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Measure at show time, not on mount: the trigger may have scrolled or
      // been laid out since. (The previous per-file tooltip captured this once
      // and drifted.)
      if (triggerRef.current) {
        setRect(triggerRef.current.getBoundingClientRect());
      }
    }, delay);
  }, [delay]);

  // Clear the pending timer if we unmount mid-hover.
  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  // Caller took over (e.g. a press-and-hold started): drop the bubble.
  useEffect(() => {
    if (suppressed) hide();
  }, [suppressed, hide]);

  // A visible tooltip is anchored to a rect that scrolling or resizing
  // invalidates; drop it rather than leave it floating somewhere wrong.
  useEffect(() => {
    if (!rect) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [rect, hide]);

  useEffect(() => {
    if (rect && bubbleRef.current) {
      setBubbleWidth(bubbleRef.current.offsetWidth);
    }
  }, [rect, text]);

  if (!isValidElement(children)) return children ?? null;
  // No text means no tooltip, but the child must still render.
  if (!text) return children;

  // React 19: ref is a regular prop, so read it from props (children.ref is gone).
  const childRef = children.props.ref;

  const trigger = cloneElement(children, {
    ref: (node) => {
      triggerRef.current = node;
      if (typeof childRef === 'function') childRef(node);
      else if (childRef && typeof childRef === 'object') childRef.current = node;
    },
    onMouseEnter: (e) => {
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e) => {
      children.props.onFocus?.(e);
      // Keyboard focus should reveal the hint (that's how the gamepad ring gets
      // it), but not on a field you're typing into — the bubble would sit over
      // the text. Hover still works on those.
      if (!isTextEntry(e.currentTarget)) show();
    },
    onBlur: (e) => {
      children.props.onBlur?.(e);
      hide();
    },
    // A click means the user acted; the hint has served its purpose.
    onClick: (e) => {
      children.props.onClick?.(e);
      hide();
    },
  });

  const visible = rect && !suppressed;
  const above = placement !== 'bottom';
  const style = visible
    ? {
        position: 'fixed',
        left: bubbleWidth
          ? clampToViewport(rect.left + rect.width / 2, bubbleWidth)
          : rect.left + rect.width / 2,
        top: above ? rect.top - GAP_PX : rect.bottom + GAP_PX,
        transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 10000,
      }
    : null;

  return (
    <>
      {trigger}
      {visible &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            style={style}
            className="px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg whitespace-nowrap pointer-events-none"
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
