/**
 * Window Events Utility
 * Wraps window event listeners to avoid direct window.* usage throughout codebase
 */

/**
 * Add event listener to window
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 * @param {Object} options - Event listener options
 */
export function onWindowEvent(event, handler, options) {
  window.addEventListener(event, handler, options);
}

/**
 * Remove event listener from window
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 * @param {Object} options - Event listener options
 */
export function offWindowEvent(event, handler, options) {
  window.removeEventListener(event, handler, options);
}

/**
 * Add DOMContentLoaded event listener
 * @param {Function} handler - Event handler
 */
export function onDOMReady(handler) {
  window.addEventListener('DOMContentLoaded', handler);
}

/**
 * Add window resize event listener
 * @param {Function} handler - Event handler
 */
export function onWindowResize(handler) {
  window.addEventListener('resize', handler);
}

/**
 * Add window load event listener
 * @param {Function} handler - Event handler
 */
export function onWindowLoad(handler) {
  window.addEventListener('load', handler);
}

/**
 * Add window focus event listener
 * @param {Function} handler - Event handler
 */
export function onWindowFocus(handler) {
  window.addEventListener('focus', handler);
}

/**
 * Add window blur event listener
 * @param {Function} handler - Event handler
 */
export function onWindowBlur(handler) {
  window.addEventListener('blur', handler);
}

/**
 * Add window beforeunload event listener
 * @param {Function} handler - Event handler
 */
export function onWindowBeforeUnload(handler) {
  window.addEventListener('beforeunload', handler);
}

/**
 * Dispatch custom event on window
 * @param {string} eventName - Custom event name
 * @param {*} detail - Event detail data
 */
export function dispatchWindowEvent(eventName, detail) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}
