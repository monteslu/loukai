#!/usr/bin/env node
/**
 * Inspect a .stem.mp4 / .stem.m4a file the way Loukai will see it.
 *
 * Usage:
 *   node scripts/inspect-stem.js <file.stem.mp4>            # summary
 *   node scripts/inspect-stem.js --atoms <file.stem.mp4>    # + full atom tree
 *   node scripts/inspect-stem.js --lines <file.stem.mp4>    # + every lyric line
 *   node scripts/inspect-stem.js --json <file.stem.mp4>     # machine-readable dump
 *
 * Prints the container layout, per-track sample tables, NI Stems metadata,
 * the karaoke atom, and a "render plan": the sequence of screens the canvas
 * renderer will show (intro bar, each sung line, instrumental gaps, outro),
 * with the backup-singer lines that overlap each. Warnings flag data the
 * renderer will mishandle (overlapping lines, bad word timings, ...).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { Atoms, Extractor } from 'stem-mp4';
import {
  normalizeKaraLines,
  buildRenderTimeline,
  validateLines,
  findFirstMainLineIndex,
} from '../src/shared/lyricTimeline.js';

const { readUInt32BE, readString, readUInt8 } = Extractor;

// ---------------------------------------------------------------------------
// Container parsing helpers (stem-mp4 exposes the atom tree; we read a few
// header fields it does not decode: tkhd flags, codec, channels, sample rate)
// ---------------------------------------------------------------------------

function findChild(atom, type) {
  return atom?.children?.find((a) => a.type === type) || null;
}

function findPath(root, ...path) {
  let cur = { children: root };
  for (const type of path) {
    cur = findChild(cur, type);
    if (!cur) return null;
  }
  return cur;
}

function parseTkhd(buf, tkhd) {
  const version = readUInt8(buf, tkhd.offset + 8);
  const flags =
    (readUInt8(buf, tkhd.offset + 9) << 16) |
    (readUInt8(buf, tkhd.offset + 10) << 8) |
    readUInt8(buf, tkhd.offset + 11);
  const idOffset = tkhd.offset + 8 + 4 + (version === 1 ? 16 : 8);
  return { flags, enabled: (flags & 1) === 1, trackId: readUInt32BE(buf, idOffset) };
}

function parseStsdEntry(buf, stsd) {
  // stsd: fullbox header (4) + entry count (4) + first entry
  const entryOffset = stsd.offset + 16;
  const codec = readString(buf, entryOffset + 4, 4);
  // AudioSampleEntry: 6 reserved + 2 data ref idx + 8 reserved + channels(2) + samplesize(2) + 4 + samplerate(4, 16.16)
  const channels = (buf[entryOffset + 24] << 8) | buf[entryOffset + 25];
  const sampleSize = (buf[entryOffset + 26] << 8) | buf[entryOffset + 27];
  const sampleRate = readUInt32BE(buf, entryOffset + 32) >>> 16;
  return { codec, channels, sampleSize, sampleRate };
}

function parseHdlr(buf, hdlr) {
  return readString(buf, hdlr.offset + 16, 4);
}

function parseTracks(buf, tree) {
  const moov = findPath(tree, 'moov');
  if (!moov) return [];
  const traks = moov.children.filter((a) => a.type === 'trak');
  const info = Extractor.getTrackInfo(buf);
  return traks.map((trak, i) => {
    const tkhd = findChild(trak, 'tkhd');
    const hdlr = findPath(trak.children, 'mdia', 'hdlr');
    const stsd = findPath(trak.children, 'mdia', 'minf', 'stbl', 'stsd');
    const stco =
      findPath(trak.children, 'mdia', 'minf', 'stbl', 'stco') ||
      findPath(trak.children, 'mdia', 'minf', 'stbl', 'co64');
    const stsz = findPath(trak.children, 'mdia', 'minf', 'stbl', 'stsz');
    const edts = findChild(trak, 'edts');
    const chunkCount = stco ? readUInt32BE(buf, stco.offset + 12) : 0;
    let bytes = 0;
    if (stsz) {
      const defaultSize = readUInt32BE(buf, stsz.offset + 12);
      const count = readUInt32BE(buf, stsz.offset + 16);
      if (defaultSize) bytes = defaultSize * count;
      else for (let s = 0; s < count; s++) bytes += readUInt32BE(buf, stsz.offset + 20 + s * 4);
    }
    return {
      index: i,
      ...(tkhd ? parseTkhd(buf, tkhd) : {}),
      handler: hdlr ? parseHdlr(buf, hdlr) : null,
      ...(stsd ? parseStsdEntry(buf, stsd) : {}),
      sampleCount: info[i]?.sampleCount ?? null,
      timescale: info[i]?.timescale ?? null,
      duration: info[i]?.duration ?? null,
      chunkCount,
      bytes,
      hasEditList: Boolean(edts),
      error: info[i]?.error,
    };
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtTime = (s) => {
  if (s == null || !Number.isFinite(s)) return '  --  ';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
const fmtBytes = (n) =>
  n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
const pad = (v, n) => String(v ?? '').padEnd(n);
const rpad = (v, n) => String(v ?? '').padStart(n);
const heading = (t) => console.log(`\n== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`);

function printAtomTree(atoms, depth = 0) {
  for (const a of atoms) {
    console.log(`${'  '.repeat(depth)}${a.type}  @${a.offset}  ${a.size} bytes`);
    if (a.children) printAtomTree(a.children, depth + 1);
  }
}

function describeLine(line) {
  const who = line.isDisabled ? 'disabled' : line.isBackup ? line.singer : line.singer || 'lead';
  return `[${line.index}] ${fmtTime(line.startTime)}-${fmtTime(line.endTime)} ${pad(who, 10)} ${JSON.stringify(line.text)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const files = args.filter((a) => !a.startsWith('--'));

  if (files.length !== 1 || flags.has('--help')) {
    console.log('Usage: node scripts/inspect-stem.js [--atoms] [--lines] [--json] <file.stem.mp4>');
    process.exit(files.length ? 0 : 1);
  }

  const filePath = resolve(files[0]);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const buf = new Uint8Array(readFileSync(filePath));
  const tree = Atoms.dumpAtomTreeBuffer(buf);
  const tracks = parseTracks(buf, tree);

  let stems = null;
  try {
    stems = Atoms.readNiStemsMetadataBuffer(buf);
  } catch {
    /* no stem atom */
  }
  let kara = null;
  try {
    kara = Atoms.readKaraAtomBuffer(buf);
  } catch {
    /* no kara atom */
  }

  let tags = null;
  try {
    const mm = await import('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: false });
    tags = {
      title: meta.common.title,
      artist: meta.common.artist,
      album: meta.common.album,
      year: meta.common.year,
      key: meta.common.key,
      bpm: meta.common.bpm,
      genre: meta.common.genre,
      trackNumber: meta.common.track?.no,
    };
  } catch {
    /* music-metadata unavailable */
  }

  const rawLines = kara?.lines || [];
  const lines = normalizeKaraLines(rawLines);
  const masterDuration = tracks[0]?.duration ?? null;
  const timeline = buildRenderTimeline(lines, masterDuration);
  const warnings = validateLines(lines, rawLines);

  // Container-level warnings
  const topLevel = tree.map((a) => a.type);
  if (topLevel.indexOf('moov') > topLevel.indexOf('mdat')) {
    warnings.push('moov comes after mdat (not streamable; players must read the whole file first)');
  }
  const durations = tracks.map((t) => t.duration).filter((d) => d != null);
  if (durations.length > 1 && Math.max(...durations) - Math.min(...durations) > 0.05) {
    warnings.push(
      `track durations differ by ${(Math.max(...durations) - Math.min(...durations)).toFixed(3)}s`
    );
  }
  tracks.forEach((t) => {
    if (t.index === 0 && t.enabled === false)
      warnings.push('track 0 (master) is disabled; normal players will be silent');
    if (t.index > 0 && t.enabled === true)
      warnings.push(`track ${t.index} is enabled; normal players may play it on top of the master`);
  });
  if (!stems) warnings.push('no NI Stems atom (udta/stem); DJ software will not see stems');
  if (stems && stems.stems && stems.stems.length !== tracks.length - 1) {
    warnings.push(
      `stem atom lists ${stems.stems.length} stems but the file has ${tracks.length - 1} stem tracks`
    );
  }
  if (!kara) warnings.push('no kara atom; Loukai will show no lyrics');
  if (kara && findFirstMainLineIndex(lines) === -1)
    warnings.push('kara atom has no lines for the lead singer');
  lines.forEach((l) => {
    if (masterDuration && l.endTime > masterDuration + 0.5) {
      warnings.push(
        `line ${l.index} ends at ${fmtTime(l.endTime)}, past the end of the audio (${fmtTime(masterDuration)})`
      );
    }
  });

  if (flags.has('--json')) {
    console.log(
      JSON.stringify(
        {
          file: filePath,
          size: buf.length,
          atoms: tree,
          tracks,
          tags,
          stems,
          kara,
          timeline,
          warnings,
        },
        null,
        2
      )
    );
    return;
  }

  heading('File');
  console.log(`${basename(filePath)}  (${fmtBytes(buf.length)})`);
  console.log(`top-level atoms: ${tree.map((a) => `${a.type}(${fmtBytes(a.size)})`).join('  ')}`);

  if (flags.has('--atoms')) {
    heading('Atom tree');
    printAtomTree(tree);
  }

  heading('Tracks');
  console.log(
    `${pad('#', 3)}${pad('role', 8)}${pad('enabled', 9)}${pad('codec', 7)}${rpad('ch', 3)}${rpad('rate', 7)}${rpad('duration', 10)}${rpad('samples', 9)}${rpad('chunks', 8)}${rpad('bytes', 10)}  notes`
  );
  tracks.forEach((t) => {
    const role = t.index === 0 ? 'master' : stems?.stems?.[t.index - 1]?.name || `stem${t.index}`;
    const notes = [t.hasEditList ? 'edts' : null, t.error].filter(Boolean).join(' ');
    console.log(
      `${pad(t.index, 3)}${pad(role, 8)}${pad(t.enabled ? 'yes' : 'no', 9)}${pad(t.codec, 7)}${rpad(t.channels, 3)}${rpad(t.sampleRate, 7)}${rpad(fmtTime(t.duration), 10)}${rpad(t.sampleCount, 9)}${rpad(t.chunkCount, 8)}${rpad(fmtBytes(t.bytes), 10)}  ${notes}`
    );
  });

  heading('Standard metadata (ilst)');
  if (tags) {
    Object.entries(tags).forEach(([k, v]) => {
      if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
        console.log(`${pad(k, 12)} ${Array.isArray(v) ? v.join(', ') : v}`);
    });
  } else {
    console.log('(could not read)');
  }

  heading('NI Stems (udta/stem)');
  if (stems) {
    console.log(
      `version ${stems.version}, stems: ${(stems.stems || []).map((s) => `${s.name} ${s.color}`).join(', ')}`
    );
    if (stems.mastering_dsp) {
      const c = stems.mastering_dsp.compressor;
      const l = stems.mastering_dsp.limiter;
      console.log(
        `compressor ${c?.enabled ? 'on' : 'off'} (threshold ${c?.threshold} dB, ratio ${c?.ratio}), limiter ${l?.enabled ? 'on' : 'off'} (ceiling ${l?.ceiling} dB)`
      );
    }
  } else {
    console.log('(none)');
  }

  heading('Karaoke (ilst/----:com.stems:kara)');
  if (kara) {
    const { lines: _l, chords, ...rest } = kara;
    console.log(
      `timing: offset ${kara.timing?.offset_sec ?? 0}s, encoder delay ${kara.timing?.encoder_delay_samples ?? 0} samples`
    );
    console.log(`tags: ${(kara.tags || []).join(', ') || '(none)'}`);
    console.log(`singers: ${JSON.stringify(kara.singers ?? null)}`);
    console.log(
      `chords: ${chords ? `${chords.length} segments, ${fmtTime(chords[0]?.start)} - ${fmtTime(chords[chords.length - 1]?.end)}` : '(none)'}`
    );
    if (rest.meta?.corrections) {
      const c = rest.meta.corrections;
      console.log(
        `llm corrections: ${c.applied?.length ?? 0} applied, ${c.missing_lines_suggested?.length ?? 0} suggested (${c.provider}/${c.model})`
      );
    }
    const mains = lines.filter((l) => !l.isBackup && !l.isDisabled);
    const backups = lines.filter((l) => l.isBackup && !l.isDisabled);
    const disabled = lines.filter((l) => l.isDisabled);
    const withWords = lines.filter((l) => l.wordCount > 0);
    console.log(
      `lines: ${lines.length} total, ${mains.length} lead, ${backups.length} backup, ${disabled.length} disabled, ${withWords.length} with word timings`
    );
    const firstMain = findFirstMainLineIndex(lines);
    if (firstMain >= 0) console.log(`first sung line: ${describeLine(lines[firstMain])}`);

    if (flags.has('--lines')) {
      heading('Lines');
      lines.forEach((l) =>
        console.log(`${describeLine(l)}${l.wordCount ? `  (${l.wordCount} words)` : ''}`)
      );
    }
  } else {
    console.log('(none)');
  }

  heading('Render plan (what the canvas shows, in order)');
  if (timeline.length === 0) {
    console.log('(no lyrics)');
  }
  timeline.forEach((s) => {
    const span = `${fmtTime(s.start)} - ${fmtTime(s.end)}`;
    const bar = s.showsProgressBar ? 'progress bar' : 'no bar';
    let desc;
    switch (s.type) {
      case 'intro':
        desc = `INTRO   ${span}  ${bar}, waiting for ${describeLine(lines[s.waitingFor])}`;
        break;
      case 'line':
        desc = `SING    ${span}  ${describeLine(lines[s.index])}`;
        break;
      case 'gap':
        desc = `GAP     ${span}  ${(s.end - s.start).toFixed(1)}s, ${bar}, next ${describeLine(lines[s.waitingFor])}`;
        break;
      case 'outro':
        desc = `OUTRO   ${span}`;
        break;
      default:
        desc = `${s.type.toUpperCase()}  ${span}`;
    }
    console.log(desc);
    s.backups?.forEach((i) => console.log(`            backup: ${describeLine(lines[i])}`));
  });

  heading(`Warnings (${warnings.length})`);
  warnings.forEach((w) => console.log(`! ${w}`));
  if (warnings.length === 0) console.log('none');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
