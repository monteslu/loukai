/**
 * Editor Service - Shared business logic for song editing
 *
 * Used by both IPC handlers (Electron) and REST endpoints (Web Server)
 * to ensure consistent song editing behavior across all interfaces.
 */

import M4ALoader from '../../utils/m4aLoader.js';
import { Atoms } from 'stem-mp4';
import { STEM_MP4_FORMAT, isStemMp4Format } from '../formatUtils.js';

/**
 * Load a song for editing
 * @param {string} path - Path to the song file
 * @returns {Promise<Object>} Song data ready for editing
 */
export async function loadSong(path) {
  if (!path) {
    throw new Error('Path is required');
  }

  const lowerPath = path.toLowerCase();

  // M4A/MP4 stems format is the only supported format for editing
  if (lowerPath.endsWith('.m4a') || lowerPath.endsWith('.mp4')) {
    const m4aData = await M4ALoader.load(path);
    m4aData.originalFilePath = path;
    return {
      format: STEM_MP4_FORMAT,
      kaiData: m4aData, // Named kaiData for compatibility with existing editor components
    };
  } else {
    // CDG and other formats are not supported for editing
    throw new Error('Only Stem MP4 format is supported for editing');
  }
}

/**
 * Save song edits
 * @param {string} path - Path to the song file
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Save result
 */
export async function saveSong(path, updates) {
  if (!path) {
    throw new Error('Path is required');
  }

  const { format, metadata, lyrics } = updates;

  if (isStemMp4Format(format)) {
    // Handle Stem MP4 format
    return await saveM4ASong(path, { metadata, lyrics });
  } else {
    throw new Error(`Unsupported format: ${format}. Only stem-mp4 format is supported.`);
  }
}

/**
 * Save M4A song edits
 *
 * PERFORMANCE (issue #67): this used to call M4ALoader.load(), which reads the whole
 * file AND extracts every audio track into memory (hundreds of MB of Buffer churn for
 * a full-length .stem.mp4), then did THREE separate whole-file read-modify-write passes
 * (kara atom, standard metadata, musical key). On big files that froze the entire app
 * (main process event loop + GC pressure) for seconds to minutes AFTER the save toast.
 * Now: ONE file read, all atom edits chained on the in-memory buffer, ONE file write.
 * Everything the merge needs (lyrics/timing/singers/meta/tags) lives in the kara atom;
 * standard metadata comes from music-metadata without touching the audio tracks.
 *
 * @param {string} path - Path to M4A file
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Save result
 */
