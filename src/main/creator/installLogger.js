/**
 * Installation Logger - Intercepts console.log and sends to UI
 */

let logCallback = null;

/**
 * Set the callback to receive log messages
 */
export function setLogCallback(callback) {
  logCallback = callback;
}

/**
 * Clear the callback
 */
export function clearLogCallback() {
  logCallback = null;
}

/**
 * Log a message (sends to console AND callback)
 */
export function log(...args) {
  // Always log to console
  console.log(...args);

  // Also send to UI if callback is set
  if (logCallback) {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    logCallback(message);
  }
}

/**
 * Log an error (sends to console AND callback)
 */
export function error(...args) {
  // Always log to console
  console.error(...args);

  // Also send to UI if callback is set
  if (logCallback) {
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    logCallback('❌ ' + message);
  }
}
