# player.js INVENTORY & ANALYSIS

## Overview
`PlayerController` class in player.js is a **UI controller layer** that orchestrates playback visualization and user interactions. It does NOT handle actual audio playback - that's handled by the audio engines (kaiPlayer, cdgPlayer).

## Core Responsibilities

### 1. UI Element Management
- **Progress Bar** (progressFill, progressHandle, progressBar)
  - Displays current playback position
  - Handles click-to-seek
  - Updates every 100ms during playback

- **Time Display** (currentTime, totalTime)
  - Shows formatted current/total time
  - Updates every 100ms

- **Lyrics Container** (lyricsContainer)
  - DEPRECATED: Simple lyrics display
  - Now replaced by KaraokeRenderer canvas-based lyrics
  - Still has code but not actively used

### 2. Player Orchestration
- Manages **two player types**:
  - `karaokeRenderer` (KaraokeRenderer) - for KAI format
  - `cdgPlayer` (CDGPlayer) - for CDG format
- Tracks `currentFormat` ('kai' or 'cdg')
- Holds reference to `currentPlayer` (unified PlayerInterface)

### 3. State Tracking
- `isPlaying` - playback state (used by 100ms timer)
- `currentPosition` - position in seconds
- `songDuration` - total duration
- `lyrics` - loaded lyrics data

### 4. Playback Position Updates
- **100ms timer** (`updateTimer`) calls `updatePosition()` when playing
- Gets real position from `currentPlayer.getCurrentPosition()`
- Updates:
  - Time displays
  - Progress bar
  - KaraokeRenderer time (`karaokeRenderer.setCurrentTime()`)

## Event Flow Architecture

### Play/Pause Flow
```
1. USER CLICKS PLAY/PAUSE IN REACT UI
   ↓
2. TransportControlsWrapper (React)
   → bridge.play() or bridge.pause()
   ↓
3. ElectronBridge
   → window.kaiAPI.player.play/pause()
   ↓
4. IPC Invoke: 'player:play' or 'player:pause'
   ↓
5. MAIN PROCESS: playerHandlers.js
   → playerService.play/pause(mainApp)
   ↓
6. playerService sends IPC event: 'admin:play'
   ↓
7. RENDERER: main.js listens to kaiAPI.admin.onPlay()
   → calls app.togglePlayback()
   ↓
8. main.js.togglePlayback():
   - Sets isPlaying flag
   - Calls player.currentPlayer.play/pause() (audio engine)
   - Calls player.play/pause() (PlayerController - UI only)
   - Broadcasts state to React via reportStateChange()
   ↓
9. PlayerController.play/pause():
   - Sets isPlaying flag
   - Calls karaokeRenderer.setPlaying(true/false)
   - Does NOT touch audio (comment: "Audio engine is already handled by main.js")
```

### Seek Flow
```
1. USER DRAGS PROGRESS BAR OR REACT SEEK
   ↓
2a. Progress bar click in PlayerController
    → player.seekToProgressPosition()
    → player.setPosition(newPosition)
   OR
2b. React TransportControls
    → bridge.seek(position)
    → IPC 'player:seek'
    → playerService sends 'player:seek' event
    → main.js receives event
    → player.setPosition(position)
   ↓
3. PlayerController.setPosition():
   - Updates currentPosition
   - Calls currentPlayer.seek(position) (audio engine)
   - Calls karaokeRenderer.setCurrentTime(position)
   - Resets karaokeRenderer.lockedUpcomingIndex
   - Updates UI (time, progress bar)
```

### Restart Flow
```
1. USER CLICKS RESTART
   ↓
2. TransportControlsWrapper → bridge.restart()
   ↓
3. IPC 'player:restart' → playerService sends 'admin:restart'
   ↓
4. main.js kaiAPI.admin.onRestart() → app.restartTrack()
   ↓
5. main.js.restartTrack():
   → player.currentPlayer.seek(0)
```

