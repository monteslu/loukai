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

import { getCacheDir } from '../../main/creator/systemChecker.js';
import { searchLyrics, prepareWhisperContext } from '../../main/creator/lrclibService.js';
import * as llmService from '../../main/creator/llmService.js';
import { getAudioInfo, isVideoFile } from '../../main/creator/audioInfo.js';
import * as creatorJob from '../../main/creator/creatorJob.js';
import { repairStemFile, repairStemFiles } from '../../main/creator/stemBuilder.js';
import { basename, join } from 'path';
import { existsSync, readFileSync, copyFileSync } from 'fs';
import { Atoms as M4AAtoms, StemMp4Writer } from 'stem-mp4';

/**
 * Get creator status. The creator now runs entirely in-browser (WebGPU) — there is no
 * native install step, so this reports only the cache dir and the current save job.
 * @returns {Object} Status info
 */
export function getStatus() {
  return {
    converting: creatorJob.getJob()?.status === 'running',
    cacheDir: getCacheDir(),
    // Rich, observable job descriptor so any admin surface (Electron + every web
    // browser, incl. one opened/refreshed mid-job) can show "already running".
    job: creatorJob.getJob(),
  };
}

/**
 * Search for lyrics
 * @param {string} title - Song title
 * @param {string} artist - Artist name
 * @returns {Promise<Object>} Lyrics result
 */
// Coerce any caller's title/artist to a safe string. music-metadata (and stray
// payloads) can pass an OBJECT, which would become "[object Object]" in the LRCLIB
// query → matches the wrong song. Accept string/number/array; objects/null → ''.
function safeStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(safeStr).filter(Boolean).join(', ');
  return ''; // object/other → not a usable string
}

