import { log } from '../logger.js';
/**
 * Stem Builder - Creates .stem.mp4 files with embedded stem data
 *
 * The .stem.mp4 format embeds multiple audio stems in a single M4A container
 * using custom atoms/boxes. This is compatible with Native Instruments Stems.
 *
 * Structure:
 * - ftyp (file type)
 * - moov (movie header with metadata)
 *   - udta/stem (NI Stems metadata for DJ software)
 *   - udta/meta/ilst/kara (karaoke data: lyrics, timing, word-level timing)
 * - mdat (media data with stems)
 *
 * Note: CREPE pitch detection is used only for key detection during creation.
 * Vocal pitch tracking for auto-tune/scoring is done at runtime.
 */

import { Atoms as M4AAtoms } from 'stem-mp4';

// NOTE: the old native-ffmpeg buildStemM4a (WAV/AAC -> multi-track mux via the
// ffmpeg binary) was removed. The WebGPU creator encodes stems to AAC in the
// renderer (ffmpeg-wasm) and stem-mp4's pure-JS StemMp4Writer does the mux; see
// creatorService.saveWebGpuStems. This module now only injects atoms + repairs
// NI-Stems metadata, all via the pure-JS stem-mp4 library (no ffmpeg).

/**
 * Inject karaoke atoms into an MP4 file using stem-mp4 library
 *
 * @param {string} filePath - Path to M4A file
 * @param {Object} data - Karaoke data to embed
 */
async function injectKaraokeAtoms(filePath, data) {
  const { lyrics, llmCorrections, tags, chords } = data;

  // Convert lyrics segments to lines format expected by kara atom
  // Include word-level timing if available from Whisper
  const lines = [];
  if (lyrics && lyrics.lines && lyrics.lines.length > 0) {
    const words = lyrics.words || [];

    for (const line of lyrics.lines) {
      const lineData = {
        start: line.start,
        end: line.end,
        text: line.text,
      };

      // Find words that fall within this line's time range
      const lineWords = words.filter((w) => w.start >= line.start && w.start < line.end);

      if (lineWords.length > 0) {
        // Compute relative timings: [startOffset, endOffset] from line.start
        // Round to 3 decimal places for reasonable precision
        const timings = lineWords.map((w) => [
          Math.round((w.start - line.start) * 1000) / 1000,
          Math.round(((w.end || w.start + 0.1) - line.start) * 1000) / 1000,
        ]);
        lineData.words = { timings };
      }

      lines.push(lineData);
    }
  }

  // Build kara data structure for stem-mp4
  // Note: Audio sources are read from the NI Stems 'stem' atom, not stored in kara
  const karaData = {
    ...(chords && chords.length > 0 && { chords }),
    // Timing information
    timing: {
      offset_sec: 0,
      encoder_delay_samples: 0,
    },

    // Tags for filtering (e.g., 'edited', 'ai_corrected')
    tags: tags || [],

    // Lyrics (lines)
    lines: lines,
  };

  // Add LLM corrections metadata if available
  // Uses same structure as KAI format for consistency with SongEditor
  if (
    llmCorrections &&
    (llmCorrections.corrections?.length > 0 || llmCorrections.missing_lines?.length > 0)
  ) {
    karaData.meta = {
      corrections: {
        // Applied corrections (for reference/audit)
        applied: (llmCorrections.corrections || []).map((c) => ({
          line: c.line_num,
          start: c.start_time,
          end: c.end_time,
          old: c.old_text,
          new: c.new_text,
          reason: c.reason,
          word_retention: c.retention_rate,
        })),
        // Suggested missing lines (user can review/add in editor)
        missing_lines_suggested: (llmCorrections.missing_lines || []).map((s) => ({
          suggested_text: s.suggested_text,
          start: s.start_time,
          end: s.end_time,
          confidence: s.confidence,
          reason: s.reason,
        })),
        // Stats
        provider: llmCorrections.provider,
        model: llmCorrections.model,
      },
    };
  }

  // Write kara atom using stem-mp4 library
  log(`💾 Writing kara atom: ${lines.length} lines`);
  await M4AAtoms.writeKaraAtom(filePath, karaData);

  // Verify final file size (debug)
  const { stat } = await import('fs/promises');
  const finalSize = (await stat(filePath)).size;
  log(`📊 Final file size after kara atom: ${finalSize} bytes`);

  // Note: Vocal pitch tracking is done at runtime, not stored in file.
  // CREPE output is used only for key detection (stored in standard metadata).

  log('✅ Karaoke atoms written successfully');
}

/**
 * Inject lyrics into an existing .stem.mp4 file
 * Used for "lyrics only" mode when stems already exist
 *
 * @param {Object} options - Injection options
 * @param {string} options.filePath - Path to existing .stem.mp4 file
 * @param {Object} options.lyrics - Whisper transcription result with word timestamps
 * @param {Object} options.llmCorrections - LLM correction stats
 * @param {string[]} options.tags - Tags array for filtering
 * @returns {Promise<void>}
 */
