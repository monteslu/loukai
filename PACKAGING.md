# Loukai Packaging Guide

## Overview

Loukai uses **electron-builder 26** to create distributable packages for Linux, Windows, and macOS. The build system supports multi-architecture compilation, producing **7 packages** across **3 platforms**.

## Supported Platforms & Architectures

| Platform | Format | Architectures | Size | Status |
|----------|--------|---------------|------|--------|
| **Linux** | AppImage | x64, ARM64 | 143 MB each | ✅ Production |
| **Linux** | Flatpak | x64, ARM64 | 104 MB each | ✅ Production |
| **Windows** | NSIS | x64 | ~150 MB | ✅ Production |
| **macOS** | DMG | x64 (Intel), ARM64 (Apple Silicon) | ~150 MB each | ✅ Production |

**Total Output:** 7 packages, ~900 MB combined

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **npm 9+**
- Platform-specific tools (see below)

### Build Commands

```bash
# Build for all platforms
npm run build                  # Current platform only
npm run build:linux            # Linux (AppImage + Flatpak)
npm run build:win              # Windows (NSIS)
npm run build:mac              # macOS (DMG x2)

# Build assets only (no packaging)
npm run build:all              # Renderer + Web UI
npm run build:renderer         # Electron renderer
npm run build:web              # Web admin interface
```

### Output Location

All build artifacts are placed in `dist/`:

```
dist/
├── Loukai-1.0.0.AppImage              # Linux x64 AppImage
├── Loukai-1.0.0-arm64.AppImage        # Linux ARM64 AppImage
├── Loukai-1.0.0-x86_64.flatpak        # Linux x64 Flatpak
├── Loukai-1.0.0-aarch64.flatpak       # Linux ARM64 Flatpak
├── Loukai-Setup-1.0.0.exe             # Windows NSIS installer
├── Loukai-1.0.0.dmg                   # macOS Intel DMG
└── Loukai-1.0.0-arm64.dmg             # macOS Apple Silicon DMG
```

---

## Linux Packaging

### AppImage

**Format:** Universal Linux binary that runs on any distribution

**Configuration** (`package.json`):
```json
{
  "linux": {
    "target": [
      {
        "target": "AppImage",
        "arch": ["x64", "arm64"]
      }
    ],
    "icon": "static/images/logo.png",
    "category": "AudioVideo"
  }
}
```

**Features:**
- No installation required
- Portable (single file)
- Works on all major Linux distributions
- Multi-architecture (x64, ARM64)

**Usage:**
```bash
# Make executable
chmod +x Loukai-1.0.0.AppImage

# Run
./Loukai-1.0.0.AppImage
```

### Flatpak

**Format:** Sandboxed Linux application with controlled permissions

**Configuration** (`package.json`):
```json
{
  "flatpak": {
    "runtime": "org.freedesktop.Platform",
    "runtimeVersion": "24.08",
    "sdk": "org.freedesktop.Sdk",
    "base": "org.electronjs.Electron2.BaseApp",
    "baseVersion": "24.08",
    "finishArgs": [
      "--socket=wayland",
      "--socket=x11",
      "--share=ipc",
      "--device=dri",
      "--socket=pulseaudio",
      "--filesystem=home",
      "--share=network",
      "--talk-name=org.freedesktop.Notifications"
    ]
  }
}
```

**Build Requirements:**

1. Install flatpak-builder:
```bash
sudo apt-get update
sudo apt-get install -y flatpak-builder flatpak
```

2. Add Flathub repository:
```bash
flatpak remote-add --user --if-not-exists flathub \
  https://flathub.org/repo/flathub.flatpakrepo
```

3. Install runtimes (both x64 and ARM64):
```bash
flatpak install --user -y flathub \
  org.electronjs.Electron2.BaseApp/x86_64/24.08 \
  org.freedesktop.Platform/x86_64/24.08 \
  org.freedesktop.Sdk/x86_64/24.08 \
  org.electronjs.Electron2.BaseApp/aarch64/24.08 \
  org.freedesktop.Platform/aarch64/24.08 \
  org.freedesktop.Sdk/aarch64/24.08
```

**Usage:**
```bash
# Install
flatpak install --user Loukai-1.0.0-x86_64.flatpak

# Run
flatpak run com.loukai.app

# Uninstall
flatpak uninstall com.loukai.app
```

**Permissions:**
- **Wayland/X11** - Display server access
- **PulseAudio** - Audio input/output
- **Home filesystem** - Access to song files
- **Network** - Web server for remote control
- **D-Bus notifications** - Desktop notifications

