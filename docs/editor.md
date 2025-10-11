# Song Editor - Development Notes

## Current Status (2025-10-03)

### Implemented Features

#### Visual Components
- **Dual Canvas System**
  - Main song canvas (3800x120px) showing full song waveform with lyric line rectangles
  - Line detail canvas (3800x120px) showing zoomed view of selected line with word timing rectangles
  - Both canvases always visible (detail canvas empty when no line selected)
  - Waveform resolution: 3800 samples (1:1 pixel-to-sample ratio for optimal detail)

#### Waveform Visualization
- White waveform on black/dark background (rgba(0, 0, 0, 0.5))
- Mirrored top/bottom display with center line
- Main canvas: Shows entire song duration
- Detail canvas: Shows only selected line segment, stretched across full width

#### Lyric Line Rendering (Main Canvas)
- Blue rectangles for lead vocals (rgba(0, 100, 255, 0.35))
- Yellow rectangles for backup vocals (rgba(255, 200, 0, 0.35))
- Selected line outline: Cyan for regular lines (rgba(0, 255, 255, 0.9)), yellow for backup
- Rectangles use 90% of canvas height with 5% top/bottom margin
- Click-to-select functionality with smooth scroll to selected line

#### Word Timing Visualization (Detail Canvas)
- Green rectangles showing word boundaries (rgba(0, 255, 100, 0.35))
- Word timings are relative to line start time (per KAI format spec)
- Same rectangle proportions as line rectangles (90% height, 5% margins)

#### Playback Controls
- White playhead with triangular tic marks (10% canvas height)
- Audio playback of individual lines via line number clicks
- Automatic stop at line end time

#### Keyboard Shortcuts
- `q` - Select previous enabled line
- `o` - Select next enabled line
- `p` - Play current selected line
- `a` - Decrease start time by 0.1s
- `s` - Increase start time by 0.1s
- `k` - Decrease end time by 0.1s
- `l` - Increase end time by 0.1s
- Shortcuts only active on lyrics tab with song loaded
- Disabled when typing in input fields

#### Metadata Editing
- Title, artist, album, year, genre, key
- Form with validation
- Saves back to KAI file format

#### Lyrics Editing
- Individual line editing with start/end times
- Enable/disable lines (hidden during playback, preserved in file)
- Lead vs backup singer designation
- Text editing

#### Audio Playback (Electron Renderer)
- Fixed blob URL generation from audio buffers
- Multiple audio track support (vocals, drums, bass, other)
- Synchronized playback across tracks

### Technical Implementation

#### File Structure
- `src/shared/components/SongEditor.jsx` - Main editor component
- `src/shared/components/LyricsEditorCanvas.jsx` - Full song canvas with line rectangles
- `src/shared/components/LineDetailCanvas.jsx` - Zoomed line view with word rectangles
- `src/shared/components/SongEditor.css` - Styling
- `src/renderer/adapters/ElectronBridge.js` - IPC bridge for Electron

#### Waveform Analysis
- Web Audio API: decodeAudioData + getChannelData
- Downsampled to 3800 samples via max amplitude per window
- Stored as Int8Array (values 0-127)
- Analysis runs once on song load

#### Canvas Rendering
- 3800x120px resolution
- Direct 2D context drawing (no libraries)
- Redraws on: song load, line selection, playback position, data changes
- Efficient re-rendering via React useEffect dependencies

#### Bridge Pattern
- ElectronBridge: IPC communication with Electron main process
- Creates blob URLs from audio buffers for Audio element playback
- Handles KAI file loading via editor.loadKai IPC method

### KAI Format Integration
- Reads/writes KAI v1.0 format
- Word timings: `[[start, end], ...]` relative to line start
- Line properties: `start`, `end`, `text`, `word_timing`, `disabled`, `backup`
- Metadata in `song.song` object
- Audio sources from `song.audio.sources[]`

### Known Limitations / TODO

#### Word Timing Editing
- Currently read-only visualization
- Need to implement:
  - Click/drag to adjust word boundaries
  - Split/merge words
  - Add/remove word timing marks
  - Visual feedback during editing

#### Missing Features
- Undo/redo functionality
- Copy/paste lines
- Bulk operations (select multiple lines)
- Auto-scroll during playback
- Zoom controls for canvases
- Waveform zoom in/out
- Time ruler/grid overlay
- Snap-to-grid for timing adjustments

#### Audio Features
- No volume controls for individual tracks during editing
- No waveform for non-vocals tracks
- No audio scrubbing (click canvas to seek)

#### Performance
- No virtualization for long song lists
- Full canvas redraws (could optimize with dirty regions)

#### UX Improvements
- No loading states during waveform analysis
- No error recovery for failed audio decoding
- Canvas spacing could be further optimized

### Color Scheme
- Background: Black/dark gray (rgba(0, 0, 0, 0.5))
- Waveform: White (#ffffff)
- Lead vocals: Blue (rgba(0, 100, 255, 0.35))
- Backup vocals: Yellow (rgba(255, 200, 0, 0.35))
- Selected outline: Cyan (rgba(0, 255, 255, 0.9))
- Word timing: Green (rgba(0, 255, 100, 0.35))
- Playhead: White (rgba(255, 255, 255, 0.9))

### Recent Changes
- 2025-10-03: Increased waveform samples from 1000 to 3800 for better detail
- 2025-10-03: Changed selected line outline to cyan for better contrast
- 2025-10-03: Refactored LineDetailCanvas to use rectangle rendering like main canvas
- 2025-10-03: Updated detail canvas to always render (empty until line selected)
- 2025-10-03: Reduced canvas container spacing (border-radius: 3px, margin: 2px)

### Next Steps (Proposed)
1. Implement word timing editing (click/drag boundaries)
2. Add audio scrubbing (click canvas to seek)
3. Add time ruler with second markers
4. Implement undo/redo stack
5. Add keyboard shortcuts for word timing navigation
6. Add waveform zoom controls
7. Add snap-to-grid option for timing adjustments
