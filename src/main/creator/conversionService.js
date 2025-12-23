/**
 * Conversion Service - Orchestrates the full karaoke creation pipeline
 *
 * Steps:
 * 1. Convert input to WAV (if needed)
 * 2. Run Demucs stem separation
 * 3. Run Whisper transcription on vocals
 * 4. Run CREPE pitch detection on vocals (optional)
 * 5. Assemble into .stem.m4a file
 */

import { join, dirname } from 'path';
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { convertToWav, encodeToAAC, extractStemTrack } from './ffmpegService.js';
import { runDemucs, runWhisper, runCrepe } from './pythonRunner.js';
import { prepareWhisperContext } from './lrclibService.js';
import { buildStemM4a, injectLyricsIntoStemFile } from './stemBuilder.js';
import * as llmService from './llmService.js';
import { detectKey } from './keyDetection.js';

// Active conversion state
let conversionInProgress = false;
let conversionCancelled = false;
let currentProcess = null;

/**
 * Check if conversion is in progress
 * @returns {boolean}
 */
export function isConversionInProgress() {
  return conversionInProgress;
}

/**
 * Cancel the current conversion
 * @returns {boolean} True if cancellation was initiated
 */
export function cancelConversion() {
  if (!conversionInProgress) {
    return false;
  }

  conversionCancelled = true;

  // Kill current subprocess if any
  if (currentProcess && typeof currentProcess.kill === 'function') {
    try {
      currentProcess.kill('SIGTERM');
    } catch {
      // Process may have already ended
    }
  }

  // Reset flag immediately so user can start a new conversion
  // The cancelled subprocess will clean up when it eventually errors
  conversionInProgress = false;

  return true;
}

/**
 * Check if conversion was cancelled
 * @throws {Error} If cancelled
 */
function checkCancelled() {
  if (conversionCancelled) {
    throw new Error('Conversion cancelled');
  }
}

/**
 * Run the full conversion pipeline
 *
 * @param {Object} options - Conversion options
 * @param {string} options.inputPath - Path to input audio/video file
 * @param {string} options.title - Song title
 * @param {string} options.artist - Artist name
 * @param {Object} options.tags - All original ID3 tags to preserve
 * @param {number} options.numStems - Number of stems (2 or 4)
 * @param {string} options.whisperModel - Whisper model to use
 * @param {string} options.language - Language code
 * @param {boolean} options.enableCrepe - Whether to run pitch detection
 * @param {string} options.referenceLyrics - Reference lyrics for Whisper hints
 * @param {string} options.outputDir - Output directory (defaults to input file directory)
 * @param {boolean} options.lyricsOnlyMode - Skip stem separation (for existing stem files)
 * @param {number} options.vocalsTrackIndex - Track index for vocals (for lyrics-only mode)
 * @param {Function} onProgress - Progress callback (step, message, progress)
 * @param {Function} onConsoleOutput - Console output callback (line)
 * @param {Object} settingsManager - Settings manager for LLM settings
 * @returns {Promise<Object>} Result with outputPath
 */
