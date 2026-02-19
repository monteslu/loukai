# Loukai Karaoke

🌐 **[https://loukai.com](https://loukai.com)**

**Free and open source karaoke software for playing and creating stem-based karaoke files from your own music**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![React 19](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![Electron 38](https://img.shields.io/badge/Electron-38-blue)](https://www.electronjs.org/)
[![Tests](https://img.shields.io/badge/tests-283-green)](./docs/PHASE2-SUMMARY.md)

Loukai is a free, open source karaoke software that runs locally on your computer to **play** and **create** karaoke files from your own music. Built on M4A Stems (MPEG-4 multi-track audio), it uses industry-standard formats compatible with DJ software, giving you full control over your personal karaoke library.

**Key highlights:**
- **Open Format**: Built on NI Stems — no vendor lock-in, works with Traktor, Mixxx, and other DJ software
- **Create Your Own**: Built-in Creator processes your audio files into stem-separated karaoke with AI-transcribed lyrics
- **Play Anywhere**: Cross-platform desktop app (Linux, Windows, macOS) with web remote control
- **Fully Open Source**: AGPL-3.0 licensed — inspect, modify, and contribute

![Loukai Application](./Loukai_app.png)

---

## Features

### Audio & Playback
- **M4A Stems Format (Primary)**: Built on [NI Stems](https://www.native-instruments.com/en/specials/stems/) with karaoke extensions
  - Compatible with DJ software (Traktor, Mixxx) via standard NI Stems metadata
  - Smaller file sizes than legacy formats
  - Embedded lyrics with word-level timing in custom atoms
- **Real-Time Stem Control**: Individual volume, mute, and solo controls for vocals, drums, bass, and other stems
- **Legacy Format Support**: CDG/MP3 pairs
- **Dual Output Routing**: Independent PA and IEM (in-ear monitor) outputs with per-stem routing
- **High-Quality Audio**: Web Audio API with real-time processing and pitch correction
- **Auto-Tune System**: Real-time pitch correction for microphone input
  - AudioWorklet processing (< 5ms latency)
  - Autocorrelation pitch detection (80-800 Hz vocal range)
  - Musical key support (12 major keys with scale snapping)
  - Adjustable strength and speed parameters
  - Phase vocoder architecture prepared for future enhancement
- **Queue Management**: Add, remove, reorder songs with drag-and-drop

### Visual Effects
- **Butterchurn Integration**: 200+ Milkdrop-style audio-reactive visualizations
- **CDG Graphics**: Classic karaoke graphics rendering with full format support
- **Canvas Window**: Dedicated fullscreen window for visuals with multi-monitor support
- **Lyric Display**: Real-time synchronized lyrics with customizable styling
- **QR Code Display**: Scannable QR code on canvas for easy mobile device connection (configurable)
- **Queue Display**: "Next up" overlay showing upcoming 1-3 songs with singer names (configurable)
- **Singer Identification**: Color-coded singer names (yellow for guests, white for KJ)

### Library & Search
- **Fast Library Scanning**: Automatic metadata extraction from thousands of songs
- **M4A Stems Native**: Optimized for MPEG-4 multi-track audio with full metadata support
- **Legacy Format Support**: Also reads CDG/MP3 pairs
- **Smart Search**: Fuzzy search across titles, artists, and albums
- **Alphabet Navigation**: Quick filtering by first letter
- **Pagination**: Efficient handling of large libraries (tested with 23K+ songs)

### Web Admin Interface
- **Remote Control**: Full player control from any device on the network
- **Song Requests**: Allow singers to browse and request songs remotely
- **Request Management**: Approve/reject song requests with real-time notifications
- **QR Code Access**: Scan QR code from canvas for instant mobile connection
- **WebRTC Streaming**: Stream audio and video to remote devices (optional)
- **Multi-Device Sync**: Real-time state synchronization via Socket.IO

### Mixer & Editor
- **Advanced Mixer**: Per-stem gain control, routing, and effects
- **Preset Management**: Save and load mixer presets
- **Lyrics Editor**: Edit lyrics line-by-line with timing adjustments
- **Song Metadata Editor**: Update title, artist, album, and other metadata

### Developer Features
- **Modern Stack**: React 19, Vite 7, Electron 38
- **Comprehensive Testing**: 52% code coverage with Vitest
- **ESLint + Prettier**: Automated code formatting and linting
- **Pre-commit Hooks**: Husky + lint-staged for quality assurance
- **Hot Module Replacement**: Fast development with Vite HMR

---

## Quick Start

### Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+** or **yarn 1.22+**
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/monteslu/loukai.git
cd loukai

# Install dependencies
npm install
```

### Development

```bash
# Start the Electron app in dev mode with hot reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui

# Lint code
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Building

```bash
# Build all assets (renderer + web)
npm run build:all

# Build for Linux (AppImage x64/ARM64 + Flatpak x64/ARM64)
npm run build:linux

# Build for Windows (NSIS installer x64)
npm run build:win

# Build for macOS (DMG x64 + ARM64)
npm run build:mac
```

**Build Output:**

| Platform | Format | Architectures | Size |
|----------|--------|---------------|------|
| **Linux** | AppImage | x64, ARM64 | ~143 MB each |
| **Linux** | Flatpak | x64, ARM64 | ~104 MB each |
| **Windows** | NSIS | x64 | ~150 MB |
| **macOS** | DMG | x64 (Intel), ARM64 (Apple Silicon) | ~150 MB each |

**Build Requirements:**

- **Linux builds**: Requires `flatpak-builder` and Flatpak runtimes (24.08)
  ```bash
  # Install flatpak-builder
  sudo apt-get install flatpak-builder flatpak

  # Add Flathub repository
  flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo

  # Install required runtimes
  flatpak install --user -y flathub \
    org.electronjs.Electron2.BaseApp/x86_64/24.08 \
    org.freedesktop.Platform/x86_64/24.08 \
    org.freedesktop.Sdk/x86_64/24.08 \
    org.electronjs.Electron2.BaseApp/aarch64/24.08 \
    org.freedesktop.Platform/aarch64/24.08 \
    org.freedesktop.Sdk/aarch64/24.08
  ```

- **ARM64 builds**: x64 hosts use QEMU for cross-compilation
  - AppImages: Built via QEMU (supported out of the box)
  - Flatpak: Requires ARM64 runtimes (installed above)

- **macOS builds**: Both Intel and Apple Silicon DMGs built simultaneously
- **Windows builds**: x64 NSIS installer with auto-updater support

### Production

```bash
# Start the app (after building)
npm start
```

---

## Architecture

Loukai is built with a multi-process architecture:

### Main Process (Electron)
- **Audio Engine**: Native audio processing with dual outputs
- **Library Scanner**: Metadata extraction and caching
- **Web Server**: Express 5 REST API + Socket.IO
- **State Management**: Centralized app state with event emitters
- **File System**: M4A/CDG file parsing and manipulation
- **IPC Handlers**: Communication bridge to renderer

### Renderer Process (React)
- **React 19**: Modern UI with concurrent features
- **Vite 7**: Lightning-fast builds and HMR
- **Tailwind CSS**: Utility-first styling with dark mode
- **Web Audio API**: Real-time audio processing
- **Butterchurn**: Audio visualization engine
- **Socket.IO Client**: Real-time updates from main process

### Web Admin (React)
- **Standalone Web UI**: Accessible from any device
- **Socket.IO**: Real-time bidirectional communication
- **Responsive Design**: Mobile-friendly interface
- **Authentication**: Session-based login with bcrypt
- **WebRTC**: Optional audio/video streaming

### Key Technologies

| Category | Technology |
|----------|------------|
| **Frontend** | React 19, Tailwind CSS 3 |
| **Build Tool** | Vite 7 |
| **Desktop** | Electron 38 |
| **Backend** | Node.js, Express 5 |
| **Real-time** | Socket.IO 4 |
| **Testing** | Vitest 3, Testing Library 16 |
| **Audio** | Web Audio API, Custom Worklets |
| **Graphics** | Butterchurn, CDGGraphics |
| **Linting** | ESLint 9, Prettier 3 |
| **Pre-commit** | Husky 9, lint-staged 16 |
| **Packaging** | electron-builder 26 |

### Packaging & Distribution

| Platform | Formats | Architecture Support |
|----------|---------|---------------------|
| **Linux** | AppImage, Flatpak | x64, ARM64 |
| **Windows** | NSIS Installer | x64 |
| **macOS** | DMG | Intel (x64), Apple Silicon (ARM64) |

**Flatpak Configuration:**
- Runtime: org.freedesktop.Platform 24.08
- SDK: org.freedesktop.Sdk 24.08
- Base: org.electronjs.Electron2.BaseApp 24.08
- Permissions: Wayland, X11, Audio, Network, Home filesystem

**GitHub Actions CI:**
- Automated builds for all platforms
- Multi-architecture support (x64, ARM64)
- Automatic releases on version tags

---

## File Formats

### M4A Stems Format (Primary - Recommended)

**Industry-standard MPEG-4 multi-track audio** - the modern karaoke format:

#### Why M4A Stems?
- ✅ **DJ Software Compatible**: Works with Traktor, Mixxx, and other NI Stems-compatible software
- ✅ **Smaller Files**: 30-50% smaller than ZIP-based formats due to MPEG-4 compression
- ✅ **Better Metadata**: Native MP4 atoms for rich metadata (title, artist, album art, BPM, key)
- ✅ **Karaoke Extensions**: Custom atoms for lyrics with word-level timing
- ✅ **Single File**: No unpacking required - instant playback
- ✅ **Dual Purpose**: Same file works for both DJing and karaoke

#### Structure
- **Multi-track audio**: Master + 4 stems (drums, bass, other, vocals)
- **NI Stems atom**: `stem` - standard metadata for DJ software compatibility
- **Karaoke atom**: `kara` (lyrics with word-level timing)
- **File extension**: `.stem.m4a` or `.m4a`

**Full specification:** [docs/m4a_format.md](./docs/m4a_format.md)

#### Creating M4A Files
Use the built-in **Creator** tab in Loukai:

1. Open Loukai and go to the **Creator** tab
2. Drop your audio file (MP3, FLAC, WAV, etc.)
3. The Creator will:
   - Separate audio into stems using Demucs (AI stem separation)
   - Transcribe lyrics using Whisper (AI speech recognition)
   - Detect musical key using CREPE
   - Package everything into a `.stem.m4a` file

**Output:** `Artist - Title.stem.m4a` saved to your songs folder

### CDG Format (Legacy)

Classic karaoke format with graphics - widely available but limited features:

- **MP3 + CDG pairs**: `song.mp3` + `song.cdg`
- **Limitations**: No stem separation, basic graphics, no metadata

---

## Configuration

### Audio Settings
Configure audio devices in the Mixer tab:
- **PA Output**: Main speakers/sound system
- **IEM Output**: Stage monitors/headphones
- **Input Device**: Microphone for vocal processing

### Web Server Settings
Access in the Server tab:
- **Port**: Default 3069
- **Server Name**: Custom server name for identification
- **Authentication**: Enable/disable login
- **Requests**: Allow remote song requests
- **Max Requests**: Limit requests per user
- **Show QR Code**: Display QR code on canvas for easy mobile access (on by default)
- **Display Queue**: Show upcoming songs on canvas (on by default)

### Settings Persistence
All settings are automatically saved to:
- **Linux**: `~/.config/loukai/`
- **Windows**: `%APPDATA%\loukai\`
- **macOS**: `~/Library/Application Support/loukai/`

---

## Usage

### Loading Songs

1. **Set Songs Folder**: Settings tab → Browse for your karaoke library (M4A files recommended)
2. **Scan Library**: Click "Scan Library" to index all songs
3. **Search & Play**: Use the Library tab to find and play songs

**Tip:** For best results, use `.stem.m4a` files created with the built-in Creator. M4A files load faster and take less disk space than legacy formats.

### Playing Karaoke

1. **Load Song**: Double-click a song or add to queue
2. **Adjust Mixer**: Control stem volumes in the Mixer tab
3. **Enable Effects**: Choose visual effects in the Effects tab
4. **Open Canvas**: Project visuals to a second screen

### Remote Access

1. **Enable Web Server**: Settings → Server → Enable
2. **Set Password**: Configure authentication credentials
3. **Share URL**: Give singers the URL (shown in Server tab)
4. **QR Code**: Singers can scan the QR code from the canvas for instant access
5. **Manage Requests**: Approve/reject requests in the Requests tab

### Canvas Display Features

The karaoke canvas shows helpful information when not playing:

- **QR Code** (bottom left): Scannable code for mobile device access
  - Toggle: Server tab → "Show QR Code" checkbox
  - Only visible when not playing

- **Queue Display** (bottom right): Shows upcoming songs
  - Toggle: Server tab → "Display Queue" checkbox
  - Displays "Next up:" with 1-3 upcoming songs
  - Singer names shown in yellow (guests) or white (KJ)
  - Only visible when not playing and queue has items

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause |
| `←` | Seek backward 5s |
| `→` | Seek forward 5s |
| `R` | Restart song |
| `N` | Next song |
| `M` | Toggle mute |
| `F` | Toggle fullscreen canvas |

---

## Testing

Loukai has comprehensive test coverage using Vitest:

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run

# Run with coverage report
npm run test:coverage

# Interactive test UI
npm run test:ui
```

**Current Coverage:** 283 tests

See [PHASE2-SUMMARY.md](./docs/PHASE2-SUMMARY.md) for detailed testing information.

---

## Development

### Project Structure

```
loukai/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.js        # Entry point
│   │   ├── appState.js    # Centralized state
│   │   ├── audioEngine.js # Audio processing
│   │   ├── webServer.js   # Express + Socket.IO
│   │   └── handlers/      # IPC handlers
│   │       └── autotuneHandlers.js  # Auto-tune IPC
│   ├── renderer/          # Electron renderer (React)
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── js/            # Audio engine (vanilla JS)
│   │   │   ├── autoTuneWorklet.js  # Auto-tune processor
│   │   │   └── playerController.js # Unified control
│   │   └── vite.config.js # Renderer build config
│   ├── web/               # Web admin interface
│   │   ├── App.jsx        # Web admin root
│   │   ├── components/    # Web-specific components
│   │   └── vite.config.js # Web build config
│   ├── shared/            # Shared code (renderer + web)
│   │   ├── components/    # Reusable React components
│   │   ├── services/      # Business logic
│   │   └── utils/         # Utility functions
│   ├── native/            # Native modules
│   │   └── autotune.js    # Auto-tune utilities
│   └── test/              # Test setup
│       └── setup.js       # Vitest config
├── static/                # Static assets
├── docs/                  # Documentation
├── coverage/              # Test coverage reports
└── dist/                  # Build output
```

### Code Style

This project uses ESLint and Prettier for code quality:

```bash
# Check linting
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format all files
npm run format

# Check formatting
npm run format:check
```

**Pre-commit hooks** automatically run linting and formatting on staged files.

### Adding Tests

Create test files next to source files with `.test.js` extension:

```javascript
// src/shared/services/myService.test.js
import { describe, it, expect } from 'vitest';
import * as myService from './myService.js';

describe('myService', () => {
  it('should do something', () => {
    const result = myService.doSomething();
    expect(result).toBe(true);
  });
});
```

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

---

## Documentation

| Document | Description |
|----------|-------------|
| [m4a_format.md](./docs/m4a_format.md) | M4A Stems karaoke format specification |
| [architecture.md](./docs/architecture.md) | System architecture and design |
| [PHASE2-SUMMARY.md](./docs/PHASE2-SUMMARY.md) | Testing infrastructure guide |
| [MODERNIZATION-PLAN.md](./docs/MODERNIZATION-PLAN.md) | Development roadmap |
| [PACKAGING.md](./PACKAGING.md) | Build and packaging guide |
| [WEB-API-REFERENCE.md](./docs/wip/WEB-API-REFERENCE.md) | REST API documentation |
| [SECURITY-MODEL.md](./docs/wip/SECURITY-MODEL.md) | Security architecture |
| [REFACTORING-SUMMARY.md](./docs/wip/REFACTORING-SUMMARY.md) | Architecture decisions |

---

## Troubleshooting

### Audio Not Playing
- Check audio device selection in Mixer tab
- Verify output device permissions (especially on Linux)
- Try switching between PA and IEM outputs

### Library Not Scanning
- Ensure songs folder path is correct
- Check file permissions (read access required)
- Supported formats: `.m4a` (recommended), `.stem.m4a`, `.cdg` + `.mp3` pairs
- For best performance, use M4A Stems format

### Web Server Not Accessible
- Check firewall settings
- Verify server is enabled in Settings
- Check port is not in use (default: 3000)
- Try accessing via IP address instead of hostname

### Build Errors
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear build cache
rm -rf dist/ coverage/
npm run build:all
```

---

## License

**AGPL-3.0**

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

See [LICENSE](./LICENSE) for full text.

---

## Acknowledgments

- **Butterchurn** - Audio visualization engine
- **CDGraphics** - CDG format support
- **React** - UI framework
- **Electron** - Desktop framework
- **Vite** - Build tool

---

## Support

- **Issues**: [GitHub Issues](https://github.com/monteslu/loukai/issues)
- **Discussions**: [GitHub Discussions](https://github.com/monteslu/loukai/discussions)
- **Documentation**: [docs/](./docs/)

---

**Made with ♪ for karaoke enthusiasts**
