# Loukai Packaging Guide

## Overview

Loukai uses **electron-builder 26** to create distributable packages for Linux, Windows, and macOS. The build system supports multi-architecture packaging, producing **8 packages** across **3 platforms**. All dependencies are pure JS/WASM — nothing is compiled per platform.

## Supported Platforms & Architectures

| Platform | Format | Architectures | Size | Status |
|----------|--------|---------------|------|--------|
| **Linux** | AppImage | x64, ARM64 | 143 MB each | ✅ Production |
| **Linux** | Flatpak | x64, ARM64 | 104 MB each | ✅ Production |
| **Windows** | NSIS | x64 | ~150 MB | ✅ Production |
| **Windows** | Portable | x64 | ~150 MB | ✅ Production |
| **macOS** | DMG | x64 (Intel), ARM64 (Apple Silicon) | ~150 MB each | ✅ Production |

**Total Output:** 8 packages, ~1 GB combined

---

## Quick Start

### Prerequisites

- **Node.js 20.19+** (CI uses 24)
- **npm 10+**
- Platform-specific tools (see below)

### Build Commands

```bash
# Build for all platforms
npm run build                  # Current platform only
npm run build:linux            # Linux (AppImage + Flatpak)
npm run build:win              # Windows (NSIS + portable)
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
├── Loukai Karaoke-<version>-linux-x86_64.AppImage      # Linux x64 AppImage
├── Loukai Karaoke-<version>-linux-aarch64.AppImage     # Linux ARM64 AppImage
├── Loukai Karaoke-<version>-linux-x86_64.flatpak       # Linux x64 Flatpak
├── Loukai Karaoke-<version>-linux-aarch64.flatpak      # Linux ARM64 Flatpak
├── Loukai Karaoke-<version>-windows-x86_64-installer.exe  # Windows NSIS installer
├── Loukai Karaoke-<version>-windows-x86_64-portable.exe   # Windows portable
├── Loukai Karaoke-<version>-macos-x86_64.dmg           # macOS Intel DMG
└── Loukai Karaoke-<version>-macos-aarch64.dmg          # macOS Apple Silicon DMG
```

(Names come from the `artifactName` templates in package.json; `scripts/rename-artifacts.js` converts x64/arm64 to x86_64/aarch64.)

---

## Linux Packaging

### AppImage

**Format:** Universal Linux binary that runs on any distribution

**Configuration** (`package.json`, excerpt — the full `linux` block also lists the flatpak target, `artifactName`, and a `desktop.entry`):
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
chmod +x "Loukai Karaoke-<version>-linux-x86_64.AppImage"

# Run
"./Loukai Karaoke-<version>-linux-x86_64.AppImage"
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
flatpak install --user "Loukai Karaoke-<version>-linux-x86_64.flatpak"

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

### NSIS Installer + Portable

**Format:** Installable Windows executable (NSIS) plus a portable single-file exe

**Configuration** (`package.json`):
```json
{
  "win": {
    "target": [
      { "target": "nsis", "arch": ["x64"] },
      { "target": "portable", "arch": ["x64"] }
    ],
    "icon": "static/images/logo.png",
    "artifactName": "${productName}-${version}-windows-${arch}.${ext}"
  }
}
```

**Features:**
- Standard Windows installer experience
- Desktop shortcut creation
- Start menu integration
- Published to GitHub Releases (no in-app auto-updater)
- Uninstaller included
- Portable exe alternative — run without installing

**Build Requirements:**
- Windows 10/11 or GitHub Actions (windows-latest)
- No compiler toolchain needed — all dependencies are pure JS/WASM

**Usage:**
1. Double-click `Loukai Karaoke-<version>-windows-x86_64-installer.exe` (or run the `-portable.exe` without installing)
2. Follow installation wizard
3. Launch from Start menu or desktop shortcut

**Installation Paths:**
- Program: `%LOCALAPPDATA%\Programs\Loukai Karaoke\` (per-user install)
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
    "icon": "static/images/logo.png",
    "identity": null,
    "artifactName": "${productName}-${version}-macos-${arch}.${ext}"
  }
}
```

**Features:**
- Native macOS application
- Universal binary support (Intel + Apple Silicon)
- Ships unsigned (`identity: null`); code signing/notarization can be enabled for distribution
- Drag-to-Applications installation

**Build Requirements:**
- macOS 10.15+ or GitHub Actions (macos-latest)
- Xcode Command Line Tools
- Code signing certificate (optional, for distribution)

**Usage:**
1. Open `Loukai Karaoke-<version>-macos-x86_64.dmg` (or `-macos-aarch64.dmg` for Apple Silicon)
2. Drag Loukai icon to Applications folder
3. Launch from Applications or Launchpad

**Installation Paths:**
- Application: `/Applications/Loukai Karaoke.app`
- User Data: `~/Library/Application Support/loukai/`

