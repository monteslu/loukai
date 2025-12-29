/**
 * Stem Builder - Creates .stem.m4a files with embedded stem data
 *
 * The .stem.m4a format embeds multiple audio stems in a single M4A container
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

import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { getFFmpegPath } from './systemChecker.js';
import { Atoms as M4AAtoms } from 'm4a-stems';

/**
 * Build a .stem.m4a file from individual stem files
 *
 * @param {Object} options - Build options
 * @param {string} options.outputPath - Output .stem.m4a path
 * @param {Object} options.stems - Map of stem name to path
 * @param {Object} options.metadata - Song metadata (title, artist, duration)
 * @param {Object} options.lyrics - Whisper transcription result with word timestamps
 * @param {Object} options.pitch - CREPE pitch detection result
 * @param {string[]} options.tags - Tags array for filtering (e.g., ['ai_corrected'])
 * @returns {Promise<void>}
 */
export async function buildStemM4a(options) {
  const { outputPath, stems, metadata, lyrics, pitch, llmCorrections, tags } = options;

  // For now, use ffmpeg to mux stems into a single file
  // The stem.m4a format requires custom atom injection
  // We'll use the first stem as the main track and embed others as metadata

  const ffmpegPath = getFFmpegPath();

  // Build ffmpeg command to combine stems
  // Using -map to include multiple audio streams
  const args = [];

  // NI Stems track order: master, drums, bass, other, vocals
  const niStemOrder = ['master', 'drums', 'bass', 'other', 'vocals'];
  const stemNames = niStemOrder.filter((name) => stems[name]);

  // Add input files in correct order
  for (const name of stemNames) {
    args.push('-i', stems[name]);
  }

  // Map all inputs to output
  for (let i = 0; i < stemNames.length; i++) {
    args.push('-map', `${i}:a`);
  }

  // Set metadata - copy ALL original ID3 tags
  const id3Tags = metadata.tags || {};

  // Standard ID3 tags to preserve
  const tagMapping = {
    title: metadata.title || id3Tags.title,
    artist: metadata.artist || id3Tags.artist,
    album: id3Tags.album,
    album_artist: id3Tags.album_artist || id3Tags.albumartist,
    composer: id3Tags.composer,
    genre: id3Tags.genre,
    date: id3Tags.date || id3Tags.year,
    track: id3Tags.track || id3Tags.tracknumber,
    disc: id3Tags.disc || id3Tags.discnumber,
    comment: id3Tags.comment,
    copyright: id3Tags.copyright,
    publisher: id3Tags.publisher,
    encoded_by: id3Tags.encoded_by,
    language: id3Tags.language,
    lyrics: id3Tags.lyrics || id3Tags.unsyncedlyrics,
    bpm: id3Tags.bpm || id3Tags.tbpm,
    initialkey: pitch?.detected_key?.key || id3Tags.initialkey || id3Tags.key,
    isrc: id3Tags.isrc,
    barcode: id3Tags.barcode,
    catalog: id3Tags.catalog,
    compilation: id3Tags.compilation,
    grouping: id3Tags.grouping,
  };

  // Add all non-empty tags
  for (const [key, value] of Object.entries(tagMapping)) {
    if (value) {
      args.push('-metadata', `${key}=${value}`);
    }
  }

  // Also pass through any additional ID3 tags we might have missed
  for (const [key, value] of Object.entries(id3Tags)) {
    const lowerKey = key.toLowerCase();
    // Skip if already handled above
    if (!tagMapping[lowerKey] && value) {
      args.push('-metadata', `${key}=${value}`);
    }
  }

  args.push('-metadata', 'encoder=Loukai Creator');

  // Log key if detected
  if (pitch?.detected_key?.key) {
    console.log(`🎵 Writing key to metadata: ${pitch.detected_key.key}`);
  }

  // Copy codecs (stems are already AAC)
  args.push('-c', 'copy');

  // Add stream labels for stems
  for (let i = 0; i < stemNames.length; i++) {
    const stemName = stemNames[i];
    // Use metadata to label streams
    args.push(`-metadata:s:a:${i}`, `title=${stemName}`);
  }

  // Per NI Stems spec: Track 1 (master) should be "enabled"/default,
  // Tracks 2-5 (stems) should be "disabled" so normal players only play master
  args.push('-disposition:a:0', 'default'); // Master track is default
  for (let i = 1; i < stemNames.length; i++) {
    args.push(`-disposition:a:${i}`, '0'); // Clear disposition flags for stem tracks
  }

  // Output format
  args.push('-f', 'mp4');
  args.push('-y'); // Overwrite output
  args.push(outputPath);

  // Run ffmpeg
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run FFmpeg: ${err.message}`));
    });
  });

  // Add NI Stems metadata so Mixxx/Traktor recognize this as a stem file
  // Per NI Stems spec, stems array should have exactly 4 entries (NOT including master)
  // Track order: drums, bass, other, vocals (corresponding to tracks 2-5)
  const stemPartsOnly = stemNames.filter((name) => name !== 'master');
  console.log(
    `🎛️ Writing NI Stems metadata for ${stemPartsOnly.length} stem parts: ${stemPartsOnly.join(', ')}`
  );
  await M4AAtoms.addNiStemsMetadata(outputPath, stemPartsOnly);

  // Verify stem atom was written (debug)
  const { stat } = await import('fs/promises');
  const afterStemSize = (await stat(outputPath)).size;
  console.log(`📊 File size after stem atom: ${afterStemSize} bytes`);

  // Now inject kara atom for karaoke data using m4a-stems library
  await injectKaraokeAtoms(outputPath, {
    lyrics,
    pitch,
    metadata,
    stems: stemNames,
    llmCorrections,
    tags,
  });
}

/**
 * Inject karaoke atoms into an M4A file using m4a-stems library
 *
 * @param {string} filePath - Path to M4A file
 * @param {Object} data - Karaoke data to embed
 */
async function injectKaraokeAtoms(filePath, data) {
  const { lyrics, pitch, metadata, stems, llmCorrections, tags } = data;

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

  // Build kara data structure for m4a-stems
  // Note: Audio sources are read from the NI Stems 'stem' atom, not stored in kara
  const karaData = {
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

  // Write kara atom using m4a-stems library
  console.log(`💾 Writing kara atom: ${lines.length} lines`);
  await M4AAtoms.writeKaraAtom(filePath, karaData);

  // Verify final file size (debug)
  const { stat } = await import('fs/promises');
  const finalSize = (await stat(filePath)).size;
  console.log(`📊 Final file size after kara atom: ${finalSize} bytes`);

  // Note: Vocal pitch tracking is done at runtime, not stored in file.
  // CREPE output is used only for key detection (stored in standard metadata).

  console.log('✅ Karaoke atoms written successfully');
}

/**
 * Inject lyrics into an existing .stem.m4a file
 * Used for "lyrics only" mode when stems already exist
 *
 * @param {Object} options - Injection options
 * @param {string} options.filePath - Path to existing .stem.m4a file
 * @param {Object} options.lyrics - Whisper transcription result with word timestamps
 * @param {Object} options.llmCorrections - LLM correction stats
 * @param {string[]} options.tags - Tags array for filtering
 * @returns {Promise<void>}
 */
export async function injectLyricsIntoStemFile(options) {
  const { filePath, lyrics, llmCorrections, tags } = options;

  console.log(`🎤 Injecting lyrics into existing stem file: ${filePath}`);

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
  console.log(`💾 Writing kara atom: ${lines.length} lines`);
  await M4AAtoms.writeKaraAtom(filePath, karaData);

  console.log('✅ Lyrics injected successfully');
}

/**
 * Repair an existing .stem.m4a file to fix NI Stems metadata
 * This fixes files created before the spec-compliant stem atom was implemented
 *
 * @param {string} filePath - Path to existing .stem.m4a file
 * @param {Object} options - Repair options
 * @param {boolean} options.force - Force rewrite even if metadata exists
 * @returns {Promise<Object>} Repair result
 */
export async function repairStemFile(filePath, options = {}) {
  console.log(`🔧 Checking stem file: ${filePath}`);

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
      console.log(`✅ File already has valid NI Stems metadata: ${existingStems}`);
      console.log('   Use --force to rewrite anyway.');
      return {
        success: true,
        filePath,
        alreadyValid: true,
        existingStems: existingMetadata.stems.map((s) => s.name),
      };
    }

    // Write the stem atom with correct 4-stem metadata
    if (existingMetadata) {
      console.log(`🔄 Force rewriting NI Stems metadata for ${stemPartsOnly.length} stem parts`);
    } else {
      console.log(`🎛️ Adding NI Stems metadata for ${stemPartsOnly.length} stem parts`);
    }
    await M4AAtoms.addNiStemsMetadata(filePath, stemPartsOnly);

    console.log('✅ Stem file repaired successfully');
    console.log('⚠️  Note: Track disposition flags cannot be fixed without re-encoding.');
    console.log('    File should work in Mixxx/Traktor but may play wrong track in some players.');

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
 * @param {string[]} filePaths - Array of paths to .stem.m4a files
 * @param {Object} options - Repair options (passed to each repairStemFile call)
 * @returns {Promise<Object>} Batch repair results
 */
export async function repairStemFiles(filePaths, options = {}) {
  console.log(`🔧 Batch checking ${filePaths.length} stem files...`);

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

  console.log(
    `\n📊 Complete: ${results.alreadyValid} already valid, ${results.repaired} repaired, ${results.failed} failed`
  );
  return results;
}

export default {
  buildStemM4a,
  injectLyricsIntoStemFile,
  repairStemFile,
  repairStemFiles,
};