### Next Track Flow
```
1. USER CLICKS NEXT
   ↓
2. TransportControlsWrapper → bridge.playNext()
   ↓
3. IPC 'player:next' → playerService.playNext(mainApp)
   ↓
4. playerService.playNext():
   - Removes current song from queue (appState)
   - Loads next song via mainApp.loadKaiFile()
   ↓
5. main.js.loadSong() loads song → player.onSongLoaded()
```

### Song Load Flow
```
1. main.js.loadSong(songData) called
   ↓
2. Determines format (KAI vs CDG)
   ↓
3a. KAI FORMAT:
   - Sets player.currentFormat = 'kai'
   - Sets player.currentPlayer = kaiPlayer
   - Calls kaiPlayer.loadKaiFile() (audio engine)
   - Reinitializes karaokeRenderer
   - Calls player.onSongLoaded(metadata)

3b. CDG FORMAT:
   - Sets player.currentFormat = 'cdg'
   - Sets player.currentPlayer = cdgPlayer
   - Sets up audio context for CDG
   - Calls cdgPlayer.loadSong(songData)
   - Feeds CDG audio to Butterchurn
   - Calls player.onSongLoaded(metadata)
   ↓
4. PlayerController.onSongLoaded():
   - Resets currentPosition to 0
   - Gets duration from currentPlayer.getDuration()
   - Loads lyrics into karaokeRenderer
   - Loads vocals/music audio for waveforms
   - Updates time/progress displays
   - Calls pause() to ensure stopped state
```

## Audio System Integration

### PlayerController does NOT:
- Play/pause actual audio
- Manage audio routing (PA, IEM outputs)
- Handle microphone input
- Control audio contexts

### Audio engines handle:
- **kaiPlayer (KAI format)**:
  - Loads and plays stems (vocals, music, backing)
  - Manages PA and IEM audio outputs
  - Handles microphone input and auto-tune
  - Uses Web Audio API

- **cdgPlayer (CDG format)**:
  - Loads CDG+MP3 files
  - Plays audio through audio context
  - Renders CDG graphics to canvas
  - Overlays Butterchurn effects

### PlayerController DOES:
- Tell karaokeRenderer when to start/stop visual rendering
- Feed audio data to karaokeRenderer for waveform visualization
- Update karaokeRenderer's time position for lyrics sync

## Butterchurn Integration

PlayerController touches Butterchurn only for:
1. **CDG Background Effects** (main.js lines 446-473):
   - Gets effectsCanvas and butterchurn from karaokeRenderer
   - Passes them to cdgPlayer.setEffectsCanvas()
   - Feeds CDG MP3 audio to karaokeRenderer.setMusicAudio()
   - Triggers random effect if enabled

2. **Waveform Audio**:
   - Extracts vocals/music from song sources
   - Feeds to karaokeRenderer.setVocalsAudio() / setMusicAudio()

**Actual Butterchurn management** is in:
- `karaokeRenderer.js` - initialization, preset loading, rendering
- `EffectsPanelWrapper.jsx` - preset selection, enable/disable
- `main.js` - random effect triggers

## Message Flow Summary

### IPC Events (Main ↔ Renderer)
**Renderer → Main (Invoke):**
- `player:play` → togglePlayback()
- `player:pause` → togglePlayback()
- `player:seek` → setPosition()
- `player:restart` → seek(0)
- `player:next` → load next from queue

**Main → Renderer (Send):**
- `admin:play` → togglePlayback()
- `admin:restart` → restartTrack()
- `player:seek` → setPosition()

### Socket.IO Events (Renderer ↔ Web Admin)
**Broadcaster:** main.js via IPC → main process → webServer → socket.io

**Events broadcast:**
- `playback-state` - isPlaying, position, duration
- `current-song` - song metadata
- `queue-update` - queue changes

**Web admin sends commands via REST/IPC** (same flow as React transport controls)

### React Component Events
**ElectronBridge publishes:**
- `onPlaybackStateChanged` - from IPC playback:state
- `onCurrentSongChanged` - from IPC song:loaded
- `onQueueChanged` - from IPC queue:updated