export async function injectLyricsIntoStemFile(options) {
  const { filePath, lyrics, llmCorrections, tags, chords } = options;

  log(`🎤 Injecting lyrics into existing stem file: ${filePath}`);

  // Read existing kara atom to preserve timing/tags
  let existingKara = null;
  try {
    existingKara = await M4AAtoms.readKaraAtom(filePath);
  } catch {
    // No existing kara atom - that's fine
  }

  // Build kara data structure with word-level timing if available
  const lines = [];
  if (lyrics && lyrics.lines && lyrics.lines.length > 0) {
    const words = lyrics.words || [];

    for (const line of lyrics.lines) {
      const lineData = {
        start: line.start,
        end: line.end,
        text: line.text,
      };

      // Find words that fall within this line's time range
      const lineWords = words.filter((w) => w.start >= line.start && w.start < line.end);

      if (lineWords.length > 0) {
        // Compute relative timings: [startOffset, endOffset] from line.start
        const timings = lineWords.map((w) => [
          Math.round((w.start - line.start) * 1000) / 1000,
          Math.round(((w.end || w.start + 0.1) - line.start) * 1000) / 1000,
        ]);
        lineData.words = { timings };
      }

      lines.push(lineData);
    }
  }

  // Note: Audio sources are read from the NI Stems 'stem' atom, not stored in kara
  const karaData = {
    ...(chords && chords.length > 0 && { chords }),
    timing: {
      offset_sec: existingKara?.timing?.offset_sec || 0,
      encoder_delay_samples: existingKara?.timing?.encoder_delay_samples || 0,
    },
    tags: tags || [],
    lines: lines,
  };

  // Add LLM corrections metadata if available
  if (
    llmCorrections &&
    (llmCorrections.corrections?.length > 0 || llmCorrections.missing_lines?.length > 0)
  ) {
    karaData.meta = {
      corrections: {
        applied: (llmCorrections.corrections || []).map((c) => ({
          line: c.line_num,
          start: c.start_time,
          end: c.end_time,
          old: c.old_text,
          new: c.new_text,
          reason: c.reason,
          word_retention: c.retention_rate,
        })),
        missing_lines_suggested: (llmCorrections.missing_lines || []).map((s) => ({
          suggested_text: s.suggested_text,
          start: s.start_time,
          end: s.end_time,
          confidence: s.confidence,
          reason: s.reason,
        })),
        provider: llmCorrections.provider,
        model: llmCorrections.model,
      },
    };
  }

  // Write kara atom
  log(`💾 Writing kara atom: ${lines.length} lines`);
  await M4AAtoms.writeKaraAtom(filePath, karaData);

  log('✅ Lyrics injected successfully');
}

/**
 * Repair an existing .stem.mp4 file to fix NI Stems metadata
 * This fixes files created before the spec-compliant stem atom was implemented
 *
 * @param {string} filePath - Path to existing .stem.mp4 file
 * @param {Object} options - Repair options
 * @param {boolean} options.force - Force rewrite even if metadata exists
 * @returns {Promise<Object>} Repair result
 */
export async function repairStemFile(filePath, options = {}) {
  log(`🔧 Checking stem file: ${filePath}`);

  // Default NI Stems order (excluding master, which is track 0)
  const stemPartsOnly = ['drums', 'bass', 'other', 'vocals'];

  try {
    // Check if NI Stems metadata already exists
    let existingMetadata = null;
    try {
      existingMetadata = await M4AAtoms.readNiStemsMetadata(filePath);
    } catch {
      // No existing metadata
    }

    if (existingMetadata && existingMetadata.stems && !options.force) {
      const existingStems = existingMetadata.stems.map((s) => s.name).join(', ');
      log(`✅ File already has valid NI Stems metadata: ${existingStems}`);
      log('   Use --force to rewrite anyway.');
      return {
        success: true,
        filePath,
        alreadyValid: true,
        existingStems: existingMetadata.stems.map((s) => s.name),
      };
    }

    // Write the stem atom with correct 4-stem metadata
    if (existingMetadata) {
      log(`🔄 Force rewriting NI Stems metadata for ${stemPartsOnly.length} stem parts`);
    } else {
      log(`🎛️ Adding NI Stems metadata for ${stemPartsOnly.length} stem parts`);
    }
    await M4AAtoms.addNiStemsMetadata(filePath, stemPartsOnly);

    log('✅ Stem file repaired successfully');
    log('⚠️  Note: Track disposition flags cannot be fixed without re-encoding.');
    log('    File should work in Mixxx/Traktor but may play wrong track in some players.');

    return {
      success: true,
      filePath,
      stemsFixed: stemPartsOnly,
    };
  } catch (error) {
    console.error('❌ Failed to repair stem file:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Batch repair multiple stem files
 * @param {string[]} filePaths - Array of paths to .stem.mp4 files
 * @param {Object} options - Repair options (passed to each repairStemFile call)
 * @returns {Promise<Object>} Batch repair results
 */
export async function repairStemFiles(filePaths, options = {}) {
  log(`🔧 Batch checking ${filePaths.length} stem files...`);

  const results = {
    total: filePaths.length,
    success: 0,
    failed: 0,
    alreadyValid: 0,
    repaired: 0,
    files: [],
  };

  for (const filePath of filePaths) {
    const result = await repairStemFile(filePath, options);
    results.files.push(result);
    if (result.success) {
      results.success++;
      if (result.alreadyValid) {
        results.alreadyValid++;
      } else {
        results.repaired++;
      }
    } else {
      results.failed++;
    }
  }

  log(
    `\n📊 Complete: ${results.alreadyValid} already valid, ${results.repaired} repaired, ${results.failed} failed`
  );
  return results;
}

export default {
  injectLyricsIntoStemFile,
  repairStemFile,
  repairStemFiles,
};
