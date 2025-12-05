# Kai Player Creator - Design Document

Integration of karaoke file creation into kai-player. This document captures the architecture and implementation progress.

---

## Implementation Status

### ✅ Completed

| Component | Status | Notes |
|-----------|--------|-------|
| Create tab UI | ✅ Done | Full workflow with progress |
| Component checker | ✅ Done | Detects Python, PyTorch, models |
| Download manager | ✅ Done | Installs Python, packages, models |
| Demucs runner | ✅ Done | Stem separation with tqdm progress |
| Whisper runner | ✅ Done | Transcription with word timestamps |
| CREPE runner | ✅ Done | Pitch detection |
| FFmpeg service | ✅ Done | WAV conversion, AAC encoding, ID3 reading |
| LRCLIB service | ✅ Done | Lyrics lookup with auto-search |
| Stem builder | ✅ Done | Builds .stem.m4a with custom atoms |
| Conversion pipeline | ✅ Done | Full pipeline orchestration |
| IPC handlers | ✅ Done | Electron IPC for renderer |
| Web admin routes | ✅ Done | HTTP API for web admin |
| Shared service | ✅ Done | Same backend for IPC and HTTP |
| Progress reporting | ✅ Done | Real-time step-by-step progress |

### 🔄 In Progress / TODO

| Component | Status | Notes |
|-----------|--------|-------|
| LLM setup prompt | ❌ Not started | Prompt user to configure LLM API key on first use (like kai-converter) |
| LLM lyrics correction | ❌ Not started | Compare Whisper output to LRCLIB, fix misheard words |
| Console output piping | ❌ Investigate | Pipe raw demucs/whisper console output to UI log panel |
| Batch processing | ❌ Not started | Queue multiple files |
| Worker thread | ❌ Not started | Currently runs in main process |
| Add to library | ❌ Not started | Auto-add created files |

### Investigation Notes

**Console Output Piping**
Currently we parse PROGRESS: lines and tqdm patterns from stderr. Could alternatively:
- Pipe raw stderr to a log panel in the UI (like kai-converter)
- Show both parsed progress bar AND raw console output
- Helps debugging and gives users visibility into what's happening

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Main Process                        │
├─────────────────────────────────────────────────────────────────┤
│  creatorHandlers.js (IPC)     webServer.js (HTTP)               │
│           ↓                          ↓                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              creatorService.js (Shared)                  │    │
│  │  ├── checkComponents()     - Verify all installed        │    │
│  │  ├── installComponents()   - Download/install all        │    │
│  │  ├── getFileInfo()         - Read ID3, auto LRCLIB       │    │
│  │  ├── startConversion()     - Run full pipeline           │    │
│  │  └── stopConversion()      - Cancel in progress          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Conversion Pipeline (conversionService.js)              │    │
│  │  1. [1/7 Prepare]  FFmpeg → WAV                          │    │
│  │  2. [2/7 Stems]    Python → Demucs → 4 stem WAVs         │    │
│  │  3. [3/7 Context]  Extract vocabulary from LRCLIB        │    │
│  │  4. [4/7 Lyrics]   Python → Whisper → word timestamps    │    │
│  │  5. [5/7 Pitch]    Python → CREPE → pitch data           │    │
│  │  6. [6/7 Encode]   FFmpeg → AAC stems                    │    │
│  │  7. [7/7 Build]    Mux stems + atoms → .stem.m4a         │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

### Installation Location

**Changed from cache to config directory** (installed components are not expendable):

```
Linux:   ~/.config/loukai/creator/
macOS:   ~/Library/Application Support/loukai/creator/
Windows: ~/AppData/Local/loukai/creator/
```

### Directory Layout

```
~/.config/loukai/
├── settings.json           # App settings
├── app-state.json          # Playback state
├── library-cache.json      # Library cache
└── creator/                # AI tools (on-demand install)
    ├── python/             # Python 3.12 standalone
    │   └── bin/python3
    ├── models/
    │   ├── torch/          # PyTorch cache (TORCH_HOME)
    │   └── huggingface/    # Demucs models (HF_HOME)
    ├── whisper/            # Whisper models
    └── ffmpeg/             # FFmpeg binary (if not system)
```

---

## Installation Components