export async function runConversion(
  options,
  onProgress = () => {},
  onConsoleOutput = null,
  settingsManager = null
) {
  const {
    inputPath,
    title,
    artist,
    tags = {},
    numStems = 4,
    whisperModel = 'large-v3-turbo',
    language = 'en',
    enableCrepe = true,
    referenceLyrics = '',
    outputDir = dirname(inputPath),
    lyricsOnlyMode = false,
    vocalsTrackIndex = 4, // Default: vocals is typically track 4 in NI Stems format (0=master, 1=drums, 2=bass, 3=other, 4=vocals)
  } = options;

  if (conversionInProgress) {
    throw new Error('Conversion already in progress');
  }

  conversionInProgress = true;
  conversionCancelled = false;
  currentProcess = null;

  // Create temp directory for intermediate files
  const tempDir = join(tmpdir(), `kai-convert-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  // Create stems temp directory
  const stemsDir = join(tempDir, 'stems');
  mkdirSync(stemsDir, { recursive: true });

  try {
    const safeFileName = (artist ? `${artist} - ${title}` : title).replace(/[<>:"/\\|?*]/g, '_');

    const setCurrentProcess = (proc) => {
      currentProcess = proc;
    };

    // Different step labels for lyrics-only mode vs full conversion
    const STEPS = lyricsOnlyMode
      ? {
          extract: '1/4 Extract',
          context: '2/4 Context',
          whisper: '3/4 Lyrics',
          crepe: '4/4 Pitch',
          inject: '✓ Inject',
        }
      : {
          wav: '1/7 Prepare',
          demucs: '2/7 Stems',
          context: '3/7 Context',
          whisper: '4/7 Lyrics',
          crepe: '5/7 Pitch',
          encode: '6/7 Encode',
          build: '7/7 Build',
        };

    let vocalsWavPath;
    let stemPaths = null;
    let demucsResult = null;

    if (lyricsOnlyMode) {
      // ========================================
      // LYRICS-ONLY MODE: Skip stem separation
      // ========================================
      console.log('🎤 Lyrics-only mode: extracting vocals from existing stem file');

      // Step 1: Extract vocals track to temp WAV (0-10%)
      onProgress('extract', `[${STEPS.extract}] Extracting vocals track...`, 0);
      checkCancelled();

      vocalsWavPath = join(tempDir, 'vocals.wav');
      await extractStemTrack(inputPath, vocalsWavPath, vocalsTrackIndex, { sampleRate: 44100 });

      onProgress('extract', `[${STEPS.extract}] Vocals extracted`, 10);
      checkCancelled();
    } else {
      // ========================================
      // FULL CONVERSION MODE: Stem separation
      // ========================================

      // Step 1: Convert to WAV (0-5%)
      onProgress('wav', `[${STEPS.wav}] Converting to WAV...`, 0);
      checkCancelled();

      const wavPath = join(tempDir, 'input.wav');
      await convertToWav(inputPath, wavPath, { sampleRate: 44100 }, (progress) => {
        onProgress(
          'wav',
          `[${STEPS.wav}] Converting to WAV... ${Math.round(progress)}%`,
          Math.floor(progress * 0.05)
        );
      });

      checkCancelled();

      // Step 2: Run Demucs (5-50%)
      onProgress('demucs', `[${STEPS.demucs}] Loading Demucs...`, 5);
      checkCancelled();

      demucsResult = await runDemucs(
        wavPath,
        stemsDir,
        { numStems },
        (progress, message) => {
          onProgress('demucs', `[${STEPS.demucs}] ${message}`, 5 + Math.floor(progress * 0.45));
        },
        onConsoleOutput,
        setCurrentProcess
      );

      checkCancelled();

      // Use stem paths returned by demucs_runner.py
      stemPaths = demucsResult.stems;

      if (!stemPaths || Object.keys(stemPaths).length === 0) {
        throw new Error('Demucs did not return stem paths');
      }

      // Verify stem files exist
      for (const [name, path] of Object.entries(stemPaths)) {
        if (!existsSync(path)) {
          throw new Error(`Stem file not found: ${name} at ${path}`);
        }
      }

      vocalsWavPath = stemPaths.vocals;
    }

    // ========================================
    // COMMON: Whisper + CREPE + Output
    // ========================================

    // Progress offsets differ between modes
    const contextStart = lyricsOnlyMode ? 10 : 50;
    const whisperStart = lyricsOnlyMode ? 15 : 52;
    const whisperEnd = lyricsOnlyMode ? 70 : 80;
    const crepeStart = lyricsOnlyMode ? 70 : 80;
    const crepeEnd = lyricsOnlyMode ? 95 : 90;

    // Step: Prepare Whisper context
    onProgress('context', `[${STEPS.context}] Preparing vocabulary hints...`, contextStart);
    checkCancelled();

    let initialPrompt = '';
    if (referenceLyrics) {
      const context = await prepareWhisperContext(title, artist, referenceLyrics);
      initialPrompt = context.initialPrompt || '';
      onProgress(
        'context',
        `[${STEPS.context}] Using ${initialPrompt.split(' ').length} vocabulary hints`,
        contextStart + 1
      );
    }

    // Step: Run Whisper
    onProgress('whisper', `[${STEPS.whisper}] Loading Whisper...`, whisperStart);
    checkCancelled();

    if (initialPrompt) {
      console.log(`🎤 Whisper prompt: ${initialPrompt}`);
    }

    let whisperResult = await runWhisper(
      vocalsWavPath,
      {
        model: whisperModel,
        language,
        initialPrompt,
      },
      (progress, message) => {
        const whisperProgressRange = whisperEnd - whisperStart;
        onProgress(
          'whisper',
          `[${STEPS.whisper}] ${message}`,
          whisperStart + Math.floor(progress * (whisperProgressRange / 100))
        );
      },
      onConsoleOutput,
      setCurrentProcess
    );

    checkCancelled();

    // LLM lyrics correction (optional)
    let llmStats = null;
    if (settingsManager && referenceLyrics) {
      try {
        const llmSettings = llmService.getLLMSettings(settingsManager);
        // Local LLM (lmstudio) doesn't require API key
        const hasValidConfig = llmSettings.provider === 'lmstudio' || llmSettings.apiKey;
        if (llmSettings.enabled && hasValidConfig) {
          onProgress('whisper', `[${STEPS.whisper}] 🤖 AI correction...`, whisperEnd - 2);
          const llmResult = await llmService.correctLyrics(
            whisperResult,
            referenceLyrics,
            llmSettings
          );
          whisperResult = llmResult.output;
          llmStats = llmResult.stats;
        }
      } catch (error) {
        console.warn('⚠️ LLM correction failed, using original Whisper output:', error.message);
        // Continue with original Whisper output
        llmStats = {
          corrections_applied: 0,
          suggestions_made: 0,
          corrections_rejected: 0,
          failed: true,
          error: error.message,
        };
      }
    }

    checkCancelled();

    // Run CREPE (optional)
    let pitchData = null;
    if (enableCrepe) {
      onProgress('crepe', `[${STEPS.crepe}] Loading CREPE...`, crepeStart);
      checkCancelled();

      const crepeProgressRange = crepeEnd - crepeStart;
      const crepeResult = await runCrepe(
        vocalsWavPath,
        null,
        {},
        (progress, message) => {
          onProgress(
            'crepe',
            `[${STEPS.crepe}] ${message}`,
            crepeStart + Math.floor(progress * (crepeProgressRange / 100))
          );
        },
        onConsoleOutput,
        setCurrentProcess
      );

      pitchData = crepeResult;

      // Detect musical key from pitch data
      if (pitchData?.pitch_data) {
        const keyResult = detectKey(pitchData);
        if (keyResult.key !== 'unknown') {
          console.log(
            `🎵 Detected key: ${keyResult.key} (confidence: ${(keyResult.confidence * 100).toFixed(0)}%)`
          );
          pitchData.detected_key = keyResult;
        }
      }
    }

    checkCancelled();

    // Build tags array for filtering
    const karaTags = [];
    if (llmStats && llmStats.corrections_applied > 0) {
      karaTags.push('ai_corrected');
    }

    let outputPath;

    if (lyricsOnlyMode) {
      // ========================================
      // LYRICS-ONLY: Inject kara atom into existing file
      // ========================================
      onProgress('inject', `[${STEPS.inject}] Adding lyrics to stem file...`, 95);
      checkCancelled();

      // Output to same directory with modified name, or optionally overwrite in place
      outputPath = join(outputDir, `${safeFileName}.stem.m4a`);

      // Copy original file to output location if different
      if (inputPath !== outputPath) {
        copyFileSync(inputPath, outputPath);
      }

      // Inject lyrics into the copied/original file
      await injectLyricsIntoStemFile({
        filePath: outputPath,
        lyrics: whisperResult,
        pitch: pitchData,
        llmCorrections: llmStats,
        tags: karaTags,
      });

      onProgress('complete', '✓ Lyrics added to stem file!', 100);
    } else {
      // ========================================
      // FULL CONVERSION: Encode stems and build new file
      // ========================================
      const stemLabels = {
        master: '🎵 Master',
        vocals: '🎤 Vocals',
        drums: '🥁 Drums',
        bass: '🎸 Bass',
        other: '🎹 Other',
        no_vocals: '🎵 Instrumental',
      };

      onProgress('encode', `[${STEPS.encode}] Encoding stems to AAC...`, 90);
      checkCancelled();

      const aacPaths = {};
      const wavPath = join(tempDir, 'input.wav');

      // First encode the master (original mix) - required by NI Stems spec
      const masterAacPath = join(tempDir, 'master.m4a');
      onProgress('encode', `[${STEPS.encode}] Encoding ${stemLabels.master}...`, 90);
      await encodeToAAC(wavPath, masterAacPath, { codec: 'aac', bitrate: '192k' });
      aacPaths.master = masterAacPath;

      checkCancelled();

      // Then encode the individual stems in NI Stems order: drums, bass, other, vocals
      const stemOrder = ['drums', 'bass', 'other', 'vocals'];
      const encodeProgress = 4 / stemOrder.length;

      for (let i = 0; i < stemOrder.length; i++) {
        const stemName = stemOrder[i];
        const stemPath = stemPaths[stemName];
        if (!stemPath) continue; // Skip if stem doesn't exist

        const aacPath = join(tempDir, `${stemName}.m4a`);
        const label = stemLabels[stemName] || stemName;

        onProgress(
          'encode',
          `[${STEPS.encode}] Encoding ${label}...`,
          91 + Math.floor(i * encodeProgress)
        );
        await encodeToAAC(stemPath, aacPath, { codec: 'aac', bitrate: '192k' });
        aacPaths[stemName] = aacPath;

        checkCancelled();
      }

      // Build .stem.m4a (95-100%)
      onProgress('build', `[${STEPS.build}] Packaging stem.m4a file...`, 95);
      checkCancelled();

      outputPath = join(outputDir, `${safeFileName}.stem.m4a`);

      await buildStemM4a({
        outputPath,
        stems: aacPaths,
        metadata: {
          title,
          artist,
          duration: demucsResult?.duration || 0,
          tags, // Preserve all original ID3 tags
        },
        lyrics: whisperResult,
        pitch: pitchData,
        llmCorrections: llmStats, // LLM corrections metadata
        tags: karaTags, // Kara atom tags for filtering
      });

      onProgress('complete', '✓ Karaoke file created!', 100);
    }

    // Cleanup temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      console.warn('Failed to cleanup temp directory:', tempDir);
    }

    conversionInProgress = false;

    return {
      success: true,
      outputPath,
      duration: demucsResult?.duration || 0,
      stems: lyricsOnlyMode ? [] : Object.keys(stemPaths || {}),
      hasLyrics: Boolean(whisperResult?.words?.length),
      hasPitch: Boolean(pitchData),
      llmStats,
      lyricsOnlyMode,
    };
  } catch (error) {
    conversionInProgress = false;

    // Cleanup on error
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    if (conversionCancelled) {
      return { success: false, cancelled: true };
    }

    throw error;
  }
}

export default {
  runConversion,
  cancelConversion,
  isConversionInProgress,
};
