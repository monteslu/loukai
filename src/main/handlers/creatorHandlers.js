import { log } from '../logger.js';
/**
 * Creator IPC Handlers
 * Handles AI tool installation and karaoke file creation
 *
 * Uses shared creatorService for logic - same service is used by HTTP routes
 */

import { ipcMain, dialog } from 'electron';
import { CREATOR_CHANNELS } from '../../shared/ipcContracts.js';
import * as creatorService from '../../shared/services/creatorService.js';
import * as libraryService from '../../shared/services/libraryService.js';
import * as llmService from '../creator/llmService.js';
import { getCacheDir } from '../creator/systemChecker.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

/**
 * Register all creator-related IPC handlers
 * @param {Object} mainApp - Main application instance
 */
export function registerCreatorHandlers(mainApp) {
  // Creator status (cache dir + current save job). No native install step — the creator
  // runs entirely in-browser (WebGPU).
  ipcMain.handle(CREATOR_CHANNELS.GET_STATUS, () => {
    return creatorService.getStatus();
  });

  // Search lyrics from LRCLIB. Accept EITHER a single { title, artist } object (WebGPU
  // creator) OR positional (title, artist) — normalize either shape (a positional
  // object had been landing in `title`, producing "[object Object]" queries).
  ipcMain.handle(CREATOR_CHANNELS.SEARCH_LYRICS, (_event, a, b) => {
    const { title, artist } = a && typeof a === 'object' ? a : { title: a, artist: b };
    return creatorService.findLyrics(title, artist);
  });

  // Prepare Whisper context with vocabulary hints (same dual-shape handling).
  ipcMain.handle(CREATOR_CHANNELS.PREPARE_WHISPER_CONTEXT, (_event, a, b, c) => {
    const { title, artist, existingLyrics } =
      a && typeof a === 'object' ? a : { title: a, artist: b, existingLyrics: c };
    return creatorService.getWhisperContext(title, artist, existingLyrics);
  });

  // Select audio/video file (Electron-only - uses native dialog)
  ipcMain.handle(CREATOR_CHANNELS.SELECT_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog(mainApp.mainWindow, {
        title: 'Select Audio or Video File',
        properties: ['openFile'],
        filters: [
          {
            name: 'Audio/Video Files',
            extensions: [
              'mp3',
              'wav',
              'flac',
              'ogg',
              'm4a',
              'aac',
              'mp4',
              'mkv',
              'avi',
              'mov',
              'webm',
            ],
          },
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] },
          { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      // Use shared service to get file info
      return creatorService.getFileInfo(result.filePaths[0]);
    } catch (error) {
      console.error('File selection failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Get LLM settings
  ipcMain.handle(CREATOR_CHANNELS.GET_LLM_SETTINGS, () => {
    return llmService.getLLMSettings(mainApp.settings);
  });

  // Save LLM settings
  ipcMain.handle(CREATOR_CHANNELS.SAVE_LLM_SETTINGS, (_event, settings) => {
    llmService.saveLLMSettings(mainApp.settings, settings);
    return { success: true };
  });

  // Test LLM connection. The renderer may send back the masked key (unchanged);
  // resolve it to the real stored key before calling the provider.
  ipcMain.handle(CREATOR_CHANNELS.TEST_LLM_CONNECTION, (_event, settings) => {
    const resolved = llmService.resolveRuntimeSettings(mainApp.settings, settings);
    return llmService.testLLMConnection(resolved);
  });

  // Save a WebGPU-Creator result (separated + transcribed in-browser) as a
  // .stem.mp4. The renderer (player window) uses THIS IPC path — it has no admin
  // HTTP session (the web admin uses POST /admin/webgpu-creator/save instead).
  // stems = { master, drums, bass, other, vocals } as WAV Uint8Array/ArrayBuffer.
  ipcMain.handle(
    'creator:saveWebGpuStems',
    async (_event, { stems, metadata, lyrics, pitch, referenceLyrics }) => {
      const tmpDir = join(getCacheDir(), 'webgpu-creator', crypto.randomBytes(8).toString('hex'));
      mkdirSync(tmpDir, { recursive: true });
      const paths = {};
      try {
        for (const name of ['master', 'drums', 'bass', 'other', 'vocals']) {
          if (!stems?.[name]) throw new Error(`missing stem: ${name}`);
          const p = join(tmpDir, `${name}.wav`);
          writeFileSync(p, Buffer.from(stems[name]));
          paths[name] = p;
        }
        const result = await creatorService.saveWebGpuStems({
          stems: paths,
          metadata,
          lyrics,
          pitch,
          referenceLyrics,
          settingsManager: mainApp.settings, // backend runs LLM correction (like native)
          songsFolder: mainApp.settings?.getSongsFolder?.(),
        });
        // Re-sync the library so the new song appears immediately (matches the native
        // creator). Best-effort — a sync failure must not fail the save.
        try {
          await libraryService.syncLibrary(mainApp);
        } catch (err) {
          log(`library sync after WebGPU save failed: ${err.message}`);
        }
        return { success: true, ...result };
      } catch (e) {
        return { success: false, error: e.message };
      } finally {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    }
  );

  // LLM lyric correction (used by the WebGPU creator after transcription). Sends
  // the Whisper output + reference lyrics to the configured LLM to fix mis-heard
  // words. Resolves the stored (real) LLM settings server-side.
  ipcMain.handle('creator:correctLyrics', async (_event, { whisperOutput, referenceLyrics }) => {
    try {
      const settings = llmService.resolveRuntimeSettings(
        mainApp.settings,
        llmService.getLLMSettingsRaw(mainApp.settings)
      );
      const result = await llmService.correctLyrics(whisperOutput, referenceLyrics, settings);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Lyrics-only update: rewrite the kara atom (+key) on an existing .stem.mp4
  // (re-transcribed in-browser). Audio/stems untouched. Player path (file on disk).
  ipcMain.handle('creator:updateStemLyrics', async (_event, { inputPath, lyrics, key, pitch }) => {
    try {
      const result = await creatorService.updateStemLyrics({ inputPath, lyrics, key, pitch });
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  log('✅ Creator handlers registered');
}
