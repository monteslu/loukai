/**
 * Creator paths. The creator runs entirely in-browser (WebGPU) — there is no Python /
 * PyTorch / model install to check, so this is now just the cache-dir helper that the
 * ffmpeg + webgpu-asset code shares.
 */

import { homedir, platform } from 'os';
import { join } from 'path';

/**
 * Data directory for the loukai creator (downloaded ffmpeg + WebGPU model cache).
 * Uses the same base as Electron's userData for consistency.
 */
export function getCacheDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'loukai', 'creator');
  } else if (plat === 'win32') {
    return join(homedir(), 'AppData', 'Local', 'loukai', 'creator');
  } else {
    return join(homedir(), '.config', 'loukai', 'creator');
  }
}