async function saveM4ASong(path, updates) {
  const { metadata, lyrics } = updates;
  const fs = await import('fs/promises');
  const pathMod = await import('path');

  // ONE full-file read; every atom operation below works on this buffer.
  const fileBuffer = new Uint8Array(await fs.readFile(path));

  // Existing karaoke data (lyrics, timing, singers, tags, corrections meta).
  let existingKara = null;
  try {
    existingKara = Atoms.readKaraAtomBuffer(fileBuffer);
  } catch {
    /* no kara atom yet */
  }
  if (!existingKara) existingKara = { lines: [], singers: [] };

  // Existing standard metadata (no audio decode - music-metadata parses atoms only).
  const mm = await import('music-metadata');
  let mmData = { common: {}, native: {} };
  try {
    mmData = await mm.parseBuffer(fileBuffer, { mimeType: 'audio/mp4' });
  } catch {
    /* fall back to update values below */
  }
  // Musical key lives in the iTunes initialkey freeform atom (same as M4ALoader).
  let existingKey = 'C';
  const keyAtom = mmData.native?.iTunes?.find(
    (tag) => tag.id === '----:com.apple.iTunes:initialkey'
  );
  if (keyAtom && keyAtom.value) {
    existingKey =
      typeof keyAtom.value === 'string'
        ? keyAtom.value.trim()
        : Buffer.isBuffer(keyAtom.value)
          ? keyAtom.value.toString('utf-8').trim()
          : String(keyAtom.value).trim();
  }

  // Merge metadata updates over the existing values (same field semantics as before).
  const updatedMetadata = {
    title: mmData.common?.title || pathMod.basename(path, pathMod.extname(path)),
    artist: mmData.common?.artist || '',
    album: mmData.common?.album || '',
    year: mmData.common?.year || null,
    genre: mmData.common?.genre ? mmData.common.genre[0] : '',
    key: existingKey,
    tempo: existingKara.meter?.bpm || 120,
  };
  if (metadata.title !== undefined) updatedMetadata.title = metadata.title;
  if (metadata.artist !== undefined) updatedMetadata.artist = metadata.artist;
  if (metadata.album !== undefined) updatedMetadata.album = metadata.album;
  if (metadata.year !== undefined) updatedMetadata.year = metadata.year;
  if (metadata.genre !== undefined) updatedMetadata.genre = metadata.genre;
  if (metadata.key !== undefined) updatedMetadata.key = metadata.key;

  // Use updated lyrics array; fall back to the file's existing lines.
  let updatedLyrics = existingKara.lines || [];
  if (lyrics !== undefined && Array.isArray(lyrics)) {
    updatedLyrics = lyrics;
  }

  // Prepare data to save (shapes match what the kara build below consumes).
  const dataToSave = {
    metadata: updatedMetadata,
    lyrics: updatedLyrics,
    audio: {
      timing: {
        offsetSec: existingKara.timing?.offset_sec || 0,
        encoderDelaySamples: existingKara.timing?.encoder_delay_samples || 0,
      },
    },
    features: { tempo: existingKara.meter || null },
    singers: existingKara.singers || [],
    meta: existingKara.meta?.corrections ? { corrections: existingKara.meta.corrections } : {},
    tags: existingKara.tags || [],
  };

  // Add 'edited' tag if not already present
  if (!dataToSave.tags.includes('edited')) {
    dataToSave.tags = [...dataToSave.tags, 'edited'];
  }

  // Handle AI corrections metadata (rejections/suggestions) if present
  if (metadata.rejections !== undefined || metadata.suggestions !== undefined) {
    const updatedMeta = { ...(dataToSave.meta || {}) };

    if (!updatedMeta.corrections) {
      updatedMeta.corrections = {};
    }

    if (metadata.rejections !== undefined) {
      updatedMeta.corrections.rejected = metadata.rejections.map((r) => ({
        line: r.line_num,
        start: r.start_time,
        end: r.end_time,
        old: r.old_text,
        new: r.new_text,
        reason: r.reason,
        word_retention: r.retention_rate,
      }));
    }

    if (metadata.suggestions !== undefined) {
      updatedMeta.corrections.missing_lines_suggested = metadata.suggestions.map((s) => ({
        suggested_text: s.suggested_text,
        start: s.start_time,
        end: s.end_time,
        confidence: s.confidence,
        reason: s.reason,
        pitch_activity: s.pitch_activity,
      }));
    }

    dataToSave.meta = updatedMeta;
  }

  // Prepare kara data structure for stem-mp4
  // Note: Audio sources are read from the NI Stems 'stem' atom, not stored in kara
  const karaData = {
    // Timing information
    timing: {
      offset_sec: dataToSave.audio?.timing?.offsetSec || 0,
      encoder_delay_samples: dataToSave.audio?.timing?.encoderDelaySamples || 0,
    },

    // Tags for filtering (e.g., 'edited', 'ai_corrected')
    tags: dataToSave.tags || [],

    // Chord track (#93): pass through so an editor save never strips it
    ...(((dataToSave.chords ?? existingKara?.chords)?.length ?? 0) > 0 && {
      chords: dataToSave.chords ?? existingKara.chords,
    }),

    // Lyrics (lines) - preserves word-level timing if present
    lines: (dataToSave.lyrics || []).map((line) => ({
      start: line.start || line.startTimeSec || 0,
      end: line.end || line.endTimeSec || 0,
      text: line.text || '',
      ...(line.disabled && { disabled: true }),
      ...(line.singer && { singer: line.singer }),
      ...(line.words && { words: line.words }),
    })),

    // Optional: tempo/meter data
    ...(dataToSave.features?.tempo && {
      meter: dataToSave.features.tempo,
    }),

    // Optional: singers
    ...(dataToSave.singers &&
      dataToSave.singers.length > 0 && {
        singers: dataToSave.singers,
      }),

    // Optional: corrections metadata
    ...(dataToSave.meta?.corrections && {
      meta: { corrections: dataToSave.meta.corrections },
    }),
  };

  // Save using stem-mp4: chain every atom edit on the in-memory buffer, then write
  // the file ONCE (the path-based Atoms.* each re-read + re-write the whole file).
  console.log('💾 Saving M4A kara atom:', path);
  console.log('📝 kara data prepared:', {
    lyricsCount: karaData.lines?.length || 0,
    tagsCount: karaData.tags?.length || 0,
  });

  let outBuffer = Atoms.writeKaraAtomBuffer(fileBuffer, karaData);

  // Standard MP4 metadata atoms (title, artist, album, year, genre, BPM)
  const standardMetadata = {
    title: updatedMetadata.title,
    artist: updatedMetadata.artist,
    album: updatedMetadata.album,
    year: updatedMetadata.year,
    genre: updatedMetadata.genre,
    tempo: updatedMetadata.tempo,
  };
  outBuffer = Atoms.addStandardMetadataBuffer(outBuffer, standardMetadata);

  // Musical key if changed (separate atom for DJ software)
  if (metadata.key !== undefined && updatedMetadata.key) {
    console.log(`🎹 Writing musical key: ${updatedMetadata.key}`);
    outBuffer = Atoms.addMusicalKeyBuffer(outBuffer, updatedMetadata.key);
  }

  // Atoms not explicitly rewritten above are inherently preserved: the buffer
  // transforms rebuild only their target atoms and copy everything else through.
  await fs.writeFile(path, outBuffer);

  console.log('✅ M4A file saved successfully');

  return { success: true };
}
