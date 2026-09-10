/**
 * Lyric timeline helpers shared by the canvas renderer and the stem inspector CLI.
 *
 * "Main" lines are the ones the singer performs. Backup lines (singer starts
 * with "backup") are drawn at the bottom of the canvas and never drive the
 * intro / instrumental progress bars, so anything that asks "what is the
 * renderer waiting for?" has to skip them. Disabled lines are ignored entirely.
 */

/** Minimum instrumental gap (seconds) before the renderer shows a progress bar. */
export const PROGRESS_BAR_MIN_GAP_SEC = 5;

/**
 * Normalize kara-atom lines ({start, end, text, singer, disabled}) into the
 * shape the renderer works with ({startTime, endTime, isBackup, isDisabled}).
 * Mirrors KaraokeRenderer.parseLyricsData for the fields a kara atom carries.
 */
export function normalizeKaraLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line, index) => {
    const singer = line.singer || (line.backup === true ? 'backup' : null);
    return {
      index,
      startTime: line.start ?? line.time ?? line.start_time ?? 0,
      endTime: line.end ?? line.end_time ?? (line.start ?? 0) + 3,
      text: line.text || '',
      singer,
      isBackup: typeof singer === 'string' && singer.startsWith('backup'),
      isDisabled: line.disabled === true,
      wordCount: line.words?.timings?.length ?? 0,
    };
  });
}

export function isMainLine(line) {
  return Boolean(line) && !line.isBackup && !line.isDisabled;
}

/** Index of the first line the singer performs, or -1 if there is none. */
export function findFirstMainLineIndex(lines) {
  if (!Array.isArray(lines)) return -1;
  return lines.findIndex(isMainLine);
}

/** Index of the last line the singer performs, or -1 if there is none. */
export function findLastMainLineIndex(lines) {
  if (!Array.isArray(lines)) return -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isMainLine(lines[i])) return i;
  }
  return -1;
}

/**
 * Build the sequence of screens the renderer will show for a song:
 *   intro  -> from 0 until the first main line (progress bar + preview)
 *   line   -> a main line is active
 *   gap    -> between two main lines (progress bar only if > 5s)
 *   outro  -> after the last main line until the end of the song
 * Each section lists the backup lines that are active inside it.
 */
export function buildRenderTimeline(lines, songDuration = null) {
  const sections = [];
  if (!Array.isArray(lines) || lines.length === 0) return sections;

  const mainIndexes = lines.map((l, i) => (isMainLine(l) ? i : -1)).filter((i) => i >= 0);
  const backupIndexes = lines
    .map((l, i) => (l.isBackup && !l.isDisabled ? i : -1))
    .filter((i) => i >= 0);

  const backupsWithin = (start, end) =>
    backupIndexes.filter((i) => lines[i].startTime < end && lines[i].endTime > start);

  if (mainIndexes.length === 0) {
    sections.push({
      type: 'no-main-lines',
      start: 0,
      end: songDuration ?? Math.max(...lines.map((l) => l.endTime)),
      backups: backupIndexes,
    });
    return sections;
  }

  const first = lines[mainIndexes[0]];
  sections.push({
    type: 'intro',
    start: 0,
    end: first.startTime,
    waitingFor: mainIndexes[0],
    showsProgressBar: first.startTime > 0,
    backups: backupsWithin(0, first.startTime),
  });

  mainIndexes.forEach((idx, n) => {
    const line = lines[idx];
    sections.push({
      type: 'line',
      index: idx,
      start: line.startTime,
      end: line.endTime,
      backups: backupsWithin(line.startTime, line.endTime),
    });
    const nextIdx = mainIndexes[n + 1];
    if (nextIdx !== undefined) {
      const next = lines[nextIdx];
      const gap = next.startTime - line.endTime;
      if (gap > 0) {
        sections.push({
          type: 'gap',
          start: line.endTime,
          end: next.startTime,
          waitingFor: nextIdx,
          showsProgressBar: gap > PROGRESS_BAR_MIN_GAP_SEC,
          backups: backupsWithin(line.endTime, next.startTime),
        });
      }
    }
  });

  const last = lines[mainIndexes[mainIndexes.length - 1]];
  const outroEnd = songDuration ?? last.endTime;
  if (outroEnd > last.endTime) {
    sections.push({
      type: 'outro',
      start: last.endTime,
      end: outroEnd,
      backups: backupsWithin(last.endTime, outroEnd),
    });
  }

  return sections;
}

/**
 * Sanity checks on a normalized line list. Returns human-readable warnings.
 */
export function validateLines(lines, rawLines = null) {
  const warnings = [];
  if (!Array.isArray(lines)) return warnings;

  let lastMainEnd = -Infinity;
  let lastStart = -Infinity;
  lines.forEach((line, i) => {
    const label = `line ${i} (${JSON.stringify(line.text.slice(0, 30))})`;
    if (!(line.endTime > line.startTime)) {
      warnings.push(`${label}: end ${line.endTime} is not after start ${line.startTime}`);
    }
    if (line.startTime < lastStart) {
      warnings.push(`${label}: starts before the previous line (lines are out of order)`);
    }
    lastStart = Math.max(lastStart, line.startTime);
    if (!line.text.trim()) {
      warnings.push(`${label}: empty text (renderer drops it)`);
    }
    // eslint-disable-next-line no-control-regex
    const control = line.text.match(/[\x00-\x08\x0b-\x1f\x7f]/g);
    if (control) {
      const codes = [...new Set(control)].map(
        (c) => 'U+' + c.charCodeAt(0).toString(16).padStart(4, '0')
      );
      warnings.push(`${label}: text contains control character(s) ${codes.join(', ')}`);
    }
    if (isMainLine(line)) {
      if (line.startTime < lastMainEnd) {
        warnings.push(
          `${label}: overlaps the previous main line by ${(lastMainEnd - line.startTime).toFixed(2)}s`
        );
      }
      lastMainEnd = Math.max(lastMainEnd, line.endTime);
    }
    const raw = rawLines?.[i];
    const timings = raw?.words?.timings;
    if (Array.isArray(timings)) {
      const wordCount = (raw.text || '').trim().split(/\s+/).filter(Boolean).length;
      if (timings.length !== wordCount) {
        warnings.push(`${label}: ${timings.length} word timings for ${wordCount} words`);
      }
      const lineLen = line.endTime - line.startTime;
      timings.forEach(([s, e], w) => {
        if (s < 0 || e > lineLen + 0.05 || e < s) {
          warnings.push(
            `${label}: word ${w} timing [${s}, ${e}] falls outside the line (0..${lineLen.toFixed(2)})`
          );
        }
      });
    }
  });
  return warnings;
}