| Step | Component | Size | Notes |
|------|-----------|------|-------|
| 1 | Python 3.12 | ~50 MB | python-build-standalone |
| 2 | PyTorch | ~2 GB | Auto-detects CUDA/MPS/CPU |
| 3 | TorchCodec | ~10 MB | Required by torchaudio |
| 4 | Demucs | ~100 MB | Stem separation |
| 5 | Whisper | ~50 MB | openai-whisper package |
| 6 | CREPE | ~20 MB | torchcrepe package |
| 7 | FFmpeg | ~80 MB | If not system-installed |
| 8 | Whisper Model | ~1.5 GB | large-v3-turbo |
| 9 | Demucs Model | ~300 MB | htdemucs_ft |

**Total: ~4 GB download, ~5 GB disk space**

---

## Python Scripts

### demucs_runner.py

Stem separation with tqdm progress parsing:

```python
# Input: {"input": "path.wav", "output_dir": "path", "model": "htdemucs_ft"}
# Output: {"success": true, "stems": {"vocals": "path", "drums": "path", ...}}
# Progress: tqdm output parsed by Node.js for real-time updates
```

Progress shows:
```
[2/7 Stems] Separating 🥁 Drums + 🎸 Bass + 🎹 Other + 🎤 Vocals (5/28)
[2/7 Stems] Saving 🎤 Vocals
[2/7 Stems] ✓ Saved 4 stems
```

### whisper_runner.py

Transcription with word-level timestamps:

```python
# Input: {"input": "vocals.wav", "model": "large-v3-turbo", "language": "en"}
# Output: {"success": true, "words": [...], "lines": [...]}
```

Settings:
- `word_timestamps: true` - Essential for karaoke
- `no_speech_threshold: 0.3` - Lower to catch more vocals
- `condition_on_previous_text: false` - Prevents repetition in singing
- `initial_prompt` - Vocabulary hints from LRCLIB

### crepe_runner.py

Pitch detection for vocal scoring:

```python
# Input: {"input": "vocals.wav", "model": "full"}
# Output: {"success": true, "pitch_data": {...}, "voiced_percent": 67}
```

---

## Progress Protocol

### Python → Node.js

Python scripts output to stderr:

```
PROGRESS:percent:message
```

Node.js parses both PROGRESS lines and tqdm progress bars:

```javascript
// Parse: "PROGRESS:45:Separating stems"
// Parse: " 14%|█▍        | 4/28 [00:10<01:02]"
```

### Conversion Steps

| Step | Range | Label |
|------|-------|-------|
| WAV conversion | 0-5% | [1/7 Prepare] |
| Demucs | 5-50% | [2/7 Stems] |
| Whisper context | 50-52% | [3/7 Context] |
| Whisper | 52-80% | [4/7 Lyrics] |
| CREPE | 80-90% | [5/7 Pitch] |
| AAC encoding | 90-95% | [6/7 Encode] |
| M4A packaging | 95-100% | [7/7 Build] |

---

## .stem.m4a Format

### Structure

```
song.stem.m4a
├── ftyp: M4A brand
├── moov (metadata container)
│   ├── Audio tracks (all AAC, some disabled)
│   ├── Subtitle track (WebVTT lyrics, optional)
│   └── udta (user data)
│       └── meta (iTunes metadata)
├── mdat (media data)
└── Custom atoms (appended):
    ├── kaid (Karaoke ID - JSON metadata)
    ├── kons (Karaoke Onsets - word timestamps)
    ├── vpch (Vocal Pitch - compressed pitch data)
    └── stem (NI Stems compatibility)
```

### kaid Atom (JSON)

```json
{
  "version": 1,
  "format": "stem.m4a",
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 213.5,
  "stems": ["drums", "bass", "other", "vocals"],
  "createdAt": "2024-12-04T...",
  "creator": "Loukai",
  "tags": { /* all original ID3 tags */ }
}
```

### kons Atom (JSON)

```json
{
  "version": 1,
  "language": "en",
  "words": [
    {"w": "Hello", "s": 1234, "e": 1567, "c": 0.95},
    ...
  ],
  "segments": [...]
}
```

### vpch Atom (JSON with compressed data)

```json
{
  "version": 1,
  "sampleRate": 100,
  "frequencies": "base64_delta_encoded_midi_notes",
  "confidence": "base64_quantized_confidence"
}
```

---

## ID3 Tag Preservation

All original ID3 tags are:
1. Read via ffprobe in `getAudioInfo()`
2. Passed through the conversion pipeline
3. Written to output M4A via ffmpeg `-metadata` flags
4. Stored in kaid atom for player access

