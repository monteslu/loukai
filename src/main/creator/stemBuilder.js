/**
 * Stem Builder - Creates .stem.m4a files with embedded stem data
 *
 * The .stem.m4a format embeds multiple audio stems in a single M4A container
 * using custom atoms/boxes. This is compatible with Native Instruments Stems.
 *
 * Structure:
 * - ftyp (file type)
 * - moov (movie header with metadata)
 * - mdat (media data with stems)
 * - stem (custom atom with stem mapping)
 * - kaid (custom atom with karaoke ID data)
 * - kons (custom atom with onset/lyrics data)
 * - vpch (custom atom with vocal pitch data)
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
  const lines = [];
  if (lyrics && lyrics.lines && lyrics.lines.length > 0) {
    for (const line of lyrics.lines) {
      lines.push({
        start: line.start,
        end: line.end,
        text: line.text,
      });
    }
  }

  // Build audio sources from stems (NI Stems format: master + 4 stems = 5 tracks)
  const audioSources = stems.map((stemName, index) => ({
    id: stemName,
    role: stemName === 'master' ? 'master' : stemName,
    track: index,
  }));

  // Build kara data structure for m4a-stems
  const karaData = {
    // Audio configuration
    audio: {
      sources: audioSources,
      profile: 'STEMS-4', // NI Stems format (master + 4 stems)
      encoder_delay_samples: 0,
      presets: [],
    },

    // Timing information
    timing: {
      offset_sec: 0,
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
  console.log(`💾 Writing kara atom: ${lines.length} lines, ${audioSources.length} stems`);
  await M4AAtoms.writeKaraAtom(filePath, karaData);

  // Write vocal pitch atom if we have pitch data
  if (pitch && pitch.pitch_data) {
    // Convert CREPE format to m4a-stems format
    const crepeData = pitch.pitch_data;
    const pitchSampleRate = crepeData.sample_rate / crepeData.hop_length; // samples per second of pitch data

    const vpchData = {
      sampleRate: Math.round(pitchSampleRate),
      data: crepeData.midi.map((midiFloat) => {
        if (midiFloat === 0) {
          return { midi: 0, cents: 0 }; // Unvoiced
        }
        const midiInt = Math.floor(midiFloat);
        const cents = Math.round((midiFloat - midiInt) * 100);
        return { midi: midiInt, cents };
      }),
    };

    console.log(
      `🎵 Writing vocal pitch atom: ${vpchData.data.length} frames at ${vpchData.sampleRate}Hz`
    );
    await M4AAtoms.writeVpchAtom(filePath, vpchData);
  }

  // Write onsets atom if we have word timestamps
  if (lyrics && lyrics.words && lyrics.words.length > 0) {
    // Convert words to onset format (just start times)
    const onsets = lyrics.words
      .map((w) => w.start)
      .filter((t) => t > 0)
      .sort((a, b) => a - b);

    if (onsets.length > 0) {
      console.log(`🎯 Writing onsets atom: ${onsets.length} onsets`);
      await M4AAtoms.writeKonsAtom(filePath, onsets);
    }
  }

  console.log('✅ Karaoke atoms written successfully');
}

/**
 * Inject lyrics into an existing .stem.m4a file
 * Used for "lyrics only" mode when stems already exist
 *
 * @param {Object} options - Injection options
 * @param {string} options.filePath - Path to existing .stem.m4a file
 * @param {Object} options.lyrics - Whisper transcription result with word timestamps
 * @param {Object} options.pitch - CREPE pitch detection result
 * @param {Object} options.llmCorrections - LLM correction stats
 * @param {string[]} options.tags - Tags array for filtering
 * @returns {Promise<void>}
 */
