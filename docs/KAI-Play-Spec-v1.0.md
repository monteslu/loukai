
# KAI-Play — Player/Coach App (v1.0)

**Status:** Implementation Spec (initial)  
**Date:** 2025-09-07T18:27:15Z  
**Targets:** Linux, Windows, macOS  
**License:** AGPLv3 recommended (choose to match dependencies)

## 1. Scope
- Load `.kai` v1.0
- Parse **`song.json` only** (no `manifest.json`); read `audio` and `meta`
- **Real-time stem toggling (mute/solo) for every stem, including `vocals`**
- Dual-output routing (PA + IEM) with independent per-bus toggles
- Real-time mic with optional auto-tune (pre-analyzer tap)
- Live coaching (pitch, timing, stability) and scoring
- Multi-singer support (if present)
- **Lyrics editor with line-by-line editing and disabled lyric support**
- **Atomic save/reload workflow for lyrics modifications**

## 2. Architecture
- UI: Electron; WebAudio for visualization only
- Audio: Native engine (PortAudio via N-API) for low-latency I/O and dual-device routing
- DSP: WASM pitch shifter (Bungee or Rubber Band WASM), CREPE/pYIN detector

## 3. Stems mixing & toggling
- Build channel strips from `song.json.audio.sources[]`.
- Mute/Solo per stem; **PA**/**IEM** mute per stem (clickless ramps).
- Apply `audio.presets[]` and expose A/B scene recall.

## 4. Metadata & display
- Show `song.song.title/artist/album`.
- If `meta.id3.include_raw=false`, UI hides raw frame details.
- Optionally display `meta.processing` (model names/versions) in an “Info” dialog.

## 5. Latency
- End-to-end monitor ≤ 20–30 ms target; loopback calibration; XRuns panel

## 6. Auto-Tune (OSS)
- Detector: CREPE-tiny or pYIN; targets from `song.json` / `features/*notes_ref.json` / `vocals_f0.json`
- Shifter: Bungee or Rubber Band; controls for retune, strength, max correction, scale

## 7. Coaching & Scoring
- Pitch cents error vs. reference; timing vs. onsets/word starts; stability on sustains

## 8. File handling
- Respect `timing.offset_sec` and `audio.encoder_delay_samples`; pre-buffer stems
- Support `disabled` property in lyrics lines for selective display/editing

## 8.1. Lyrics Editor
- **Line-by-line editing**: Individual lyric line start/end times and text content
- **Toggle disable/enable**: Hide lyrics during playback while preserving in editor
- **Atomic save/reload**: Complete file rewrite with automatic UI refresh after save
- **Field compatibility**: Use KAI format field names (`start`/`end` not `start_time`/`end_time`)
- **Export functionality**: Text export of edited lyrics content

## 8.2. Outro Detection
- **Disabled lyric handling**: Outro detection uses original lyrics data, not filtered display data
- **Timing calculation**: Last enabled lyric determines outro start, regardless of disabled lines after it

## 9. Packaging
- Electron Builder for Win/Mac/Linux; bundle PortAudio

## 10. Testing
- Latency self-test; golden `.kai` fixtures; rapid toggle stress; schema parse of `song.json`
- Lyrics editor save/reload cycle validation; disabled lyric state preservation
- Outro detection with mixed enabled/disabled lyrics at song end
