# Loukai M4A Stems Format

Loukai uses an open karaoke format built on top of [Native Instruments' Stems](https://www.native-instruments.com/en/specials/stems/) `.stem.m4a` specification with karaoke-specific extensions.

## Design Philosophy

The Loukai format serves two distinct purposes with a single file:

1. **DJ Software Compatibility** - Files work in Traktor, Mixxx, and other NI Stems-compatible software with full stem control
2. **Karaoke Functionality** - Additional atoms provide lyrics, pitch tracking, and word timing for karaoke applications

We achieve this by writing **both** the standard NI Stems metadata (for DJ software) and our own karaoke atoms (for Loukai). Software that doesn't understand our karaoke atoms simply ignores them, while software that doesn't understand NI Stems can still use the karaoke data.

This "dual metadata" approach means you don't need separate files for DJing and karaoke - the same `.stem.m4a` file works everywhere.

## Overview

The format is a standard MPEG-4 container (`.m4a`) containing:

- **Five audio tracks** (stems) in AAC format
- **Standard MP4 metadata** (title, artist, album, key, BPM, etc.)
- **NI Stems atom** (`stem`) for DJ software compatibility
- **Karaoke atoms** (`kara`, `vpch`, `kons`) for lyrics and pitch data

## Why This Format?

| Feature | Loukai M4A | Proprietary Karaoke | CDG |
|---------|------------|---------------------|-----|
| Open standard | MPEG-4 | Vendor-specific | Limited |
| Stem separation | 4 stems + master | Usually not | No |
| DJ software compatible | Traktor, Mixxx | No | No |
| Word-level lyrics | Yes | Usually | No |
| Pitch data | Yes | Rarely | No |
| Single file | Yes | Usually | MP3+CDG pair |
| File size | Small (AAC) | Varies | Large |

## File Structure

```
song.stem.m4a
├── ftyp              # File type (M4A)
├── moov              # Movie header
│   ├── mvhd          # Movie header data
│   ├── trak[0]       # Audio track 0 - Master (enabled, plays in normal players)
│   ├── trak[1]       # Audio track 1 - Drums (disabled)
│   ├── trak[2]       # Audio track 2 - Bass (disabled)
│   ├── trak[3]       # Audio track 3 - Other (disabled)
│   ├── trak[4]       # Audio track 4 - Vocals (disabled)
│   └── udta          # User data
│       ├── stem      # NI Stems metadata (JSON) - for DJ software
│       └── meta      # iTunes-style metadata container
│           └── ilst  # Metadata items
│               ├── ©nam, ©ART, etc.  # Standard metadata
│               ├── ----:com.stems:kara  # Karaoke data (JSON)
│               ├── ----:com.stems:vpch  # Vocal pitch (binary)
│               └── ----:com.stems:kons  # Word onsets (binary)
└── mdat              # Media data (compressed audio)
```

### Why Two Metadata Locations?

- **`stem` atom** (directly under `udta`): This is where NI Stems spec requires the stems metadata. DJ software like Mixxx and Traktor look here to identify stem files and read stem names/colors.

- **`ilst` atoms** (under `udta/meta/ilst`): This is the standard iTunes metadata location. We use freeform atoms (`----`) with our `com.stems` namespace for karaoke data. This location is widely supported and survives metadata editing tools.

## Audio Tracks

Following the [NI Stems specification](https://www.native-instruments.com/en/specials/stems/):

| Track | Content | Disposition | Purpose |
|-------|---------|-------------|---------|
| 0 | Master | **enabled** (default) | Full mix for backward compatibility |
| 1 | Drums | disabled | Rhythm, percussion |
| 2 | Bass | disabled | Low-end, basslines |
| 3 | Other | disabled | Melody, instruments, synths |
| 4 | Vocals | disabled | Vocals (mute for karaoke) |

**Track Disposition Flags**: The master track (0) is marked as the default/enabled track so that normal audio players only play the full mix. Stem tracks (1-4) are disabled so they're ignored by players that don't understand stems. This is per NI Stems spec section 3.

Audio is encoded as AAC. The NI spec recommends 256kbps VBR; we use 192kbps as a balance between quality and file size for karaoke use.

## NI Stems Metadata (`stem` atom)

The `stem` atom contains JSON metadata per the NI Stems specification. This is what makes files work in Traktor and Mixxx.

**Location**: `moov/udta/stem`

```json
{
  "version": 1,
  "mastering_dsp": {
    "compressor": {
      "enabled": true,
      "input_gain": 0.0,
      "output_gain": 0.0,
      "threshold": -6.0,
      "dry_wet": 100,
      "attack": 0.003,
      "release": 0.3,
      "ratio": 2.0,
      "hp_cutoff": 20
    },
    "limiter": {
      "enabled": true,
      "threshold": -0.3,
      "ceiling": -0.3,
      "release": 0.05
    }
  },
  "stems": [
    {"name": "drums", "color": "#FF0000"},
    {"name": "bass", "color": "#00FF00"},
    {"name": "other", "color": "#0000FF"},
    {"name": "vocals", "color": "#FFFF00"}
  ]
}
```

### Why Mastering DSP?

The NI Stems spec requires `mastering_dsp` settings because stems are typically exported *before* the final mastering stage. When a DJ mixes stems at different volumes, the result can sound different from the original mastered track.

The compressor and limiter settings tell playback software how to process the stem mix to approximate the original master's sound. This is critical for professional DJ use but less important for karaoke (where we're intentionally changing the mix by muting vocals).

Loukai uses conservative defaults that work well for AI-separated stems from Demucs.

### Stems Array

The `stems` array describes the 4 stem tracks (NOT including the master). Per NI spec:
- Track 1 = stems[0] (drums)
- Track 2 = stems[1] (bass)
- Track 3 = stems[2] (other)
- Track 4 = stems[3] (vocals)

Colors are RGB hex values used by DJ software to color-code the stem controls.

## Karaoke Atoms

These are Loukai-specific extensions stored as freeform atoms in the iTunes metadata area.

### `kara` - Karaoke Data

**Location**: `moov/udta/meta/ilst/----:com.stems:kara`

Contains lyrics, timing, and singer metadata in JSON format. Audio track information is read from the NI Stems `stem` atom (see above).

```json
{
  "timing": {
    "offset_sec": 0,
    "encoder_delay_samples": 0
  },
  "singers": {
    "A": { "name": "Lead Singer" },
    "B": { "name": "Duet Partner" },
    "duet": { "name": "Both", "color": "#22C55E" }
  },
  "tags": ["edited", "ai_corrected"],
  "lines": [
    {
      "start": 12.5,
      "end": 15.2,
      "text": "First line of lyrics"
    },
    {
      "start": 15.8,
      "end": 18.1,
      "text": "Second line of lyrics",
      "singer": "backup:PA"
    }
  ]
}
```

#### Why Separate from NI Stems?

The NI `stem` atom is designed for DJ use - it has stem names, colors, and mastering DSP settings. It has no concept of lyrics, word timing, or singers.

Rather than trying to extend the NI spec (which could break compatibility), we store karaoke data in a separate atom using the standard iTunes freeform atom format. This means:
- DJ software ignores our karaoke atoms (they're just unknown metadata)
- Karaoke software can read both atoms to get full functionality
- Metadata editing tools preserve both atoms

**Note**: Audio track information (sources, track mapping) is NOT stored in the kara atom. This data is read from the NI Stems `stem` atom to avoid duplication. The kara atom only contains karaoke-specific data.

#### Singer Metadata

The `singers` object and `line.singer` field enable multi-singer karaoke support:

| Value | Meaning | Audio Behavior |
|-------|---------|----------------|
| *(omitted)* | Default lead singer | Vocals muted on PA |
| `"A"` | Lead singer A | Vocals muted on PA |
| `"B"` | Singer B (duets) | Vocals muted on PA |
| `"duet"` | Both singers | Vocals muted on PA |
| `"backup"` | Backup vocals | Vocals muted on PA |
| `"backup:PA"` | Backup with punchthrough | **Vocals play through PA** |

**Example - "Somebody's Watching Me" by Rockwell:**

```json
{
  "singers": {
    "A": { "name": "Rockwell" },
    "B": { "name": "Michael Jackson" }
  },
  "lines": [
    { "start": 12.0, "end": 15.2, "text": "I'm just an average man" },
    { "start": 45.0, "end": 48.5, "text": "I always feel like somebody's watching me", "singer": "backup:PA" }
  ]
}
```

Lines with `"backup:PA"` play Michael Jackson's original vocals through the PA - the karaoke singer doesn't need to sing these iconic parts.

#### Tags

The `tags` array provides searchable labels:

| Tag | When Added |
|-----|------------|
| `edited` | Song was manually edited in the Song Editor |
| `ai_corrected` | LLM made corrections to lyrics during creation |

### `vpch` - Vocal Pitch

**Location**: `moov/udta/meta/ilst/----:com.stems:vpch`

Contains pitch detection data from CREPE analysis in binary format:

```
Byte 0:       Version (1)
Bytes 1-4:    Sample rate (uint32 BE, typically 100 Hz)
Bytes 5-8:    Data length (uint32 BE)
Bytes 9+:     Pitch samples (2 bytes each)
              - Byte 0: MIDI note (0-127, 0 = unvoiced)
              - Byte 1: Cents deviation (-50 to +50)
```

**Why binary?** Pitch data can have 10,000+ samples for a 3-minute song. Binary format is ~10x smaller than JSON.

**Why 100 Hz sample rate?** This gives 10ms resolution, which is sufficient for pitch visualization and auto-tune while keeping file size reasonable.

### `kons` - Karaoke Onsets

**Location**: `moov/udta/meta/ilst/----:com.stems:kons`

Contains word onset times for syllable-level highlighting:

```
Byte 0:       Version (1)
Bytes 1-4:    Data length (uint32 BE)
Bytes 5+:     Onset times (4 bytes each, uint32 BE, milliseconds)
```

## Standard Metadata

Loukai preserves and uses standard MP4/iTunes metadata:

| Atom | Field | Description |
|------|-------|-------------|
| `©nam` | title | Song title |
| `©ART` | artist | Performing artist |
| `©alb` | album | Album name |
| `©day` | date | Release year |
| `©gen` | genre | Music genre |
| `tmpo` | bpm | Tempo in beats per minute |
| `----:com.apple.iTunes:initialkey` | key | Musical key (e.g., "Am", "C#m") |

## Creating Files

### Using Loukai Creator (Recommended)

1. Open Loukai -> **Creator** tab
2. Drop an audio file or paste a URL
3. Configure options (stems, language, etc.)
4. Click **Create**

The Creator runs:
- **Demucs** for AI stem separation
- **Whisper** for AI lyric transcription
- **CREPE** for vocal pitch detection
- **Key detection** using Krumhansl-Schmuckler algorithm

### Programmatic Creation

Use the [m4a-stems](https://www.npmjs.com/package/m4a-stems) npm package:

```javascript
import { Atoms } from 'm4a-stems';

// Write NI Stems metadata (for DJ software compatibility)
// This defines the audio tracks - kara atom does NOT duplicate this info
await Atoms.addNiStemsMetadata('song.stem.m4a', ['drums', 'bass', 'other', 'vocals']);

// Write karaoke data (lyrics, timing, singers - NO audio section)
await Atoms.writeKaraAtom('song.stem.m4a', {
  timing: { offset_sec: 0 },
  lines: [{ start: 0, end: 3, text: 'Lyrics here' }]
});

// Write pitch data
await Atoms.writeVpchAtom('song.stem.m4a', {
  sampleRate: 100,
  data: [{ midi: 60, cents: 0 }, ...]
});

// Write word onsets
await Atoms.writeKonsAtom('song.stem.m4a', [0.5, 1.2, 1.8, ...]);
```

## Reading Files

```javascript
import { Atoms } from 'm4a-stems';

// Read NI Stems metadata (audio track info)
const stems = await Atoms.readNiStemsMetadata('song.stem.m4a');
// Returns: { version: 1, mastering_dsp: {...}, stems: [{name: 'drums', ...}, ...] }

// Read karaoke data (lyrics, timing, singers)
const kara = await Atoms.readKaraAtom('song.stem.m4a');
const pitch = await Atoms.readVpchAtom('song.stem.m4a');
const onsets = await Atoms.readKonsAtom('song.stem.m4a');
```

## Compatibility

### DJ Software (Full Stem Support)
- **Native Instruments Traktor**: Full stem support via NI Stems metadata
- **Mixxx**: Full stem support (reads `stem` atom)

### Audio Players (Master Track Only)
Any player supporting M4A/AAC plays track 0 (the full mix). The stems and custom atoms are ignored, ensuring backward compatibility.

### Loukai
Full support for all features: stems, lyrics, pitch display, onset highlighting, multi-singer karaoke.

## Repairing Old Files

### Adding NI Stems Metadata

Files created before NI Stems metadata was added can be repaired:

```bash
node scripts/repair-stems.js /path/to/song.stem.m4a
```

This adds the `stem` atom so files work in Mixxx/Traktor. Note: Track disposition flags cannot be fixed without re-encoding, but most DJ software handles this correctly anyway.

### Migrating Kara Audio Section

Files created before the audio section was removed from kara can be migrated:

```bash
node scripts/migrate-kara-audio.js /path/to/song.stem.m4a
```

This removes the redundant `audio` section from the kara atom. The audio track information is now read from the NI Stems `stem` atom instead. This migration is optional - old files will continue to work, but the duplicate data is unnecessary.

## File Extension

- `.stem.m4a` - Preferred, indicates stem content
- `.stem.mp4` - Also valid per NI spec
- `.m4a` - Supported, Loukai auto-detects via `stem` or `kara` atoms

## References

- [NI Stems File Specification](https://www.native-instruments.com/en/specials/stems/) - Official spec document
- [MPEG-4 Part 14 (MP4)](https://en.wikipedia.org/wiki/MP4_file_format)
- [m4a-stems npm package](https://www.npmjs.com/package/m4a-stems)
- [Demucs](https://github.com/facebookresearch/demucs) - AI stem separation
- [Whisper](https://github.com/openai/whisper) - AI speech recognition
- [CREPE](https://github.com/marl/crepe) - Pitch detection
