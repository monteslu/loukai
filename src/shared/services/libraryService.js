/**
 * Library Service - Shared business logic for library management
 *
 * Used by both IPC handlers (Electron) and REST endpoints (Web Server)
 * to ensure consistent library behavior across all interfaces.
 */

import Fuse from 'fuse.js';
import { STEM_MP4_FORMAT, isStemMp4Format } from '../formatUtils.js';

/**
 * THE single song-search configuration for the whole app (desktop IPC + web + phone).
 * Tuned so users actually find things: typo-tolerant, field-weighted (title > artist >
 * album), order-independent across words. Previously the desktop used a literal substring
 * filter while the web server had its own Fuse config — two behaviors, one of them dumb.
 * Now everything calls searchSongs() below.
 */
const FUSE_OPTIONS = {
  // Weighted so a title hit outranks an artist/album hit (matches user expectation +
  // the existing test: "queen" → "Dancing Queen" before "Bohemian Rhapsody").
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'artist', weight: 0.25 },
    { name: 'album', weight: 0.05 },
  ],
  threshold: 0.3, // 0.4 matched ~all of a 9.5k library on 3-char queries (pure noise)
  ignoreLocation: true, // match anywhere in the field, not just the start
  includeScore: true,
  minMatchCharLength: 2,
  useExtendedSearch: false,
};

// Module-level Fuse index, rebuilt only when the underlying song array actually changes
// (reference or length). Building a Fuse index over a large library isn't free, so we
// don't want to do it on every keystroke.
let _fuse = null;
let _fuseSource = null;
let _fuseLength = -1;

/** Get (or lazily build) the shared Fuse index for a song list. Exported so the web
 *  server can invalidate it when the library refreshes. */
export function getSongSearchIndex(songs) {
  if (_fuse && _fuseSource === songs && _fuseLength === songs.length) {
    return _fuse;
  }
  _fuse = new Fuse(songs, FUSE_OPTIONS);
  _fuseSource = songs;
  _fuseLength = songs.length;
  return _fuse;
}

/** Drop the cached index (call when songs are added/removed/edited). */
export function resetSongSearchIndex() {
  _fuse = null;
  _fuseSource = null;
  _fuseLength = -1;
}

/**
 * Get the current songs folder path
 * @param {Object} mainApp - Main application instance with settings
 * @returns {Object} Result with success status and folder path
 */
