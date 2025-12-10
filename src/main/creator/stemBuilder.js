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
 * @returns {Promise<void>}
 */
export async function buildStemM4a(options) {
  const { outputPath, stems, metadata, lyrics, pitch, llmCorrections } = options;

  // For now, use ffmpeg to mux stems into a single file
  // The stem.m4a format requires custom atom injection
  // We'll use the first stem as the main track and embed others as metadata

  const ffmpegPath = getFFmpegPath();

  // Build ffmpeg command to combine stems
  // Using -map to include multiple audio streams
  const args = [];

  // Add input files
  const stemNames = Object.keys(stems);
  for (const name of stemNames) {
    args.push('-i', stems[name]);
  }

  // Map all inputs to output
  for (let i = 0; i < stemNames.length; i++) {
    args.push('-map', `${i}:a`);
  }

  // Set metadata - copy ALL original tags
  const tags = metadata.tags || {};

  // Standard ID3 tags to preserve
  const tagMapping = {
    title: metadata.title || tags.title,
    artist: metadata.artist || tags.artist,
    album: tags.album,
    album_artist: tags.album_artist || tags.albumartist,
    composer: tags.composer,
    genre: tags.genre,
    date: tags.date || tags.year,
    track: tags.track || tags.tracknumber,
    disc: tags.disc || tags.discnumber,
    comment: tags.comment,
    copyright: tags.copyright,
    publisher: tags.publisher,
    encoded_by: tags.encoded_by,
    language: tags.language,
    lyrics: tags.lyrics || tags.unsyncedlyrics,
    bpm: tags.bpm || tags.tbpm,
    isrc: tags.isrc,
    barcode: tags.barcode,
    catalog: tags.catalog,
    compilation: tags.compilation,
    grouping: tags.grouping,
  };

  // Add all non-empty tags
  for (const [key, value] of Object.entries(tagMapping)) {
    if (value) {
      args.push('-metadata', `${key}=${value}`);
    }
  }

  // Also pass through any additional tags we might have missed
  for (const [key, value] of Object.entries(tags)) {
    const lowerKey = key.toLowerCase();
    // Skip if already handled above
    if (!tagMapping[lowerKey] && value) {
      args.push('-metadata', `${key}=${value}`);
    }
  }

  args.push('-metadata', 'encoder=Loukai Creator');

  // Copy codecs (stems are already AAC)
  args.push('-c', 'copy');

  // Add stream labels for stems
  for (let i = 0; i < stemNames.length; i++) {
    const stemName = stemNames[i];
    // Use metadata to label streams
    args.push(`-metadata:s:a:${i}`, `title=${stemName}`);
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

  // Now inject kara atom for karaoke data using m4a-stems library
  await injectKaraokeAtoms(outputPath, {
    lyrics,
    pitch,
    metadata,
    stems: stemNames,
    llmCorrections,
  });
}

/**
 * Inject karaoke atoms into an M4A file using m4a-stems library
 *
 * @param {string} filePath - Path to M4A file
 * @param {Object} data - Karaoke data to embed
 */
async function injectKaraokeAtoms(filePath, data) {
  const { lyrics, pitch, metadata, stems, llmCorrections } = data;

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

  // Build audio sources from stems
  const audioSources = stems.map((stemName, index) => ({
    id: stemName,
    role: stemName,
    track: index,
  }));

  // Build kara data structure for m4a-stems
  const karaData = {
    // Audio configuration
    audio: {
      sources: audioSources,
      profile: stems.length === 4 ? 'STEMS-4' : 'STEMS-2',
      encoder_delay_samples: 0,
      presets: [],
    },

    // Timing information
    timing: {
      offset_sec: 0,
    },

    // Lyrics (lines)
    lines: lines,
  };

  // Add LLM corrections metadata if available
  if (
    llmCorrections &&
    (llmCorrections.corrections?.length > 0 || llmCorrections.missing_lines?.length > 0)
  ) {
    karaData.meta = {
      llm_corrections: {
        provider: llmCorrections.provider,
        model: llmCorrections.model,
        corrections: llmCorrections.corrections || [],
        missing_lines: llmCorrections.missing_lines || [],
        corrections_applied: llmCorrections.corrections_applied || 0,
        missing_lines_suggested: llmCorrections.missing_lines_suggested || 0,
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

export default {
  buildStemM4a,
};
