# Loukai M4A Stems Format

Loukai uses an open karaoke format based on [Native Instruments' Stems](https://www.native-instruments.com/en/specials/stems/) `.stem.m4a` format with karaoke-specific extensions.

## Overview

The format is a standard MPEG-4 container (`.m4a`) containing:

- **Multiple audio tracks** (stems) in AAC format
- **Standard MP4 metadata** (title, artist, album, key, etc.)
- **Custom atoms** for karaoke data (lyrics, pitch, onsets)

This approach ensures compatibility with DJ software (Traktor, Mixxx) while adding karaoke functionality.

## Why This Format?

| Feature | Loukai M4A | Proprietary Karaoke | CDG |
|---------|------------|---------------------|-----|
| Open standard | ✅ MPEG-4 | ❌ Vendor-specific | ✅ But limited |
| Stem separation | ✅ 4 stems | ❌ Usually not | ❌ No |
| DJ software compatible | ✅ Yes | ❌ No | ❌ No |
| Word-level lyrics | ✅ Yes | ✅ Usually | ❌ No |
| Pitch data | ✅ Yes | ❌ Rarely | ❌ No |
| Single file | ✅ Yes | ✅ Usually | ❌ MP3+CDG pair |
| File size | Small (AAC) | Varies | Large (uncompressed) |

## File Structure

```
song.stem.m4a
├── ftyp          # File type (M4A)
├── moov          # Movie header
│   ├── mvhd      # Movie header data
│   ├── trak[0]   # Audio track 0 - Master (original full mix)
│   ├── trak[1]   # Audio track 1 - Drums
│   ├── trak[2]   # Audio track 2 - Bass
│   ├── trak[3]   # Audio track 3 - Other (instruments, melody)
│   ├── trak[4]   # Audio track 4 - Vocals
│   └── udta      # User data (standard metadata)
├── mdat          # Media data (compressed audio)
├── kara          # Karaoke atom (lyrics, timing, audio config)
├── vpch          # Vocal pitch atom (CREPE pitch data)
└── kons          # Karaoke onsets atom (word timing)
```

The master track (track 0) contains the original full mix for backward compatibility with standard audio players.

## Audio Tracks

Following the [Native Instruments Stems](https://www.native-instruments.com/en/specials/stems/) specification:

| Track | Content | Typical Use |
|-------|---------|-------------|
| 0 | Master | Original full mix (for backward compatibility) |
| 1 | Drums | Rhythm reference |
| 2 | Bass | Low-end support |
| 3 | Other | Melody, instruments |
| 4 | Vocals | Mute for karaoke, solo for practice |

Audio is encoded as AAC at 192kbps per track.

## Custom Atoms

### `kara` - Karaoke Data

Contains lyrics, timing, audio configuration, and singer metadata in JSON format:

```json
{
  "audio": {
    "sources": [
      { "id": "master", "role": "master", "track": 0 },
      { "id": "drums", "role": "drums", "track": 1 },
      { "id": "bass", "role": "bass", "track": 2 },
      { "id": "other", "role": "other", "track": 3 },
      { "id": "vocals", "role": "vocals", "track": 4 }
    ],
    "profile": "STEMS-4",
    "encoder_delay_samples": 0
  },
  "timing": {
    "offset_sec": 0
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

#### Singer Metadata (Optional)

The `singers` object and `line.singer` field enable multi-singer karaoke support, including backup vocals that can play through the PA system.

**`singers` object (optional):**

Defines metadata for each singer identifier:

```json
"singers": {
  "A": { "name": "Rockwell" },
  "B": { "name": "Michael Jackson" },
  "duet": { "name": "Both", "color": "#22C55E" }
}
```

- Keys are singer identifiers (`A`, `B`, `duet`, etc.)
- `name`: Display name for the singer (optional)
- `color`: Hex color for lyrics display (optional)

**`line.singer` field (optional):**

Each lyric line can specify which singer performs it:

| Value | Meaning | Display | Audio Behavior |
|-------|---------|---------|----------------|
| *(omitted)* | Default lead singer | Normal color | Vocals muted on PA |
| `"A"` | Lead singer A | Normal color | Vocals muted on PA |
| `"B"` | Singer B (duets) | Different color | Vocals muted on PA |
| `"duet"` | Both singers | Green | Vocals muted on PA |
| `"backup"` | Backup vocals | Dimmed/grey | Vocals muted on PA |
| `"backup:PA"` | Backup with punchthrough | Dimmed + icon | **Vocals play through PA** |

**Example - "Somebody's Watching Me" by Rockwell:**

```json
{
  "singers": {
    "A": { "name": "Rockwell" },
    "B": { "name": "Michael Jackson" }
  },
  "lines": [
    { "start": 12.0, "end": 15.2, "text": "I'm just an average man" },
    { "start": 45.0, "end": 48.5, "text": "I always feel like somebody's watching me", "singer": "backup:PA" },
    { "start": 52.0, "end": 55.0, "text": "And I have no privacy", "singer": "backup:PA" }
  ]
}
```

In this example:
- Lines without `singer` are performed by the karaoke singer (Rockwell's parts)
- Lines with `"backup:PA"` play Michael Jackson's original vocals through the PA

**Backward Compatibility:**

Files without `singers` or `line.singer` fields work exactly as before - all lines are treated as lead vocals with the standard karaoke behavior.

#### Tags (Optional)

The `tags` array provides searchable labels for filtering and organizing songs:

```json
{
  "tags": ["edited", "ai_corrected", "favorite", "needs_review"]
}
```

**Standard tags added automatically:**

| Tag | When Added |
|-----|------------|
| `edited` | Song was manually edited in the Song Editor |
| `ai_corrected` | LLM made corrections to lyrics during creation |

**Custom tags:**

Users can add any custom tags for their own organization. Tags are simple lowercase strings.

### `vpch` - Vocal Pitch

Contains pitch detection data from CREPE analysis:

```json
{
  "sampleRate": 100,
  "data": [
    { "midi": 60, "cents": 0 },
    { "midi": 62, "cents": 15 },
    { "midi": 0, "cents": 0 },
    ...
  ]
}
```

- `sampleRate`: Pitch samples per second (typically 100 Hz)
- `midi`: MIDI note number (0 = unvoiced/silent)
- `cents`: Pitch deviation from note center (-50 to +50)

### `kons` - Karaoke Onsets

Contains word onset times for highlighting:

```json
[0.5, 1.2, 1.8, 2.3, 3.1, ...]
```

Array of timestamps (in seconds) marking the start of each word.

## Standard Metadata

Loukai preserves and uses standard MP4/ID3 metadata:

| Field | Description |
|-------|-------------|
| `title` | Song title |
| `artist` | Performing artist |
| `album` | Album name |
| `album_artist` | Album artist |
| `composer` | Songwriter |
| `genre` | Music genre |
| `date` | Release year |
| `track` | Track number |
| `initialkey` | Musical key (e.g., "C major", "A minor") |
| `bpm` | Tempo in beats per minute |

## Creating Files

### Using Loukai Creator (Recommended)

1. Open Loukai → **Creator** tab
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

// Write karaoke data
await Atoms.writeKaraAtom('song.stem.m4a', {
  audio: { sources: [...], profile: 'STEMS-4' },
  lines: [{ start: 0, end: 3, text: 'Lyrics here' }]
});

// Write pitch data
await Atoms.writeVpchAtom('song.stem.m4a', {
  sampleRate: 100,
  data: [{ midi: 60, cents: 0 }, ...]
});

// Write onsets
await Atoms.writeKonsAtom('song.stem.m4a', [0.5, 1.2, 1.8, ...]);
```

## Reading Files

```javascript
import { Atoms } from 'm4a-stems';

const kara = await Atoms.readKaraAtom('song.stem.m4a');
const pitch = await Atoms.readVpchAtom('song.stem.m4a');
const onsets = await Atoms.readKonsAtom('song.stem.m4a');
```

## Compatibility

### DJ Software (Full Stem Support)
- **Native Instruments Traktor**: Full stem support - control each stem independently
- **Mixxx**: Free and open source DJ software with full stem support

### Audio Players
Any player supporting M4A/AAC will play the master track (track 0). The stems and karaoke atoms are ignored by software that doesn't understand them, ensuring backward compatibility.

### Loukai
Full support for all features: stems, lyrics, pitch display, onset highlighting.

## File Extension

- `.stem.m4a` - Preferred, indicates stem content
- `.m4a` - Also supported, Loukai auto-detects karaoke atoms

## References

- [Native Instruments Stems Format](https://www.native-instruments.com/en/specials/stems/)
- [MPEG-4 Part 14 (MP4)](https://en.wikipedia.org/wiki/MP4_file_format)
- [m4a-stems npm package](https://www.npmjs.com/package/m4a-stems)
- [Demucs](https://github.com/facebookresearch/demucs) - AI stem separation
- [Whisper](https://github.com/openai/whisper) - AI speech recognition
- [CREPE](https://github.com/marl/crepe) - Pitch detection
