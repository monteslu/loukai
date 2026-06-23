/**
 * Pure-JS audio file inspection — replaces the native ffprobe `getAudioInfo`.
 *
 * No ffmpeg, no codecs: this only reads container metadata (duration, sample
 * rate, channels, codec, tags) and detects multi-track NI-Stems files. Two
 * sources, picked by file shape:
 *   - Stem files (.stem.mp4 / multi-track .m4a): stem-mp4 (track structure +
 *     NI-Stems names) is authoritative. music-metadata mis-reads multitrack MP4
 *     (returns sampleRate 0 / channels 255), so it is NOT trusted for audio
 *     params here — those come from parsing the mp4a sample entry directly.
 *   - Plain files (mp3/wav/flac/single m4a): music-metadata handles everything.
 *
 * Conformance to ffprobe is covered by audioInfo.test.js.
 */

import { readFileSync } from 'fs';
import * as mm from 'music-metadata';
import { Atoms } from 'stem-mp4';

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const type4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// Minimal MP4 box walker (no codec logic, just offsets). Returns the direct
// child boxes within [start, start+len) as { type, dataOffset, size }.
function children(buf, start, len) {
  const out = [];
  let p = start;
  const end = start + len;
  while (p + 8 <= end) {
    const size = u32(buf, p);
    if (size < 8) break;
    out.push({ type: type4(buf, p + 4), dataOffset: p + 8, size });
    p += size;
  }
  return out;
}
const find = (boxes, t) => boxes.find((b) => b.type === t);
function topLevel(buf) {
  return children(buf, 0, buf.length);
}

/**
 * Parse channels + sampleRate from the first audio trak's `mp4a` sample entry.
 * The AudioSampleEntry layout after the box header is fixed: 6 reserved, 2 data-
 * ref-index, 8 reserved, 2 channelcount, 2 samplesize, 2 predefined, 2 reserved,
 * 4 samplerate (16.16 fixed; upper 16 = the rate). Returns null if not found.
 */
// Walk the audio (`soun`-handler) traks, yielding the stbl for each. Skips
// subtitle/text/video tracks (the mov_text lyrics track in a stem file).
function audioTraks(buf) {
  const moov = find(topLevel(buf), 'moov');
  if (!moov) return [];
  const out = [];
  for (const trak of children(buf, moov.dataOffset, moov.size - 8).filter(
    (b) => b.type === 'trak'
  )) {
    const mdia = find(children(buf, trak.dataOffset, trak.size - 8), 'mdia');
    if (!mdia) continue;
    const mdiaKids = children(buf, mdia.dataOffset, mdia.size - 8);
    const hdlr = find(mdiaKids, 'hdlr');
    if (!hdlr || type4(buf, hdlr.dataOffset + 8) !== 'soun') continue;
    const minf = find(mdiaKids, 'minf');
    if (!minf) continue;
    const stbl = find(children(buf, minf.dataOffset, minf.size - 8), 'stbl');
    if (stbl) out.push(stbl);
  }
  return out;
}

function parseFirstAudioEntry(buf) {
  const [stbl] = audioTraks(buf);
  if (!stbl) return null;
  const stsd = find(children(buf, stbl.dataOffset, stbl.size - 8), 'stsd');
  if (!stsd) return null;
  // stsd: 4 version/flags + 4 entryCount, then the first sample entry box.
  const entryStart = stsd.dataOffset + 8;
  const codec = type4(buf, entryStart + 4);
  const body = entryStart + 8; // AudioSampleEntry fields
  const channels = u16(buf, body + 16);
  const sampleRate = u16(buf, body + 24); // upper 16 of the 16.16 fixed-point rate
  return { codec: codec === 'mp4a' ? 'aac' : codec, channels, sampleRate };
}

/** Count of `soun`-handler tracks (audio), ignoring subtitle/text/data tracks. */
function audioTrakCount(buf) {
  return audioTraks(buf).length;
}

/**
 * Inspect an audio/video file. Drop-in replacement for the old ffprobe-based
 * getAudioInfo: returns { duration, sampleRate, channels, codec, bitRate, format,
 * title, artist, album, tags, audioStreamCount, audioStreams }.
 *
 * @param {string} inputPath
 * @returns {Promise<Object>}
 */
export async function getAudioInfo(inputPath) {
  const meta = await mm.parseFile(inputPath, { duration: true });
  const lower = inputPath.toLowerCase();
  const isMp4 = lower.endsWith('.m4a') || lower.endsWith('.mp4');

  // tags (normalized lowercase, like the old ffprobe path)
  const tags = {};
  for (const [k, v] of Object.entries(
    meta.native?.iTunes ? Object.fromEntries(meta.native.iTunes.map((t) => [t.id, t.value])) : {}
  )) {
    tags[k.toLowerCase()] = v;
  }
  const common = meta.common || {};

  let audioStreamCount = 1;
  let audioStreams = [];
  let sampleRate = meta.format.sampleRate || 0;
  let channels = meta.format.numberOfChannels || 0;
  let codec = (meta.format.codec || '').toLowerCase().includes('aac')
    ? 'aac'
    : meta.format.codec || '';

  if (isMp4) {
    // Stem-aware path: stem-mp4 is authoritative for track structure; the mp4a
    // entry gives correct sampleRate/channels (music-metadata returns garbage for
    // multitrack). NI-Stems atom supplies the stem names.
    const buf = readFileSync(inputPath);
    const nAudio = audioTrakCount(buf);
    if (nAudio > 0) audioStreamCount = nAudio;
    const entry = parseFirstAudioEntry(buf);
    if (entry) {
      if (entry.sampleRate) sampleRate = entry.sampleRate;
      if (entry.channels && entry.channels !== 255) channels = entry.channels;
      if (entry.codec) codec = entry.codec;
    }
    let stemNames = [];
    try {
      const ni = await Atoms.readNiStemsMetadata(inputPath);
      stemNames = (ni?.stems || []).map((s) => s.name);
    } catch {
      /* not a stem file / no NI atom */
    }
    // Build per-stream info: track 0 = master/mixdown, then the named stems.
    audioStreams = Array.from({ length: audioStreamCount }, (_, idx) => ({
      index: idx,
      title: idx === 0 ? 'master' : stemNames[idx - 1] || `track${idx}`,
      codec,
      channels,
      sampleRate,
    }));
  } else {
    audioStreams = [{ index: 0, title: common.title || 'track0', codec, channels, sampleRate }];
  }

  return {
    duration: meta.format.duration || 0,
    sampleRate,
    channels,
    codec,
    bitRate: meta.format.bitrate ? Math.round(meta.format.bitrate) : 0,
    format: meta.format.container || '',
    title: common.title || '',
    artist: common.artist || common.albumartist || '',
    album: common.album || '',
    tags,
    audioStreamCount,
    audioStreams,
  };
}

/**
 * Does the file contain a video stream? Pure-JS: music-metadata reports a video
 * track type, and for our inputs "has a non-audio/non-subtitle visual track".
 * @param {string} inputPath
 * @returns {Promise<boolean>}
 */
export async function isVideoFile(inputPath) {
  try {
    const meta = await mm.parseFile(inputPath);
    // music-metadata sets trackInfo with a 'video' type when present.
    const tracks = meta.format?.trackInfo || [];
    return tracks.some((t) => t.video != null);
  } catch {
    return false;
  }
}
