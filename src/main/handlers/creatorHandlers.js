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
  // Check all components
  ipcMain.handle(CREATOR_CHANNELS.CHECK_COMPONENTS, () => {
    return creatorService.checkComponents();
  });

  // Get installation status
  ipcMain.handle(CREATOR_CHANNELS.GET_STATUS, () => {
    return creatorService.getStatus();
  });

  // Install components
  ipcMain.handle(CREATOR_CHANNELS.INSTALL_COMPONENTS, async () => {
    const result = await creatorService.installComponents((progress) => {
      mainApp.sendToRenderer(CREATOR_CHANNELS.INSTALL_PROGRESS, progress);
    });

    if (!result.success) {
      mainApp.sendToRenderer(CREATOR_CHANNELS.INSTALL_ERROR, {
        error: result.error,
      });
    }

    return result;
  });

  // Cancel installation
  ipcMain.handle(CREATOR_CHANNELS.CANCEL_INSTALL, () => {
    return creatorService.cancelInstall();
  });

  // Search lyrics from LRCLIB. Accept EITHER a single { title, artist } object (WebGPU
  // creator) OR positional (title, artist) (legacy CreateTab) — the two creators call
  // it differently, and a shape mismatch silently passed the whole object as `title`.
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

  // Start conversion
  ipcMain.handle(CREATOR_CHANNELS.START_CONVERSION, async (_event, options) => {
    // Single-job guard: if a conversion is already running (started from ANY
    // surface), return the running job so the renderer attaches instead of
    // starting a duplicate.
    const current = creatorService.getStatus();
    if (current.converting) {
      return {
        success: false,
        busy: true,
        error: 'Conversion already in progress',
        job: current.job,
      };
    }

    // Track if we're saving to songs folder (outputDir is set)
    const savedToSongsFolder = Boolean(options.outputDir);

    // Tag the job + broadcast its state to BOTH transports so a renderer-started
    // job is visible to (and blocks) every web admin too.
    options.source = 'electron';
    options.startedAt = Date.now();
    const broadcastJob = () => {
      const job = creatorService.getStatus().job;
      mainApp.sendToRenderer('creator:job', job);
      mainApp.webServer?.io?.to('admin-clients').emit('creator:job', job);
    };

    const result = await creatorService.startConversion(
      options,
      (progress) => {
        mainApp.sendToRenderer(CREATOR_CHANNELS.CONVERSION_PROGRESS, progress);
        broadcastJob();
      },
      (consoleLine) => {
        mainApp.sendToRenderer(CREATOR_CHANNELS.CONVERSION_CONSOLE, { line: consoleLine });
      },
      mainApp.settings // Pass settings manager for LLM
    );
    broadcastJob(); // terminal state

    if (result.success) {
      mainApp.sendToRenderer(CREATOR_CHANNELS.CONVERSION_COMPLETE, {
        outputPath: result.outputPath,
        duration: result.duration,
        stems: result.stems,
        hasLyrics: result.hasLyrics,
        hasPitch: result.hasPitch,
        llmStats: result.llmStats,
        savedToSongsFolder,
      });
    } else if (!result.cancelled) {
      mainApp.sendToRenderer(CREATOR_CHANNELS.CONVERSION_ERROR, {
        error: result.error,
      });
    }

    return result;
  });

  // Cancel conversion
  ipcMain.handle(CREATOR_CHANNELS.CANCEL_CONVERSION, () => {
    return creatorService.stopConversion();
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
