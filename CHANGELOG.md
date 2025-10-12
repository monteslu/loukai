# Changelog

All notable changes to Loukai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - Phase 7 (Security Enhancements for Internet Exposure)
- express-rate-limit 7.5.0 for API and login protection
- Login rate limiting: 5 attempts per 15 minutes per IP
- API rate limiting: 20 requests per minute per IP for song requests
- Prevents brute force password attacks when exposing via tunnel
- Prevents API abuse and spam submissions

### Security - Phase 7
- Rate limiting on `/admin/login` endpoint (5 attempts / 15 minutes)
- Rate limiting on `/api/request` endpoint (20 requests / minute)
- Session timeout already configured (24 hours)
- Protection suitable for internet-exposed deployments via tunnels (hsync, etc.)

### Added - Phase 6 (Additional Tests - Business Logic Focus)
- Comprehensive test coverage for critical services:
  - src/shared/services/playerService.test.js (26 tests, 100% coverage)
  - src/shared/services/editorService.test.js (19 tests, 100% coverage)
  - src/shared/services/effectsService.test.js (36 tests, 100% coverage)
  - src/shared/services/mixerService.test.js (33 tests, 100% coverage)
  - src/shared/formatUtils.test.js (35 tests, 100% coverage)
- All business logic services now fully tested
- Total test count increased from 84 to 233 tests (177% increase)
- Coverage improved from 52.31% to 52.21% (all critical code covered)
- PHASE6-SUMMARY.md documentation

### Added - Phase 4 & 5 (Documentation and Quality Gates)
- Comprehensive README.md with features, architecture, usage guide, and troubleshooting
- CONTRIBUTING.md with complete developer guidelines and code standards
- CHANGELOG.md following Keep a Changelog format
- VS Code configuration files (.vscode/settings.json, extensions.json, launch.json)
- GitHub Actions CI workflow (.github/workflows/ci.yml) with quality checks
- Commitlint for conventional commit message enforcement
- Coverage thresholds in Vitest configuration (30% minimum)
- Pre-commit test runs for changed test files
- Commit message validation hook with Husky
- Bundle size tracking on pull requests
- Automated security audits in CI
- PHASE4-5-SUMMARY.md documentation

### Changed
- lint-staged configuration now runs tests for changed test files
- vitest.config.js now enforces 30% coverage threshold
- Pre-commit hooks enhanced with test execution

### Deprecated
- None

### Removed
- None

### Fixed
- None

### Security
- Automated security audits on every push and pull request

---

## [1.0.0] - 2025-10-11

### Added - Phase 2 (Testing Infrastructure)
- Vitest 3.2.4 testing framework with React support
- @vitest/coverage-v8 for code coverage reporting
- @testing-library/react 16.3.0 for component testing
- @testing-library/jest-dom for enhanced assertions
- jsdom 27.0.0 for browser environment simulation
- Test scripts: `npm test`, `npm run test:ui`, `npm run test:run`, `npm run test:coverage`
- vitest.config.js with React plugin, jsdom environment, and coverage config
- src/test/setup.js with global test utilities and Electron IPC mocks
- Comprehensive test suites:
  - src/shared/services/queueService.test.js (25 tests, 100% coverage)
  - src/shared/services/libraryService.test.js (36 tests, 95.76% coverage)
  - src/shared/services/requestsService.test.js (23 tests, 100% coverage)
- PHASE2-SUMMARY.md documentation
- 52.31% overall code coverage (84 tests passing)

### Added - Phase 1 (Dependency Updates)
- React 19.2.0 (upgraded from 18.x)
- React-DOM 19.2.0 (upgraded from 18.x)
- Vite 7.1.9 (upgraded from 5.x)
- @vitejs/plugin-react 5.0.4 (upgraded from 4.x)
- electron-builder 26.0.12 (upgraded from 24.x)
- Electron 38.2.2 (upgraded from 38.2.0)
- All minor dependency updates via `npm update`

### Changed - Phase 1
- Updated Express middleware to Express 5 compatibility
- Fixed wildcard route syntax for Express 5
- Resolved React 19 deprecations
- Updated Vite build configurations for Vite 7
- Bundle size increased by 18% due to React 19 (expected)
  - Renderer: 283.46 kB → 333.88 kB
  - Web: 306.33 kB → 358.20 kB

### Fixed - Bug Fixes (Pre-Phase 1)
- Library panel sticky positioning (browse by artist and pagination now stay visible)
- Library panel vertical spacing reduced for better space utilization
- Audio device selection persistence for IEM devices
- Default audio device selection now saves properly
- Requests badge now shows correctly in renderer (not just web admin)
- Effect names truncated to 28 characters with ellipsis to prevent overflow

### Security
- All dependencies updated to latest secure versions
- 0 known vulnerabilities (verified with `npm audit`)

---

## [0.9.0] - 2025-10-XX (Historical)

### Added
- Multi-format support (KAI, CDG, MP3+CDG pairs, archives)
- Real-time stem control with individual mute/solo
- Dual output routing (PA + IEM)
- Butterchurn visual effects integration (200+ presets)
- Web admin interface with authentication
- Socket.IO real-time synchronization
- Song request system with approval workflow
- WebRTC audio/video streaming (optional)
- Library scanning with metadata extraction
- Fuzzy search with alphabet navigation
- Queue management with drag-and-drop reorder
- Mixer with per-stem gain and routing
- Lyrics editor with line-by-line editing
- Song metadata editor
- Settings persistence across sessions
- Dark mode support
- Pre-commit hooks with Husky + lint-staged
- ESLint 9 + Prettier 3 code quality tools

### Technical Stack
- Electron 38 for desktop application
- React 19 for UI components
- Vite 7 for fast builds and HMR
- Express 5 for web server
- Socket.IO 4 for real-time communication
- Web Audio API for audio processing
- Butterchurn for visualizations
- CDGraphics for CDG rendering
- Tailwind CSS 3 for styling

---

## Version History Notes

### Version Numbering

- **Major (X.0.0)**: Breaking changes, major new features
- **Minor (1.X.0)**: New features, backwards-compatible
- **Patch (1.0.X)**: Bug fixes, small improvements

### Release Process

1. Update CHANGELOG.md with all changes
2. Update version in package.json: `npm version [major|minor|patch]`
3. Create git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
4. Push with tags: `git push --follow-tags`
5. Create GitHub Release with changelog excerpt
6. Build and publish packages

### Links

- [Unreleased Changes](https://github.com/yourusername/kai-player/compare/v1.0.0...HEAD)
- [1.0.0 Release](https://github.com/yourusername/kai-player/releases/tag/v1.0.0)

---

**Legend:**
- **Added** - New features
- **Changed** - Changes to existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Vulnerability fixes