export async function injectLyricsIntoStemFile(options) {
  const { filePath, lyrics, pitch, llmCorrections, tags } = options;

  console.log(`🎤 Injecting lyrics into existing stem file: ${filePath}`);

  // Read existing kara atom to preserve audio configuration
  let existingKara = null;
  try {
    existingKara = await M4AAtoms.readKaraAtom(filePath);
  } catch {
    // No existing kara atom - that's fine
  }

  // Build kara data structure
  const lines = [];
  if (lyrics && lyrics.lines && lyrics.lines.length > 0) {
    for (const line of lyrics.lines) {
      lines.push({
        start: line.start,
        end: line.end,
        text: line.text,
      });
    }
  }

  // Preserve existing audio configuration or create default
  const audioSources = existingKara?.audio?.sources || [
    { id: 'master', role: 'master', track: 0 },
    { id: 'drums', role: 'drums', track: 1 },
    { id: 'bass', role: 'bass', track: 2 },
    { id: 'other', role: 'other', track: 3 },
    { id: 'vocals', role: 'vocals', track: 4 },
  ];

  const karaData = {
    audio: {
      sources: audioSources,
      profile: existingKara?.audio?.profile || 'STEMS-4',
      encoder_delay_samples: existingKara?.audio?.encoder_delay_samples || 0,
      presets: existingKara?.audio?.presets || [],
    },
    timing: {
      offset_sec: existingKara?.timing?.offset_sec || 0,
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

  // Write vocal pitch atom if we have pitch data
  if (pitch && pitch.pitch_data) {
    const crepeData = pitch.pitch_data;
    const pitchSampleRate = crepeData.sample_rate / crepeData.hop_length;

    const vpchData = {
      sampleRate: Math.round(pitchSampleRate),
      data: crepeData.midi.map((midiFloat) => {
        if (midiFloat === 0) {
          return { midi: 0, cents: 0 };
        }
        const midiInt = Math.floor(midiFloat);
        const cents = Math.round((midiFloat - midiInt) * 100);
        return { midi: midiInt, cents };
      }),
    };

    console.log(
      `🎵 Writing vocal pitch atom: ${vpchData.data.length} frames at ${vpchData.sampleRate}Hz`
    );
    await M4AAtoms.writeVpchAtom(filePath, vpchData);
  }

  // Write onsets atom if we have word timestamps
  if (lyrics && lyrics.words && lyrics.words.length > 0) {
    const onsets = lyrics.words
      .map((w) => w.start)
      .filter((t) => t > 0)
      .sort((a, b) => a - b);

    if (onsets.length > 0) {
      console.log(`🎯 Writing onsets atom: ${onsets.length} onsets`);
      await M4AAtoms.writeKonsAtom(filePath, onsets);
    }
  }

  console.log('✅ Lyrics injected successfully');
}

/**
 * Repair an existing .stem.m4a file to fix NI Stems metadata
 * This fixes files created before the spec-compliant stem atom was implemented
 *
 * @param {string} filePath - Path to existing .stem.m4a file
 * @returns {Promise<Object>} Repair result
 */
export async function repairStemFile(filePath) {
  console.log(`🔧 Repairing stem file: ${filePath}`);

  // Default NI Stems order (excluding master, which is track 0)
  const stemPartsOnly = ['drums', 'bass', 'other', 'vocals'];

  try {
    // Re-write the stem atom with correct 4-stem metadata
    console.log(`🎛️ Writing corrected NI Stems metadata for ${stemPartsOnly.length} stem parts`);
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
 * @returns {Promise<Object>} Batch repair results
 */
export async function repairStemFiles(filePaths) {
  console.log(`🔧 Batch repairing ${filePaths.length} stem files...`);

  const results = {
    total: filePaths.length,
    success: 0,
    failed: 0,
    files: [],
  };

  for (const filePath of filePaths) {
    const result = await repairStemFile(filePath);
    results.files.push(result);
    if (result.success) {
      results.success++;
    } else {
      results.failed++;
    }
  }

  console.log(`\n📊 Repair complete: ${results.success}/${results.total} files fixed`);
  return results;
}

export default {
  buildStemM4a,
  injectLyricsIntoStemFile,
  repairStemFile,
  repairStemFiles,
};