---

## Windows Packaging

### NSIS Installer

**Format:** Installable Windows executable with auto-updater support

**Configuration** (`package.json`):
```json
{
  "win": {
    "target": "nsis",
    "icon": "static/images/logo.png"
  }
}
```

**Features:**
- Standard Windows installer experience
- Desktop shortcut creation
- Start menu integration
- Auto-updater support (GitHub releases)
- Uninstaller included

**Build Requirements:**
- Windows 10/11 or GitHub Actions (windows-latest)
- Visual Studio Build Tools (for bcrypt compilation)

**Usage:**
1. Double-click `Loukai-Setup-1.0.0.exe`
2. Follow installation wizard
3. Launch from Start menu or desktop shortcut

**Installation Paths:**
- Program Files: `C:\Program Files\Loukai\`
- User Data: `%APPDATA%\loukai\`

---

## macOS Packaging

### DMG (Disk Image)

**Format:** macOS disk image for drag-and-drop installation

**Configuration** (`package.json`):
```json
{
  "mac": {
    "target": [
      {
        "target": "dmg",
        "arch": ["x64", "arm64"]
      }
    ],
    "icon": "static/images/logo.png"
  }
}
```

**Features:**
- Native macOS application
- Universal binary support (Intel + Apple Silicon)
- Code signing ready
- Drag-to-Applications installation

**Build Requirements:**
- macOS 10.15+ or GitHub Actions (macos-latest)
- Xcode Command Line Tools
- Code signing certificate (optional, for distribution)

**Usage:**
1. Open `Loukai-1.0.0.dmg` (or `-arm64.dmg` for Apple Silicon)
2. Drag Loukai icon to Applications folder
3. Launch from Applications or Launchpad

**Installation Paths:**
- Application: `/Applications/Loukai.app`
- User Data: `~/Library/Application Support/loukai/`

**Architecture Selection:**
- `Loukai-1.0.0.dmg` - Intel Macs (x64)
- `Loukai-1.0.0-arm64.dmg` - Apple Silicon (M1/M2/M3)

---

## Cross-Platform Compilation

### ARM64 on x64 Hosts

#### AppImage (via QEMU)

electron-builder uses **QEMU user-mode emulation** for ARM64 builds on x64 hosts:

**Setup:**
```bash
# Install QEMU
sudo apt-get install -y qemu-user-static
```

**Process:**
1. Downloads Electron ARM64 binary
2. Uses `@electron/rebuild` to compile native modules (bcrypt)
3. Packages into ARM64 AppImage

**Build Output:**
```
• executing @electron/rebuild  electronVersion=38.2.2 arch=arm64
• installing native dependencies  arch=arm64
• preparing       moduleName=bcrypt arch=arm64
• finished        moduleName=bcrypt arch=arm64
```

#### Flatpak (Native Runtimes)

Flatpak ARM64 builds use **native ARM64 runtimes** from Flathub:
- `org.electronjs.Electron2.BaseApp/aarch64/24.08`
- `org.freedesktop.Platform/aarch64/24.08`
- `org.freedesktop.Sdk/aarch64/24.08`

No QEMU required - flatpak-builder handles cross-compilation internally.

### macOS Universal Binaries

macOS builds produce two separate DMGs (one for each architecture):
- Rosetta 2 allows Intel builds to run on Apple Silicon (with performance penalty)
- Native ARM64 builds provide optimal performance on M-series chips

---

## GitHub Actions CI/CD

### Workflow Overview

File: `.github/workflows/build.yml`

**Triggers:**
- Push to tags matching `v*` (e.g., `v1.0.0`)
- Manual workflow dispatch

**Jobs:**

```yaml
jobs:
  build-linux:      # Ubuntu x64 runner
  build-windows:    # Windows x64 runner
  build-macos:      # macOS x64 runner
  release:          # Create GitHub release
```

### Build Matrix

| Job | Runner | Architectures | Output |
|-----|--------|---------------|--------|
| **build-linux** | ubuntu-latest | x64, ARM64 | 2× AppImage, 2× Flatpak |
| **build-windows** | windows-latest | x64 | 1× NSIS installer |
| **build-macos** | macos-latest | x64, ARM64 | 2× DMG |
| **release** | ubuntu-latest | - | GitHub release with all artifacts |

### Linux Build Steps

```yaml
- name: Checkout code
- name: Setup Node.js 18
- name: Install dependencies
- name: Install flatpak-builder
  run: |
    sudo apt-get update
    sudo apt-get install -y flatpak-builder flatpak
    flatpak remote-add --user --if-not-exists flathub \
      https://flathub.org/repo/flathub.flatpakrepo

