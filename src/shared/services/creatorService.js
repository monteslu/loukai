/**
 * Creator Service - Shared service for karaoke file creation
 *
 * Used by both:
 * - IPC handlers (Electron renderer)
 * - HTTP routes (Web admin)
 *
 * Progress callbacks support both IPC (mainApp.sendToRenderer) and
 * Socket.IO (io.emit) for real-time updates.
 */

import {
  checkAllComponents,
  getCacheDir,
  getPythonPath,
} from '../../main/creator/systemChecker.js';
import { installAllComponents } from '../../main/creator/downloadManager.js';
import { searchLyrics, prepareWhisperContext } from '../../main/creator/lrclibService.js';
import { getAudioInfo, isVideoFile } from '../../main/creator/ffmpegService.js';
import {
  runConversion,
  cancelConversion,
  isConversionInProgress,
} from '../../main/creator/conversionService.js';
import { repairStemFile, repairStemFiles } from '../../main/creator/stemBuilder.js';
import { basename } from 'path';
import { Atoms as M4AAtoms } from 'm4a-stems';

// Track installation state
let installationInProgress = false;
let installationCancelled = false;

/**
 * Check all components status
 * @returns {Promise<Object>} Component status
 */
export async function checkComponents() {
  try {
    const result = await checkAllComponents();
    return {
      success: true,
      ...result,
    };
  } catch (error) {
    console.error('Failed to check components:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get installation status
 * @returns {Object} Status info
 */
export function getStatus() {
  return {
    installing: installationInProgress,
    cancelled: installationCancelled,
    converting: isConversionInProgress(),
    cacheDir: getCacheDir(),
    pythonPath: getPythonPath(),
  };
}

/**
 * Install all components
 * @param {Function} onProgress - Progress callback (progress, message)
 * @returns {Promise<Object>} Installation result
 */
export async function installComponents(onProgress) {
  if (installationInProgress) {
    return { success: false, error: 'Installation already in progress' };
  }

  installationInProgress = true;
  installationCancelled = false;

  try {
    onProgress?.({
      step: 'starting',
      message: 'Starting installation...',
      progress: 0,
    });

    const result = await installAllComponents((progress, message) => {
      if (installationCancelled) {
        throw new Error('Installation cancelled');
      }

      onProgress?.({
        step: 'installing',
        message,
        progress,
      });
    });

    if (result.success) {
      onProgress?.({
        step: 'complete',
        message: 'Installation complete',
        progress: 100,
      });
    }

    installationInProgress = false;
    return result;
  } catch (error) {
    installationInProgress = false;
    return { success: false, error: error.message };
  }
}

/**
 * Cancel installation
 * @returns {Object} Result
 */
export function cancelInstall() {
  if (!installationInProgress) {
    return { success: false, error: 'No installation in progress' };
  }

  installationCancelled = true;
  return { success: true };
}

/**
 * Search for lyrics
 * @param {string} title - Song title
 * @param {string} artist - Artist name
 * @returns {Promise<Object>} Lyrics result
 */
export async function findLyrics(title, artist) {
  try {
    const result = await searchLyrics(title, artist);
    if (result) {
      return { success: true, ...result };
    }
    return { success: false, error: 'No lyrics found' };
  } catch (error) {
    console.error('Lyrics search failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Prepare Whisper context with vocabulary hints
 * @param {string} title - Song title
 * @param {string} artist - Artist name
 * @param {string} existingLyrics - Reference lyrics
 * @returns {Promise<Object>} Context result
 */
export async function getWhisperContext(title, artist, existingLyrics) {
  try {
    const result = await prepareWhisperContext(title, artist, existingLyrics);
    return { success: true, ...result };
  } catch (error) {
    console.error('Whisper context preparation failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get file info for a path
 * Reads ID3 tags if available, falls back to filename parsing.
 * Auto-searches LRCLIB for lyrics if artist and title are found.
 * Detects M4A files with existing stems but no karaoke lyrics.
 *
 * @param {string} filePath - Path to audio/video file
 * @returns {Promise<Object>} File info with optional lyrics
 */
export async function getFileInfo(filePath) {
  try {
    const fileName = basename(filePath);
    const audioInfo = await getAudioInfo(filePath);
    const isVideo = await isVideoFile(filePath);
    const lowerPath = filePath.toLowerCase();

    // Prefer ID3 tags, fall back to filename parsing
    let title = audioInfo.title || '';
    let artist = audioInfo.artist || '';
    const album = audioInfo.album || '';

    // If no ID3 tags, try to parse from filename (Artist - Title format)
    if (!title) {
      title = fileName.replace(/\.[^.]+$/, '');
      const dashMatch = title.match(/^(.+?)\s*-\s*(.+)$/);
      if (dashMatch) {
        artist = artist || dashMatch[1].trim();
        title = dashMatch[2].trim();
      }
    }

    // Check for M4A with existing stems (NI Stems format has 5 audio streams: master + 4 stems)
    let hasStems = false;
    let hasLyrics = false;
    let stemNames = [];
    let vocalsTrackIndex = null;

    if (lowerPath.endsWith('.m4a') || lowerPath.endsWith('.mp4')) {
      // Check for multiple audio streams (stems)
      if (audioInfo.audioStreamCount >= 4) {
        hasStems = true;
        stemNames = audioInfo.audioStreams.map((s) => s.title);

        // Find vocals track index
        const vocalsStream = audioInfo.audioStreams.find((s) => s.title.toLowerCase() === 'vocals');
        if (vocalsStream) {
          vocalsTrackIndex = vocalsStream.index;
        }

        console.log(
          `🎵 Detected stem file: ${audioInfo.audioStreamCount} tracks [${stemNames.join(', ')}]`
        );
      }

      // Check for existing kara atom with lyrics
      if (hasStems) {
        try {
          const karaData = await M4AAtoms.readKaraAtom(filePath);
          if (karaData && karaData.lines && karaData.lines.length > 0) {
            hasLyrics = true;
            console.log(`📝 Found existing lyrics: ${karaData.lines.length} lines`);
          }
        } catch {
          // No kara atom - that's fine, we'll add one
        }
      }
    }

    const result = {
      success: true,
      file: {
        path: filePath,
        name: fileName,
        title,
        artist,
        album,
        duration: audioInfo.duration,
        sampleRate: audioInfo.sampleRate,
        channels: audioInfo.channels,
        codec: audioInfo.codec,
        isVideo,
        hasId3Tags: Boolean(audioInfo.title || audioInfo.artist),
        // Preserve ALL original tags for inclusion in output file
        tags: audioInfo.tags || {},
        // Stem detection info
        hasStems,
        hasLyrics,
        stemNames,
        vocalsTrackIndex,
        audioStreamCount: audioInfo.audioStreamCount,
      },
    };

    // Auto-search LRCLIB if we have both artist and title
    if (artist && title) {
      try {
        const lyricsResult = await searchLyrics(title, artist);
        if (lyricsResult) {
          result.lyrics = lyricsResult;
        }
      } catch (e) {
        // Non-fatal - lyrics lookup failed
        console.log('Auto lyrics lookup failed:', e.message);
      }
    }

    return result;
  } catch (error) {
    console.error('Failed to get file info:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Start conversion
 * @param {Object} options - Conversion options
 * @param {Function} onProgress - Progress callback
 * @param {Function} onConsoleOutput - Console output callback
 * @param {Object} settingsManager - Settings manager for LLM settings
 * @returns {Promise<Object>} Conversion result
 */
export async function startConversion(
  options,
  onProgress,
  onConsoleOutput = null,
  settingsManager = null
) {
  if (isConversionInProgress()) {
    return { success: false, error: 'Conversion already in progress' };
  }

  try {
    onProgress?.({
      step: 'starting',
      message: 'Starting conversion...',
      progress: 0,
    });

    const result = await runConversion(
      options,
      (step, message, progress) => {
        onProgress?.({
          step,
          message,
          progress,
        });
      },
      onConsoleOutput,
      settingsManager
    );

    return result;
  } catch (error) {
    console.error('Conversion failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancel conversion
 * @returns {Object} Result
 */
export function stopConversion() {
  const cancelled = cancelConversion();
  return { success: cancelled };
}

/**
 * Repair a stem file to fix NI Stems metadata
 * @param {string} filePath - Path to .stem.m4a file
 * @returns {Promise<Object>} Repair result
 */
export async function repairStem(filePath) {
  try {
    const result = await repairStemFile(filePath);
    return result;
  } catch (error) {
    console.error('Failed to repair stem file:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Batch repair multiple stem files
 * @param {string[]} filePaths - Array of paths to .stem.m4a files
 * @returns {Promise<Object>} Batch repair results
 */
export async function repairStems(filePaths) {
  try {
    const result = await repairStemFiles(filePaths);
    return result;
  } catch (error) {
    console.error('Failed to batch repair stem files:', error);
    return { success: false, error: error.message };
  }
}

export default {
  checkComponents,
  getStatus,
  installComponents,
  cancelInstall,
  findLyrics,
  getWhisperContext,
  getFileInfo,
  startConversion,
  stopConversion,
  repairStem,
  repairStems,
};