**TransportControlsWrapper subscribes** and calls bridge methods

## What Can Be Refactored

### Already in React ✅
- Transport controls (TransportControlsWrapper)
- Progress bar visualization (in PlayerControls)
- Time display (in PlayerControls)
- Play/Pause/Restart/Next buttons

### Still in player.js (Vanilla JS)
1. **Progress bar click-to-seek** (player.js:56-60)
   - Can move to PlayerControls.jsx

2. **100ms position update timer** (player.js:44-50)
   - Should stay - but could be in a React hook

3. **Song loading orchestration** (player.js:69-144)
   - Complex logic, interacts with audio engines
   - Probably stays in main.js, not player.js

4. **Lyrics container rendering** (player.js:150-185)
   - DEPRECATED - can delete
   - KaraokeRenderer does canvas-based lyrics now

### What Should Stay in player.js
- Minimal controller for PlayerInterface coordination
- Could be simplified to just:
  - Track currentPlayer
  - Track currentFormat
  - Forward commands to currentPlayer
  - Bridge between audio engines and UI

## Dependencies to Watch

### player.js depends on:
- KaraokeRenderer (creates instance)
- CDGPlayer (creates instance)
- kaiPlayer reference (passed to constructor)
- DOM elements (progress bar, time displays, lyrics container)
- main.js for actual playback control

### main.js depends on player.js for:
- player.currentPlayer reference
- player.karaokeRenderer reference
- player.onSongLoaded() to initialize UI
- player.play/pause() for UI state
- player.setPosition() for seeking

## Potential Refactor Strategy

### Phase 1: Move UI to React
1. Move progress bar click handler to PlayerControls
2. Move 100ms timer to React hook in TransportControlsWrapper
3. Delete deprecated lyrics container rendering

### Phase 2: Simplify PlayerController
1. Remove all DOM element references
2. Remove all direct UI updates
3. Keep only:
   - currentPlayer/currentFormat tracking
   - PlayerInterface command forwarding
   - Song loading coordination with audio engines

### Phase 3: Consider merging into main.js
- PlayerController might not need to be separate class
- Could be methods on KaiPlayerApp
- Or simplified into a player state manager

## Key Insights

1. **PlayerController is a UI controller, not an audio controller**
   - All actual playback is in kaiPlayer/cdgPlayer
   - PlayerController just coordinates UI updates

2. **Circular event flow**
   - User → React → IPC → Main → IPC → main.js → PlayerController
   - This could be simplified

3. **KaraokeRenderer is separate**
   - Handles all canvas rendering (lyrics, waveforms, effects)
   - PlayerController just feeds it time/audio data

4. **Two player types require branching**
   - PlayerInterface abstraction helps
   - Still have format-specific code in main.js

5. **Progress bar has dual implementation**
   - PlayerControls.jsx has visual
   - player.js has click handler
   - Should consolidate

## Files Involved

### Core Player Files
- `src/renderer/js/player.js` - PlayerController class (UI orchestration)
- `src/renderer/js/main.js` - KaiPlayerApp (main app logic)
- `src/renderer/js/kaiPlayer.js` - KAI audio engine
- `src/renderer/js/cdgPlayer.js` - CDG audio engine
- `src/renderer/js/karaokeRenderer.js` - Canvas renderer
- `src/renderer/js/PlayerInterface.js` - Base class for players

### React Components
- `src/renderer/components/TransportControlsWrapper.jsx` - Transport controls state
- `src/shared/components/PlayerControls.jsx` - Transport controls UI
- `src/renderer/adapters/ElectronBridge.js` - IPC bridge

### IPC/Services
- `src/main/handlers/playerHandlers.js` - IPC handlers
- `src/shared/services/playerService.js` - Playback business logic
- `src/main/preload.js` - IPC API exposure

### Web Integration
- `src/main/webServer.js` - Socket.IO broadcaster
- `src/web/App.jsx` - Web admin (receives socket events)