**Architecture Selection:**
- `Loukai Karaoke-<version>-macos-x86_64.dmg` - Intel Macs (x64)
- `Loukai Karaoke-<version>-macos-aarch64.dmg` - Apple Silicon (M1/M2/M3)

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
2. Packages the app (pure JS/WASM — no native module rebuild step)
3. Produces the ARM64 AppImage

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
- Manual workflow dispatch (jobs are still gated on a tag ref, so dispatch only builds when run on a tag)

**Jobs:**

```yaml
jobs:
  build-linux-x64:    # Fedora-based flatpak container on ubuntu-latest
  build-linux-arm64:  # Same container + QEMU user-mode emulation
  build-windows:      # Windows x64 runner
  build-macos:        # macOS runner (builds both arches)
```

There is no separate release job — every job publishes its artifacts straight to the GitHub release via `electron-builder --publish always`.

### Build Matrix

| Job | Runner | Architectures | Output |
|-----|--------|---------------|--------|
| **build-linux-x64** | `bilelmoussaoui/flatpak-github-actions:freedesktop-24.08` container | x64 | 1× AppImage, 1× Flatpak |
| **build-linux-arm64** | same container + QEMU | ARM64 | 1× AppImage, 1× Flatpak |
| **build-windows** | windows-latest | x64 | 1× NSIS installer, 1× portable exe |
| **build-macos** | macos-latest | x64, ARM64 | 2× DMG |

### Linux Build Steps (per arch)

```yaml
- name: Checkout code
- name: Setup Node.js 24
- name: Install QEMU for ARM64 builds        # arm64 job only
  run: dnf install -y qemu-user-static
- name: Install dependencies
  run: npm ci
- name: Build renderer and web UI
  run: npm run build:all
- name: Setup Flatpak remotes and Electron base
  run: |
    flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
    flatpak install -y flathub org.electronjs.Electron2.BaseApp/<arch>/24.08
    # (arm64 job also installs the aarch64 Platform + Sdk; x64 versions ship with the container)
- name: Move electron to devDependencies for electron-builder
- name: Build and publish
  run: npx electron-builder --linux AppImage flatpak --<arch> --publish always && node scripts/rename-artifacts.js
```

No compiler toolchain is installed — all dependencies are pure JS/WASM.

### Release Creation

When a version tag is pushed:

1. All build jobs run in parallel
2. Each job publishes its artifacts directly to the GitHub release (`--publish always`)
3. The release ends up with all 8 packages attached

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
| Linux | AppImage | x64 | ~45s | Packaging only |
| Linux | AppImage | ARM64 | ~60s | QEMU emulation |
| Linux | Flatpak | x64 | ~90s | Runtime installation |
| Linux | Flatpak | ARM64 | ~90s | Runtime installation |
| Windows | NSIS | x64 | ~60s | Packaging only |
| macOS | DMG | x64 | ~50s | Packaging only |
| macOS | DMG | ARM64 | ~50s | Packaging only |

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

**No native modules:**
- bcryptjs (pure JS) replaced native bcrypt — nothing is compiled per platform/architecture

**Optimization:**
- Code splitting (dynamic imports)
- Tree shaking (Vite default)
- Minification (esbuild, Vite default)
- Gzip compression

---

## Testing Builds

### Linux

#### AppImage
```bash
# Make executable
chmod +x "dist/Loukai Karaoke-<version>-linux-x86_64.AppImage"

# Run
"./dist/Loukai Karaoke-<version>-linux-x86_64.AppImage"

# Run with debug
"./dist/Loukai Karaoke-<version>-linux-x86_64.AppImage" --no-sandbox --enable-logging
```

#### Flatpak
```bash
# Install locally
flatpak install --user "dist/Loukai Karaoke-<version>-linux-x86_64.flatpak"

# Run
flatpak run com.loukai.app

# Run with debug
flatpak run --command=sh com.loukai.app
```

### Windows

```cmd
REM Install
"dist\Loukai Karaoke-<version>-windows-x86_64-installer.exe"

REM Run from Start Menu or:
"%LOCALAPPDATA%\Programs\Loukai Karaoke\Loukai Karaoke.exe"
```

### macOS

```bash
# Mount DMG
open "dist/Loukai Karaoke-<version>-macos-x86_64.dmg"

# Copy to Applications (manual)
# OR run directly from the mounted volume
"/Volumes/Loukai Karaoke/Loukai Karaoke.app/Contents/MacOS/Loukai Karaoke"
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

**Issue:** ARM64 emulation not available for the cross-arch build

**Solution:**
1. Install QEMU:
   ```bash
   sudo apt-get install -y qemu-user-static
   ```

2. Verify QEMU is registered:
   ```bash
   ls /proc/sys/fs/binfmt_misc/qemu-aarch64
   ```

> Note: loukai has no native (compiled) node modules — all dependencies are pure
> JS/WASM, so no compiler toolchain or `electron-rebuild` step is needed on any
> platform.

### macOS Code Signing

**Issue:** "Loukai is damaged and can't be opened"

**Workaround (development only):**
```bash
# Remove quarantine attribute
xattr -cr "/Applications/Loukai Karaoke.app"
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
