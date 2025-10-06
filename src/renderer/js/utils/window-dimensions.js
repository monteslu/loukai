/**
 * Window Dimensions Utility
 * Wraps window dimension APIs to avoid direct window.* usage throughout codebase
 */

/**
 * Get window width
 * @returns {number} Window inner width
 */
export function getWindowWidth() {
  return window.innerWidth;
}

/**
 * Get window height
 * @returns {number} Window inner height
 */
export function getWindowHeight() {
  return window.innerHeight;
}

/**
 * Get window dimensions
 * @returns {{width: number, height: number}} Window dimensions
 */
export function getWindowDimensions() {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

/**
 * Get window outer width (includes browser chrome)
 * @returns {number} Window outer width
 */
export function getWindowOuterWidth() {
  return window.outerWidth;
}

/**
 * Get window outer height (includes browser chrome)
 * @returns {number} Window outer height
 */
export function getWindowOuterHeight() {
  return window.outerHeight;
}