Standard tags preserved:
- title, artist, album, album_artist
- composer, genre, date/year
- track, disc, comment, copyright
- publisher, language, bpm, isrc
- And any additional tags

---

## Auto LRCLIB Lookup

When a file is selected:

1. **Read ID3 tags** via ffprobe
2. **Parse filename** if no tags (Artist - Title.mp3)
3. **Auto-search LRCLIB** if both artist and title found
4. **Return plain lyrics** (not synced) for Whisper hints
5. **Pre-fill reference lyrics** field in UI

---

## IPC Channels

```javascript
const CREATOR_CHANNELS = {
  CHECK_COMPONENTS: 'creator:check-components',
  GET_STATUS: 'creator:get-status',
  INSTALL_COMPONENTS: 'creator:install-components',
  INSTALL_PROGRESS: 'creator:install-progress',
  INSTALL_ERROR: 'creator:install-error',
  CANCEL_INSTALL: 'creator:cancel-install',
  SELECT_FILE: 'creator:select-file',
  SEARCH_LYRICS: 'creator:search-lyrics',
  PREPARE_WHISPER_CONTEXT: 'creator:prepare-whisper-context',
  START_CONVERSION: 'creator:start-conversion',
  CONVERSION_PROGRESS: 'creator:conversion-progress',
  CONVERSION_COMPLETE: 'creator:conversion-complete',
  CONVERSION_ERROR: 'creator:conversion-error',
  CANCEL_CONVERSION: 'creator:cancel-conversion',
};
```

---

## HTTP API (Web Admin)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/creator/status` | GET | Get install/conversion status |
| `/admin/creator/install` | POST | Start component installation |
| `/admin/creator/cancel-install` | POST | Cancel installation |
| `/admin/creator/search-lyrics` | POST | Search LRCLIB |
| `/admin/creator/file-info` | POST | Get file info (requires path) |
| `/admin/creator/convert` | POST | Start conversion |
| `/admin/creator/cancel-convert` | POST | Cancel conversion |

Socket.IO events:
- `creator:install-progress`
- `creator:install-error`
- `creator:conversion-progress`
- `creator:conversion-complete`
- `creator:conversion-error`

---

## UI Tabs

```
Player | Library | Audio | Effects | Requests | Server | Create | Edit
                                                         ↑        ↑
                                                    ⚡ Create  ✏️ Edit
```

Create tab states:
1. **Checking** - Verifying components
2. **Setup** - Components missing, show install button
3. **Installing** - Download progress
4. **Ready** - Full create interface
5. **Creating** - Conversion progress
6. **Complete** - Success, create another

---

## File Structure

```
src/main/creator/
├── systemChecker.js      # Check Python, packages, models
├── downloadManager.js    # Download/install components
├── ffmpegService.js      # WAV/AAC conversion, ID3 reading
├── lrclibService.js      # LRCLIB lyrics lookup
├── pythonRunner.js       # Spawn Python scripts, parse output
├── conversionService.js  # Orchestrate full pipeline
├── stemBuilder.js        # Build .stem.m4a with atoms
└── python/
    ├── demucs_runner.py  # Stem separation
    ├── whisper_runner.py # Transcription
    └── crepe_runner.py   # Pitch detection

src/main/handlers/
└── creatorHandlers.js    # IPC handlers

src/shared/services/
└── creatorService.js     # Shared service (IPC + HTTP)

src/renderer/components/creator/
└── CreateTab.jsx         # Full create UI
```

---

## Next Steps

1. **LLM Lyrics Correction**
   - Compare Whisper output to LRCLIB reference
   - Use OpenAI/Anthropic/Google SDKs
   - Fix misheard words while preserving timing

2. **Worker Thread**
   - Move conversion to worker thread
   - Keep player responsive during creation
   - Better cancellation support

3. **Batch Processing**
   - Queue multiple files
   - Process sequentially or parallel
   - Batch progress UI

4. **Library Integration**
   - Auto-add created files to library
   - "Add to Library" button on complete screen

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Output format | .stem.m4a only | KAI deprecated, Traktor compatible |
| Install location | ~/.config/loukai/creator/ | Not cache - installed components |
| Default model | large-v3-turbo | Best quality, reasonable speed |
| Pitch detection | Default ON | Useful for scoring |
| Stem mode | 4-stem default | More flexibility |
| Progress parsing | Parse tqdm output | No monkey-patching |
