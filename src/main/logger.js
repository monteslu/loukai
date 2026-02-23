/**
 * Simple logger that only outputs in development mode
 */

const isDev = process.argv.includes('--dev');

export const log = isDev ? console.log.bind(console) : () => {};
export const info = isDev ? console.info.bind(console) : () => {};
export const warn = console.warn.bind(console); // Always show warnings
export const error = console.error.bind(console); // Always show errors

export default { log, info, warn, error };