- name: Install Flatpak runtimes
  run: |
    flatpak install --user -y flathub \
      org.electronjs.Electron2.BaseApp/x86_64/24.08 \
      org.freedesktop.Platform/x86_64/24.08 \
      org.freedesktop.Sdk/x86_64/24.08 \
      org.electronjs.Electron2.BaseApp/aarch64/24.08 \
      org.freedesktop.Platform/aarch64/24.08 \
      org.freedesktop.Sdk/aarch64/24.08

- name: Install QEMU for ARM64
  run: sudo apt-get install -y qemu-user-static

- name: Build Linux
  run: npm run build:linux

- name: Upload artifacts
  uses: actions/upload-artifact@v4
  with:
    name: linux-builds
    path: |
      dist/*.AppImage
      dist/*.flatpak
```

### Release Creation

When a version tag is pushed:

1. All build jobs run in parallel
2. Artifacts are uploaded from each job
3. Release job downloads all artifacts
4. GitHub release is created with all 7 packages attached

**Example:**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**Result:** GitHub release at `https://github.com/monteslu/loukai/releases/tag/v1.0.0` with all packages attached.

---

## Build Timings

| Platform | Format | Architecture | Build Time | Notes |
|----------|--------|--------------|------------|-------|
| Linux | AppImage | x64 | ~45s | Native compilation |
| Linux | AppImage | ARM64 | ~60s | QEMU emulation |
| Linux | Flatpak | x64 | ~90s | Runtime installation |
| Linux | Flatpak | ARM64 | ~90s | Runtime installation |
| Windows | NSIS | x64 | ~60s | Native compilation |
| macOS | DMG | x64 | ~50s | Native compilation |
| macOS | DMG | ARM64 | ~50s | Native compilation |

**Total CI time:** ~5-7 minutes (parallel jobs)

---

## Bundle Analysis

### Renderer Bundle

**Vite Build:** `src/renderer/vite.config.js`

**Output:**
```
dist/renderer.woff2                       128.62 kB
dist/renderer.css                          41.89 kB │ gzip:  7.15 kB
dist/renderer.js                          335.92 kB │ gzip: 92.70 kB
dist/assets/songLoaders-UvYwATOz.js         4.17 kB │ gzip:  1.35 kB
dist/assets/webrtcManager-BhCHWceK.js       8.08 kB │ gzip:  2.48 kB
dist/assets/microphoneEngine-B3Exu2Ak.js   14.85 kB │ gzip:  3.75 kB
dist/assets/kaiPlayer-DLVHlKdP.js          16.71 kB │ gzip:  3.90 kB
dist/assets/player-DFijIx-9.js             49.61 kB │ gzip: 12.62 kB
```

### Web Admin Bundle

**Vite Build:** `src/web/vite.config.js`

**Output:**
```
dist/index.html                   0.53 kB │ gzip:   0.34 kB
dist/assets/index-C5gpPxE9.css   44.52 kB │ gzip:   7.16 kB
dist/assets/index-Cn6I7HKD.js   358.66 kB │ gzip: 100.15 kB
```

### Dependencies

**Major Dependencies:**
- React 19 + React-DOM: ~200 KB (gzipped)
- Socket.IO Client 4: ~50 KB
- Butterchurn + Presets: ~100 KB
- Audio Worklets: ~50 KB

**Native Module:**
- bcrypt 6: Compiled for each platform/architecture

**Optimization:**
- Code splitting (dynamic imports)
- Tree shaking (Vite default)
- Minification (Terser)
- Gzip compression

---

## Testing Builds

### Linux

#### AppImage
```bash
# Make executable
chmod +x dist/Loukai-1.0.0.AppImage

# Run
./dist/Loukai-1.0.0.AppImage

# Run with debug
./dist/Loukai-1.0.0.AppImage --no-sandbox --enable-logging
```

#### Flatpak
```bash
# Install locally
flatpak install --user dist/Loukai-1.0.0-x86_64.flatpak

# Run
flatpak run com.loukai.app

# Run with debug
flatpak run --command=sh com.loukai.app
```

### Windows

```cmd
REM Install
dist\Loukai-Setup-1.0.0.exe

REM Run from Start Menu or:
"%LOCALAPPDATA%\Programs\loukai\Loukai.exe"
```

### macOS

```bash
# Mount DMG
open dist/Loukai-1.0.0.dmg

# Copy to Applications (manual)
# OR run directly
open dist/Loukai-1.0.0.dmg
./Volumes/Loukai/Loukai.app/Contents/MacOS/Loukai
```

---

## Troubleshooting

### Flatpak Build Fails

**Issue:** `flatpak failed with status code 1`

**Solution:**
1. Verify flatpak-builder is installed:
   ```bash
   flatpak-builder --version
   ```

2. Check runtimes are installed:
   ```bash
   flatpak list --runtime | grep -E '(Platform|Sdk|Electron)'
   ```

3. Install missing runtimes:
   ```bash
   flatpak install --user -y flathub \
     org.electronjs.Electron2.BaseApp/x86_64/24.08 \
     org.freedesktop.Platform/x86_64/24.08 \
     org.freedesktop.Sdk/x86_64/24.08
   ```

### ARM64 Build Fails

**Issue:** bcrypt compilation fails for ARM64

**Solution:**
1. Install QEMU:
   ```bash
   sudo apt-get install -y qemu-user-static
   ```

2. Verify QEMU is registered:
   ```bash
   ls /proc/sys/fs/binfmt_misc/qemu-aarch64
   ```

### Native Module Errors

**Issue:** `Error: Cannot find module 'bcrypt'`

**Solution:**
```bash
# Rebuild native modules
npm run rebuild

# OR manually
npx electron-rebuild
```

### macOS Code Signing

**Issue:** "Loukai is damaged and can't be opened"

**Workaround (development only):**
```bash
# Remove quarantine attribute
xattr -cr /Applications/Loukai.app
```

**Production solution:** Sign with Apple Developer certificate

---

## Version Bumping

### Manual Version Update

1. Update version in `package.json`:
   ```json
   {
     "version": "1.1.0"
   }
   ```

2. Commit and tag:
   ```bash
   git add package.json
   git commit -m "chore: bump version to 1.1.0"
   git tag v1.1.0
   git push origin main --tags
   ```

3. GitHub Actions will automatically build and release

### Automated Version Bump

Using `npm version`:

```bash
# Patch release (1.0.0 → 1.0.1)
npm version patch

# Minor release (1.0.0 → 1.1.0)
npm version minor

# Major release (1.0.0 → 2.0.0)
npm version major

# Push changes and tags
git push origin main --tags
```

---

## Distribution Channels

### Direct Download

Users can download packages directly from GitHub Releases:
```
https://github.com/monteslu/loukai/releases/latest
```

### Flatpak (Flathub)

**Submission process:** See `docs/wip/flathub-submission-guide.md`

**Repository:** Once approved, users can install via:
```bash
flatpak install flathub com.loukai.app
```

### Windows Package Managers

**Winget:**
```cmd
winget install Loukai.Loukai
```

**Chocolatey:**
```cmd
choco install loukai
```

(Requires submission to respective repositories)

### macOS Package Managers

**Homebrew:**
```bash
brew install --cask loukai
```

(Requires submission to homebrew-cask)

---

## Security Considerations

### Code Signing

**Windows:**
- Sign `.exe` with Authenticode certificate
- Required for SmartScreen reputation

**macOS:**
- Sign `.app` with Apple Developer certificate
- Notarize for Gatekeeper approval

**Linux:**
- GPG sign Flatpak bundles
- Submit to Flathub for official repository

### Permissions

**Flatpak Sandboxing:**
- Home filesystem access (for song files)
- Audio device access (PulseAudio socket)
- Network access (web server)
- Display server (Wayland/X11)

**Review security model:** `docs/wip/SECURITY-MODEL.md`

---

## Release Checklist

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md`
- [ ] Run tests: `npm test`
- [ ] Run linter: `npm run lint`
- [ ] Test builds locally:
  - [ ] Linux AppImage (x64)
  - [ ] Linux Flatpak (x64)
  - [ ] Windows NSIS (if available)
  - [ ] macOS DMG (if available)
- [ ] Commit changes
- [ ] Create and push version tag: `git tag v1.x.x && git push --tags`
- [ ] Monitor GitHub Actions build
- [ ] Verify GitHub Release created
- [ ] Test downloaded artifacts
- [ ] Announce release

---

## Additional Resources

- **electron-builder docs:** https://www.electron.build/
- **Flatpak docs:** https://docs.flatpak.org/
- **GitHub Actions:** https://docs.github.com/en/actions
- **Flathub submission:** `docs/wip/flathub-submission-guide.md`
- **Architecture overview:** `docs/architecture.md`

---

**Last Updated:** 2025-10-12
**electron-builder Version:** 26.0.12
**Flatpak Runtime:** 24.08