export async function findLyrics(title, artist) {
  try {
    const result = await searchLyrics(safeStr(title), safeStr(artist));
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
    const result = await prepareWhisperContext(safeStr(title), safeStr(artist), existingLyrics);
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
 * Repair a stem file to fix NI Stems metadata
 * @param {string} filePath - Path to .stem.mp4 file
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
 * @param {string[]} filePaths - Array of paths to .stem.mp4 files
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

/**
 * Save a WebGPU-Creator result (separated + transcribed in-browser) as a NI-Stems
 * .stem.mp4 in the songs library, using the stem-mp4 lib's StemMp4Writer — it takes
 * WAV files directly and does AAC encode + 5-track mux + kara atom internally
 * (master + 4 stems). No Python; same format as the native creator.
 *
 * @param {Object} opts
 *   stems: { master, drums, bass, other, vocals } → WAV file paths
 *     (master = the RAW original mix, NOT a sum of stems)
 *   metadata: { title, artist, duration }
 *   lyrics: { lines:[{start,end,text}], words:[{start,end,text}] }
 *   songsFolder: output directory (the library)
 * @returns {Promise<{outputPath, fileName}>}
 */
export async function saveWebGpuStems({
  stems,
  metadata,
  lyrics,
  chords,
  pitch,
  referenceLyrics,
  settingsManager,
  songsFolder,
  source = null,
  // When false, the CALLER already owns the creatorJob lifecycle (e.g. the host-create
  // relay, where the job spans compute+save). We then skip the busy-check, startJob and
  // finishJob here, but still report save sub-step progress into the existing job.
  manageJob = true,
}) {
  if (!songsFolder) throw new Error('songs folder is not set');
  const {
    title = 'Untitled',
    artist = 'Unknown',
    album,
    key,
    year,
    genre,
    track,
    disk,
    albumartist,
    composer,
    tempo,
  } = metadata || {};

  // Single-job contract: there is exactly ONE conversion at a time per Loukai
  // process. Reject (don't queue) when one is already running so a second surface
  // (another web admin, or the player) can't kick off a parallel save. The thrown
  // shape carries `busy` + the live job so callers can return a 409 / structured
  // "already running" instead of an opaque error.
  if (manageJob && creatorJob.isRunning()) {
    const err = new Error('A creation is already in progress');
    err.busy = true;
    err.job = creatorJob.getJob();
    throw err;
  }

  const safeFileName = (artist ? `${artist} - ${title}` : title).replace(/[<>:"/\\|?*]/g, '_');
  const outputPath = join(songsFolder, `${safeFileName}.stem.mp4`);

  // Begin the observable job (broadcast to every admin surface via creatorJob.onChange).
  // The browser already did separation/transcription; the backend's job is the SAVE:
  // LLM-correct → mux → write key/pitch. Steps mirror that. Skipped when the caller
  // owns the job (manageJob:false) — e.g. host-create, where the job spans compute too.
  if (manageJob) {
    creatorJob.startJob({
      title,
      artist,
      source,
      startedAt: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
    });
  }
  try {
    // --- LLM lyric correction, server-side ---
    // The renderer sends the RAW transcription; correction happens HERE on the backend,
    // not in the web UI — same code path, same settings resolution as the Python creator.
    let llmStats = null;
    let lyricsData = lyrics && lyrics.lines ? { lines: lyrics.lines } : null;
    if (settingsManager && lyricsData?.lines?.length) {
      // Only drive the bar here when WE own the job. When the caller owns it
      // (manageJob:false, e.g. host-create), it drives its own coarse progress and
      // these lower values would make the bar jump backward.
      if (manageJob) creatorJob.updateProgress({ step: 'correcting', progress: 10 });
      try {
        // Use the provided reference lyrics, else look up LRCLIB (in-flow, like native).
        let ref = (referenceLyrics || '').trim();
        if (!ref) {
          const r = await searchLyrics(title, artist);
          ref = (r?.plainLyrics || '').trim();
        }
        if (ref) {
          const llmSettings = llmService.getLLMSettingsRaw(settingsManager);
          const hasValidConfig = llmSettings.provider === 'lmstudio' || llmSettings.apiKey;
          if (llmSettings.enabled && hasValidConfig) {
            const llmResult = await llmService.correctLyrics(
              { lines: lyricsData.lines, words: lyrics.words },
              ref,
              llmSettings
            );
            if (llmResult?.output?.lines?.length) {
              lyricsData = { lines: llmResult.output.lines };
              llmStats = llmResult.stats;
            }
          } else {
            console.log('🤖 LLM not enabled/configured — skipping correction');
          }
        }
      } catch (e) {
        console.warn('⚠️ LLM correction failed, using original transcription:', e.message);
      }
    }

    // Pass the FULL tag set through so the output preserves what the source had
    // (parity with the native creator: year/genre/track/album-artist/composer/tempo).
    const fullMeta = { title, artist };
    if (album) fullMeta.album = album;
    if (year) fullMeta.year = year;
    if (genre) fullMeta.genre = genre;
    if (track) fullMeta.track = track;
    if (disk) fullMeta.disk = disk;
    if (albumartist) fullMeta.albumartist = albumartist;
    if (composer) fullMeta.composer = composer;
    if (tempo) fullMeta.tempo = tempo;

    // The renderer already encoded each stem to AAC-in-MP4 (ffmpeg-wasm); `stems.*`
    // are temp-file paths to those .m4a blobs. stem-mp4 0.5.x is a pure-JS container
    // muxer that takes PRE-ENCODED AAC (no ffmpeg), so read the bytes and pass them.
    if (manageJob) creatorJob.updateProgress({ step: 'muxing', progress: 60 });
    const readAac = (p) => readFileSync(p);
    await StemMp4Writer.write({
      outputPath,
      stemsAac: {
        drums: readAac(stems.drums),
        bass: readAac(stems.bass),
        other: readAac(stems.other),
        vocals: readAac(stems.vocals),
      },
      mixdownAac: readAac(stems.master), // raw original mix = NI-Stems master track
      metadata: fullMeta,
      lyricsData: lyricsData || undefined, // corrected lines if LLM ran, else raw
      encoderDelaySamples: 1024, // ffmpeg native aac priming (renderer used -c:a aac)
    });

    // CREPE-derived musical key + pitch track (parity with the native creator). Both
    // best-effort — a failure here must not lose the otherwise-good file.
    // Chord track (#93): the muxer only writes known kara fields, so merge the
    // chords into the kara atom after the fact (best-effort, like key/pitch).
    if (chords && chords.length > 0) {
      try {
        const kara = await M4AAtoms.readKaraAtom(outputPath);
        await M4AAtoms.writeKaraAtom(outputPath, { ...kara, chords });
      } catch (e) {
        console.warn('chord track write failed:', e.message);
      }
    }

    if (key) {
      try {
        await M4AAtoms.addMusicalKey(outputPath, key);
      } catch (e) {
        console.warn('addMusicalKey failed:', e.message);
      }
    }
    if (pitch && pitch.data?.length) {
      try {
        await M4AAtoms.writeVpchAtom(outputPath, pitch);
      } catch (e) {
        console.warn('writeVpchAtom failed:', e.message);
      }
    }
    if (manageJob) {
      creatorJob.finishJob('complete', {
        outputPath,
        finishedAt: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
      });
    }
    return { outputPath, fileName: basename(outputPath), llmStats };
  } catch (e) {
    if (manageJob) {
      creatorJob.finishJob('error', {
        error: e.message,
        finishedAt: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
      });
    }
    throw e;
  }
}

/**
 * Lyrics-only update: rewrite the kara (lyrics) atom — and optionally the musical
 * key — on an EXISTING .stem.mp4, without re-separating or re-encoding the audio.
 * Used by the WebGPU creator's lyrics-only mode (re-transcribe an existing file).
 * The stems/audio are untouched; only the lyrics+key atoms change.
 * @param {Object} opts
 * @param {string} opts.inputPath - path to the existing .stem.mp4
 * @param {{lines:Array}} opts.lyrics
 * @param {string} [opts.key]
 * @param {Object} [opts.pitch]
 * @returns {Promise<{outputPath, fileName}>}
 */
export async function updateStemLyrics({ inputPath, lyrics, key, pitch }) {
  if (!inputPath || !existsSync(inputPath)) throw new Error('stem file not found');
  // Edit in place — the file is already in the library.
  if (lyrics && lyrics.lines) {
    // MERGE with the existing kara atom: writing { lines } alone silently
    // destroyed timing, singers, tags, and the chord track for any file this
    // path touched (import + lyrics-correction).
    let existing = {};
    try {
      existing = (await M4AAtoms.readKaraAtom(inputPath)) || {};
    } catch {
      /* no kara atom yet */
    }
    await M4AAtoms.writeKaraAtom(inputPath, { ...existing, lines: lyrics.lines });
  }
  if (key) {
    try {
      await M4AAtoms.addMusicalKey(inputPath, key);
    } catch (e) {
      console.warn('addMusicalKey failed:', e.message);
    }
  }
  if (pitch && pitch.data?.length) {
    try {
      await M4AAtoms.writeVpchAtom(inputPath, pitch);
    } catch (e) {
      console.warn('writeVpchAtom failed:', e.message);
    }
  }
  return { outputPath: inputPath, fileName: basename(inputPath) };
}

/**
 * Import an already-created .stem.mp4 (e.g. from the offsite WebGPU creator) into
 * the library. Validates it has karaoke metadata, copies it into the songs folder,
 * and — when `correctLyrics` is set — runs LRCLIB lookup + LLM correction on its
 * existing lyrics and rewrites the kara atom. The audio/stems are never touched.
 *
 * @param {Object} opts
 * @param {string} opts.tmpPath - path to the uploaded temp file
 * @param {string} [opts.originalName] - the upload's original filename (for the saved name)
 * @param {boolean} [opts.correctLyrics=true] - look up reference lyrics + LLM-correct
 * @param {Object} opts.settingsManager - for LLM settings + songs folder
 * @param {string} opts.songsFolder
 * @returns {Promise<{success, fileName, outputPath, hadKaraoke, corrected, llmStats}>}
 */
export async function importStemFile({
  tmpPath,
  originalName,
  correctLyrics = true,
  settingsManager,
  songsFolder,
}) {
  if (!songsFolder) throw new Error('songs folder is not set');
  if (!tmpPath || !existsSync(tmpPath)) throw new Error('uploaded file not found');

  // 1) Validate it's a real karaoke stem file: must parse + have a kara atom.
  let audioInfo;
  try {
    audioInfo = await getAudioInfo(tmpPath);
  } catch (e) {
    throw new Error(`not a readable MP4: ${e.message}`);
  }
  if (!audioInfo.audioStreamCount || audioInfo.audioStreamCount < 2) {
    throw new Error('not a stem file (needs multiple audio tracks: master + stems)');
  }
  let kara = null;
  try {
    kara = await M4AAtoms.readKaraAtom(tmpPath);
  } catch {
    /* no kara atom */
  }
  const hadKaraoke = Boolean(kara && Array.isArray(kara.lines) && kara.lines.length);
  if (!hadKaraoke) {
    throw new Error('file has no karaoke metadata (kara atom) — not a Loukai stem file');
  }

  // 2) Copy into the songs folder with a clean filename derived from tags.
  const title = (audioInfo.title || '').trim();
  const artist = (audioInfo.artist || '').trim();
  const base =
    (artist && title ? `${artist} - ${title}` : title) ||
    (originalName || 'imported').replace(/\.(stem\.)?mp4$/i, '');
  const safe = base.replace(/[<>:"/\\|?*]/g, '_');
  const outputPath = join(songsFolder, `${safe}.stem.mp4`);
  copyFileSync(tmpPath, outputPath);

  // 3) Optional: LRCLIB lookup + LLM correction on the existing lyrics, rewrite kara.
  let corrected = false;
  let llmStats = null;
  if (correctLyrics && settingsManager && title) {
    try {
      const r = await searchLyrics(title, artist);
      const ref = (r?.plainLyrics || '').trim();
      if (ref) {
        const llmSettings = llmService.getLLMSettingsRaw(settingsManager);
        const hasValidConfig = llmSettings.provider === 'lmstudio' || llmSettings.apiKey;
        if (llmSettings.enabled && hasValidConfig) {
          const llmResult = await llmService.correctLyrics(
            { lines: kara.lines, words: kara.words },
            ref,
            llmSettings
          );
          if (llmResult?.output?.lines?.length) {
            await M4AAtoms.writeKaraAtom(outputPath, { lines: llmResult.output.lines });
            llmStats = llmResult.stats;
            corrected = true;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ import lyric correction failed, kept original:', e.message);
    }
  }

  return {
    success: true,
    fileName: basename(outputPath),
    outputPath,
    hadKaraoke,
    corrected,
    llmStats,
  };
}

export default {
  getStatus,
  saveWebGpuStems,
  updateStemLyrics,
  importStemFile,
  findLyrics,
  getWhisperContext,
  getFileInfo,
  repairStem,
  repairStems,
};