export function getSongsFolder(mainApp) {
  try {
    const folder = mainApp.settings?.getSongsFolder?.();
    return {
      success: true,
      folder: folder || null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get cached library songs
 * @param {Object} mainApp - Main application instance
 * @returns {Object} Result with success status and cached files
 */
export function getCachedSongs(mainApp) {
  if (mainApp.cachedLibrary) {
    return {
      success: true,
      files: mainApp.cachedLibrary,
      cached: true,
    };
  }

  return {
    success: true,
    files: [],
    cached: false,
  };
}

/**
 * Get library songs (from cache or by scanning)
 * @param {Object} mainApp - Main application instance
 * @returns {Promise<Object>} Result with success status and songs array
 */
export async function getLibrarySongs(mainApp) {
  try {
    // Return cached library if available
    if (mainApp.cachedLibrary && mainApp.cachedLibrary.length > 0) {
      return {
        success: true,
        songs: mainApp.cachedLibrary,
        fromCache: true,
      };
    }

    // Otherwise scan
    const songsFolder = mainApp.settings?.getSongsFolder?.();
    if (!songsFolder) {
      return {
        success: false,
        error: 'Songs folder not set',
        songs: [],
      };
    }

    const files = await mainApp.scanForKaiFiles(songsFolder);

    return {
      success: true,
      songs: files,
      fromCache: false,
    };
  } catch (error) {
    console.error('Error getting library songs:', error);
    return {
      success: false,
      error: error.message,
      songs: [],
    };
  }
}

/**
 * Scan library folder and cache results
 * @param {Object} mainApp - Main application instance
 * @param {Function} [progressCallback] - Optional callback for progress updates (current, total)
 * @returns {Promise<Object>} Result with success status, files, and cache info
 */
export async function scanLibrary(mainApp, progressCallback) {
  try {
    const songsFolder = mainApp.settings?.getSongsFolder?.();
    if (!songsFolder) {
      return {
        success: false,
        error: 'Songs folder not set',
      };
    }

    // Get total file count for progress
    const allFiles = (await mainApp.findAllSongFiles?.(songsFolder)) || [];
    const totalFiles = allFiles.length;

    if (progressCallback) {
      progressCallback({ current: 0, total: totalFiles });
    }

    // Scan with progress
    const files =
      (await mainApp.scanForKaiFilesWithProgress?.(songsFolder, totalFiles, progressCallback)) ||
      [];

    // Cache the results
    mainApp.cachedLibrary = files;

    if (progressCallback) {
      progressCallback({ current: totalFiles, total: totalFiles });
    }

    return {
      success: true,
      files,
      count: files.length,
      cached: true,
    };
  } catch (error) {
    console.error('❌ Failed to scan library:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Sync library (incremental update - only scans new/modified files)
 * @param {Object} mainApp - Main application instance
 * @param {Function} [progressCallback] - Optional callback for progress updates
 * @returns {Promise<Object>} Result with success status and updated files
 */
export async function syncLibrary(mainApp, progressCallback) {
  try {
    const songsFolder = mainApp.settings?.getSongsFolder?.();
    if (!songsFolder) {
      return {
        success: false,
        error: 'Songs folder not set',
      };
    }

    // Step 1: Load cached library from mainApp or disk
    let cachedFiles = [];
    if (mainApp.cachedLibrary && mainApp.cachedLibrary.length > 0) {
      cachedFiles = mainApp.cachedLibrary;
    }

    // Step 2: Quick filesystem scan to find all valid files (no metadata parsing)
    console.log('🔍 Scanning filesystem...');
    const filesystemScan = (await mainApp.scanFilesystemForSync?.(songsFolder)) || [];
    const totalFiles = filesystemScan.length;

    if (progressCallback) {
      progressCallback({ current: Math.floor(totalFiles * 0.1), total: totalFiles });
    }

    // Build a map of current filesystem state (keyed by primary file path)
    const currentFilesMap = new Map();
    for (const item of filesystemScan) {
      currentFilesMap.set(item.path, item);
    }

    // Step 3: Check cached files to see which ones are still valid. A file is only
    // "still valid" (reuse cached metadata) if it exists AND is unchanged on disk;
    // a RE-CREATED file (same path, newer mtime) is treated as new so its updated
    // metadata/lyrics get re-parsed. Without this, overwriting a song keeps the
    // stale cached lyrics and the UI never reflects the new ones.
    const stillValid = [];
    const removedPaths = [];
    let changed = 0;

    for (const cachedFile of cachedFiles) {
      const filePath = cachedFile.file || cachedFile.path;
      const fsItem = currentFilesMap.get(filePath);

      if (fsItem) {
        const fsMtime = fsItem.mtimeMs || 0;
        const cachedMtime = cachedFile.mtimeMs || 0;
        // Re-parse if the file changed on disk (newer mtime). If we have no mtime
        // info on either side, fall back to the old behaviour (assume unchanged).
        if (fsMtime && cachedMtime && fsMtime > cachedMtime) {
          changed++;
          // leave fsItem in currentFilesMap → it gets re-parsed as a "new" file
        } else {
          stillValid.push(cachedFile);
          currentFilesMap.delete(filePath); // unchanged → reuse cached metadata
        }
      } else {
        // File is gone or invalid
        removedPaths.push(filePath);
      }
    }

    // Step 4: Remaining items in currentFilesMap are NEW or CHANGED files to parse.
    const newFiles = Array.from(currentFilesMap.values());

    console.log(
      `🔄 Sync: ${newFiles.length - changed} new, ${changed} changed, ${removedPaths.length} removed, ${totalFiles} total`
    );

    // Start with files that are still valid (already have metadata)
    let updatedFiles = stillValid;

    // Step 5: Process new files (10-100% progress)
    if (newFiles.length > 0) {
      const newFilesData =
        (await mainApp.parseMetadataWithProgress?.(newFiles, totalFiles, 0.1)) || [];
      updatedFiles = updatedFiles.concat(newFilesData);
    } else {
      // No new files, go straight to 100%
      if (progressCallback) {
        progressCallback({ current: totalFiles, total: totalFiles });
      }
    }

    // Update cache AND notify clients. updateLibraryCache refreshes the webServer
    // cache + Fuse index and emits 'library-refreshed' over socket.io, which is
    // what makes the web-admin LibraryPanel reload automatically. The bare
    // `mainApp.cachedLibrary = ...` assignment did neither, so after a creator save
    // the song list only updated on a manual Sync. Route through it.
    await updateLibraryCache(mainApp, updatedFiles);

    return {
      success: true,
      files: updatedFiles,
      count: updatedFiles.length,
      added: newFiles.length,
      removed: removedPaths.length,
      removedPaths,
    };
  } catch (error) {
    console.error('❌ Failed to sync library:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * THE shared song search. Pure: takes a song array + query, returns ranked songs. Used by
 * searchSongs() (desktop/admin) AND the web/phone API routes, so EVERY surface searches
 * identically. Typo-tolerant (Fuse), field-weighted (title > artist > album), and
 * order-independent across query words.
 * @param {Array} songs - the song list to search
 * @param {string} query - the search query
 * @param {number} [limit=50] - max results
 * @returns {Array} matching songs (already ranked + limited)
 */
export function searchSongList(songs, query, limit = 500) {
  const trimmed = (query || '').trim();
  if (!trimmed || !Array.isArray(songs) || songs.length === 0) return [];

  const fuse = getSongSearchIndex(songs);

  // Multi-word, ORDER-INDEPENDENT matching: split into terms, require each term to match
  // SOME field (AND across terms). This is what lets "diamond caroline" or "artist title"
  // find a song even though the words aren't contiguous — the #1 reason the old substring
  // filter failed users. A single term just runs Fuse directly.
  //
  // Terms below Fuse's minMatchCharLength can NEVER match, so requiring them
  // guaranteed zero results — typing the full title "i shot the sheriff"
  // found NOTHING because of the "i". Ignore them.
  const terms = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 2);

  const ql = trimmed.toLowerCase();
  // Title-first tiebreak: a row whose TITLE contains the query ranks above one that only
  // matched on artist/album, even if Fuse scored the latter (e.g. an exact artist hit)
  // lower. Matches what users expect when they type a song name.
  // Tiered ranking: an EXACT substring hit beats any fuzzy-only hit, title
  // beats artist/album. This is what makes a band prefix work: 'bea' is an
  // exact substring of 'Beatles', so the whole Beatles block outranks the
  // hundreds of fuzzy-only matches a short query drags in from a big library.
  const tierOf = (item) => {
    if (item.title?.toLowerCase().includes(ql)) return 0;
    if (item.artist?.toLowerCase().includes(ql) || item.album?.toLowerCase().includes(ql)) return 1;
    return 2;
  };
  const titleFirst = (a, b) => {
    const ta = tierOf(a.item);
    const tb = tierOf(b.item);
    if (ta !== tb) return ta - tb;
    // Inside the artist/album tier, group by ARTIST (then title) so a band
    // reads as a block instead of 114 songs scattered by score noise.
    if (ta === 1) {
      const da = (a.item.artist || '').localeCompare(b.item.artist || '');
      if (da) return da;
      return (a.item.title || '').localeCompare(b.item.title || '');
    }
    const ds = (a.score ?? 1) - (b.score ?? 1);
    if (ds) return ds;
    // Deterministic order inside equal-score groups: alphabetical by title, so
    // which songs appear - and where - stops being insertion-order luck.
    return (a.item.title || '').localeCompare(b.item.title || '');
  };

  let ranked;
  if (terms.length <= 1) {
    const all = fuse.search(trimmed).sort(titleFirst);
    // Tier QUOTA: on short queries the title tier alone can exceed the limit
    // ('be' hits 1,471 titles in a 9.5k library), which would starve the
    // artist tier entirely - typing a band prefix must still surface the
    // band's block. Title matches get at most half the limit when lower
    // tiers have matches; leftovers backfill.
    const byTier = [[], [], []];
    for (const r of all) byTier[tierOf(r.item)].push(r);
    const [t0, t1, t2] = byTier;
    const lower = t1.length + t2.length;
    const t0Take = Math.min(
      t0.length,
      lower > 0 ? Math.max(limit - lower, Math.ceil(limit / 2)) : limit
    );
    const t1Take = Math.min(t1.length, limit - t0Take);
    const t2Take = Math.min(t2.length, limit - t0Take - t1Take);
    let picked = [...t0.slice(0, t0Take), ...t1.slice(0, t1Take), ...t2.slice(0, t2Take)];
    if (picked.length < limit && t0.length > t0Take) {
      picked = picked.concat(t0.slice(t0Take, t0Take + (limit - picked.length)));
    }
    ranked = picked;
  } else {
    // SOFT-AND across terms: count how many terms each song matches (union of
    // per-term result sets, so a dud FIRST term can't nuke everything), require
    // all-but-one, and rank by matched count then combined score. A stray word,
    // a number, or a term aimed at a missing artist tag now degrades ranking
    // instead of guaranteeing zero results.
    const perTerm = terms.map((t) => new Map(fuse.search(t).map((r) => [r.item, r.score ?? 1])));
    const tally = new Map(); // item -> { n: matched terms, total: summed score }
    for (const m of perTerm) {
      for (const [item, score] of m) {
        const e = tally.get(item) || { n: 0, total: 0 };
        e.n += 1;
        e.total += score;
        tally.set(item, e);
      }
    }
    const need = Math.max(1, terms.length - 1);
    const combined = [];
    for (const [item, e] of tally) {
      if (e.n >= need) combined.push({ item, n: e.n, score: e.total / e.n });
    }
    combined.sort(
      (a, b) =>
        b.n - a.n || a.score - b.score || (a.item.title || '').localeCompare(b.item.title || '')
    );
    ranked = combined;
    // Still nothing (e.g. heavy typos in several terms): fuzzy-match the whole
    // query string as a last resort.
    if (ranked.length === 0) {
      ranked = fuse.search(trimmed).sort(titleFirst);
    }
  }

  return ranked.slice(0, limit).map((r) => r.item);
}

/**
 * Search songs in the library (desktop IPC + /admin route).
 * @param {Object} mainApp - Main application instance
 * @param {string} query - Search query
 * @returns {Object} Result with success status and matching songs
 */
export function searchSongs(mainApp, query, { stemOnly = false } = {}) {
  try {
    if (!query || !query.trim()) {
      return { success: true, songs: [] };
    }
    let cachedSongs = mainApp.cachedLibrary || [];
    // The editor can only open stem files, so its search must filter BEFORE
    // ranking/limiting: filtering the global top-N afterwards let CDG entries
    // consume every slot and hid stem matches entirely.
    if (stemOnly) cachedSongs = cachedSongs.filter((s) => isStemMp4Format(s.format));
    return { success: true, songs: searchSongList(cachedSongs, query, 500) };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      songs: [],
    };
  }
}

/**
 * Get song info by file path
 * @param {Object} mainApp - Main application instance
 * @param {string} filePath - Path to the song file
 * @returns {Promise<Object>} Result with success status and song info
 */
export async function getSongInfo(mainApp, filePath) {
  try {
    if (!filePath) {
      return {
        success: false,
        error: 'File path is required',
      };
    }

    // Check cache first
    const cachedResult = getCachedSongs(mainApp);
    const cachedSong = cachedResult.files?.find((f) => f.path === filePath);

    if (cachedSong) {
      return {
        success: true,
        song: cachedSong,
        fromCache: true,
      };
    }

    // Not in cache, extract metadata directly
    const lowerPath = filePath.toLowerCase();
    const format =
      lowerPath.endsWith('.stem.mp4') ||
      lowerPath.endsWith('.stem.m4a') ||
      lowerPath.endsWith('.m4a') ||
      lowerPath.endsWith('.mp4')
        ? STEM_MP4_FORMAT
        : lowerPath.endsWith('.kar') || lowerPath.endsWith('.zip')
          ? 'cdg-archive'
          : 'cdg-pair';

    let metadata;
    if (format === STEM_MP4_FORMAT) {
      metadata = await mainApp.extractM4AMetadata?.(filePath);
    } else if (format === 'cdg-archive') {
      metadata = await mainApp.extractCDGArchiveMetadata?.(filePath);
    } else {
      // For CDG pairs, we'd need the CDG path too
      return {
        success: false,
        error: 'CDG pair requires both MP3 and CDG paths',
      };
    }

    return {
      success: true,
      song: {
        path: filePath,
        format,
        ...metadata,
      },
      fromCache: false,
    };
  } catch (error) {
    console.error('Error getting song info:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Clear the library cache
 * @param {Object} mainApp - Main application instance
 * @returns {Object} Result with success status
 */
export function clearLibraryCache(mainApp) {
  mainApp.cachedLibrary = null;
  return {
    success: true,
    message: 'Library cache cleared',
  };
}

/**
 * Update cache after library scan/sync
 * Updates both mainApp cache and webServer cache (if available)
 * @param {Object} mainApp - Main application instance
 * @param {Array} files - Scanned files to cache
 * @returns {Promise<Object>} Result with success status
 */
export async function updateLibraryCache(mainApp, files) {
  try {
    // Update main app cache
    mainApp.cachedLibrary = files;

    // Update web server cache if available
    if (mainApp.webServer) {
      mainApp.webServer.cachedSongs = files;
      mainApp.webServer.songsCacheTime = Date.now();
      resetSongSearchIndex(); // songs changed → rebuild the shared search index

      // Notify web admin clients via socket
      if (mainApp.webServer.io) {
        mainApp.webServer.io.emit('library-refreshed', {
          count: files.length,
          timestamp: Date.now(),
        });
      }
    }

    // Notify the Electron renderer too - its LibraryPanel keeps a local copy
    // and only reloads on this event. Without it, a song created via
    // host-create or the creator panel is searchable in the web admin but
    // invisible in the app's Library tab until a manual sync.
    mainApp.sendToRenderer?.('library:scanComplete', { count: files.length });

    // Save to disk cache (Electron only)
    if (mainApp.settings?.getSongsFolder) {
      const path = await import('path');
      const fsPromises = await import('fs/promises');
      const { app } = await import('electron');

      const songsFolder = mainApp.settings.getSongsFolder();
      const cacheFile = path.default.join(app.getPath('userData'), 'library-cache.json');

      try {
        await fsPromises.default.writeFile(
          cacheFile,
          JSON.stringify({
            songsFolder,
            files,
            cachedAt: new Date().toISOString(),
          }),
          'utf8'
        );
        console.log('💾 Library cache saved to disk');
      } catch (err) {
        console.error('Failed to save library cache to disk:', err);
      }
    }

    return {
      success: true,
      count: files.length,
    };
  } catch (error) {
    console.error('Failed to update library cache:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}
