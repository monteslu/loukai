# Contributing to Loukai

Thank you for your interest in contributing to Loukai! This document provides guidelines and instructions for contributing to the project.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)
- [Resources](#resources)

---

## Code of Conduct

### Our Standards

- **Be Respectful**: Treat all contributors with respect and kindness
- **Be Constructive**: Provide helpful feedback and suggestions
- **Be Collaborative**: Work together to improve the project
- **Be Patient**: Remember that everyone has different skill levels

### Unacceptable Behavior

- Harassment, discrimination, or personal attacks
- Trolling, insulting comments, or inflammatory language
- Publishing others' private information
- Any conduct that could be considered inappropriate in a professional setting

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js 24+** (matches CI; Vite 7 needs at least 20.19/22.12)
- **npm 10+** (bundled with Node 24)
- **Git**
- **Code Editor** (VS Code recommended)

### Initial Setup

1. **Fork the Repository**

   Click the "Fork" button on GitHub to create your own copy.

2. **Clone Your Fork**

   ```bash
   git clone https://github.com/YOUR_USERNAME/loukai.git
   cd loukai
   ```

3. **Add Upstream Remote**

   ```bash
   git remote add upstream https://github.com/monteslu/loukai.git
   ```

4. **Install Dependencies**

   ```bash
   npm install
   ```

5. **Verify Setup**

   ```bash
   # Run tests
   npm test

   # Run lint
   npm run lint

   # Start dev server
   npm run dev
   ```

### VS Code Setup (Recommended)

This project includes VS Code configuration files:

1. **Install Recommended Extensions**

   When you open the project, VS Code will prompt you to install recommended extensions:
   - ESLint
   - Prettier
   - Vitest

2. **Enable Format on Save**

   Already configured in `.vscode/settings.json`

3. **Use Debugging Configs**

   Debug configurations available in `.vscode/launch.json`

---

## Development Workflow

### Branch Strategy

We use a simple branching model:

- **`main`** - Production-ready code
- **`feature/*`** - New features (e.g., `feature/add-playlist-support`)
- **`fix/*`** - Bug fixes (e.g., `fix/audio-sync-issue`)
- **`docs/*`** - Documentation updates (e.g., `docs/api-reference`)
- **`test/*`** - Test additions/improvements (e.g., `test/queue-service`)
- **`refactor/*`** - Code refactoring (e.g., `refactor/mixer-logic`)

### Creating a Feature Branch

```bash
# Update your fork
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name
```

### Development Cycle

1. **Make Changes**

   Write your code following our [Coding Standards](#coding-standards)

2. **Test Your Changes**

   ```bash
   # Run tests
   npm test

   # Run specific test file
   npm test src/shared/services/myService.test.js

   # Run with coverage
   npm run test:coverage
   ```

3. **Lint and Format**

   ```bash
   # Lint (auto-fix)
   npm run lint:fix

   # Format all files
   npm run format
   ```

4. **Commit Changes**

   See [Commit Guidelines](#commit-guidelines) below

5. **Push to Your Fork**

   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create Pull Request**

   See [Pull Request Process](#pull-request-process) below

---

## Coding Standards

### General Principles

- **Keep It Simple**: Prefer simple, readable code over clever solutions
- **DRY**: Don't Repeat Yourself - extract common logic
- **Single Responsibility**: Each function/component should do one thing well
- **No TypeScript**: This is a JavaScript-only project

### JavaScript Style

We use **ESLint** and **Prettier** for code style enforcement.

#### Key Guidelines

```javascript
// ✅ Good: Use const/let, never var
const player = new AudioPlayer();
let currentSong = null;

// ✅ Good: Descriptive names
function calculateStemGain(volumeDb, pan) { }

// ❌ Bad: Unclear abbreviations
function calcStmGn(v, p) { }

// ✅ Good: Early returns for error handling
function loadSong(path) {
  if (!path) {
    return { success: false, error: 'Path required' };
  }

  const song = parseSong(path);
  return { success: true, song };
}

// ❌ Bad: Nested conditionals
function loadSong(path) {
  if (path) {
    const song = parseSong(path);
    if (song) {
      return { success: true, song };
    } else {
      return { success: false, error: 'Parse failed' };
    }
  } else {
    return { success: false, error: 'Path required' };
  }
}

// ✅ Good: Consistent error handling
export function myFunction(param) {
  try {
    // ... logic
    return { success: true, data };
  } catch (error) {
    console.error('Error in myFunction:', error);
    return { success: false, error: error.message };
  }
}
```

### React Guidelines

```javascript
// ✅ Good: Functional components with hooks
export function PlayerControls({ playback, onPlay, onPause }) {
  const [volume, setVolume] = useState(1.0);

  useEffect(() => {
    // Side effects here
  }, [dependencies]);

  return (
    <div>
      {/* JSX */}
    </div>
  );
}

// ✅ Good: Prop destructuring
export function SongCard({ title, artist, duration }) { }

// ❌ Bad: Props object
export function SongCard(props) {
  return <div>{props.title}</div>;
}

// ✅ Good: Conditional rendering
{isPlaying ? <PauseIcon /> : <PlayIcon />}

// ❌ Bad: Ternary with null
{isPlaying ? <PauseIcon /> : null}
{isPlaying && <PlayIcon />}  // Use this instead
```

### File Naming

- **Components**: `PascalCase.jsx` (e.g., `PlayerControls.jsx`)
- **Services**: `camelCase.js` (e.g., `queueService.js`)
- **Tests**: `*.test.js` (e.g., `queueService.test.js`)
- **Config**: `kebab-case.js` (e.g., `vite.config.js`)

### Import Order

```javascript
// 1. Node built-ins
import path from 'path';
import fs from 'fs/promises';

// 2. External dependencies
import React, { useState, useEffect } from 'react';
import { formatDuration } from '../utils';

// 3. Internal modules (absolute imports)
import { queueService } from '@shared/services';

// 4. Relative imports (same directory/parent)
import { PlayerControls } from './PlayerControls';
import '../styles.css';
```

### Comments

```javascript
// ✅ Good: Explain WHY, not WHAT
// Debounce search to avoid hammering the file system
const debouncedSearch = debounce(searchLibrary, 300);

// ❌ Bad: Obvious comments
// Set volume to 0.5
setVolume(0.5);

// ✅ Good: Complex logic documentation
/**
 * Calculate stem gain with pan compensation
 *
 * When panning a stem, reduce gain to maintain
 * perceived loudness (equal-power panning law).
 *
 * @param {number} volumeDb - Volume in dB (-60 to 0)
 * @param {number} pan - Pan position (-1 to 1)
 * @returns {number} Compensated gain (0 to 1)
 */
function calculateStemGain(volumeDb, pan) { }
```

---

## Testing Guidelines

### Test Coverage Goals

- **New Features**: 80%+ coverage required
- **Bug Fixes**: Add test reproducing the bug
- **Refactoring**: Maintain or improve existing coverage

### Writing Tests

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as myService from './myService.js';

describe('myService', () => {
  let mockDependency;

  beforeEach(() => {
    // Reset mocks before each test
    mockDependency = {
      doSomething: vi.fn(),
    };
  });

  describe('myFunction', () => {
    it('should handle normal case', () => {
      const result = myService.myFunction('input');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'value' });
    });

    it('should handle error case', () => {
      const result = myService.myFunction(null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Input required');
    });

    it('should call dependency', () => {
      myService.myFunction('input', mockDependency);

      expect(mockDependency.doSomething).toHaveBeenCalledWith('input');
    });
  });
});
```

### Test Organization

- **Unit Tests**: Test individual functions in isolation
- **Integration Tests**: Test interactions between modules
- **Component Tests**: Test React components with Testing Library

### Running Tests

```bash
# Run all tests (watch mode)
npm test

# Run once (CI mode)
npm run test:run

# Run with coverage
npm run test:coverage

# Run specific file
npm test src/shared/services/queueService.test.js

# Run tests matching pattern
npm test queue
```

---

## Commit Guidelines

We follow **Conventional Commits** for clear commit history.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, semicolons, etc.)
- **refactor**: Code refactoring (no functional changes)
- **test**: Adding or updating tests
- **chore**: Build process, dependencies, tooling
- **perf**: Performance improvements

### Examples

```bash
# Feature
git commit -m "feat(mixer): add per-stem EQ controls"

# Bug fix
git commit -m "fix(queue): prevent duplicate songs in queue"

# Documentation
git commit -m "docs: update API reference for queue service"

# Multiple lines
git commit -m "feat(library): add virtual scrolling for large libraries

Implements react-window for efficient rendering of 20K+ songs.
Maintains alphabet navigation and search functionality.

Closes #123"
```

### Commit Hooks

Pre-commit hooks automatically run:
- **Linting** (ESLint)
- **Formatting** (Prettier)
- **Related tests** (Vitest, for staged test files)

If hooks fail, fix the issues and commit again.

---

## Pull Request Process

### Before Creating PR

1. **Ensure Tests Pass**
   ```bash
   npm run test:run
   ```

2. **Ensure Lint Passes**
   ```bash
   npm run lint
   ```

3. **Build Successfully**
   ```bash
   npm run build:all
   ```

4. **Update Documentation**
   - Update README if adding features
   - Update JSDoc comments
   - Add/update tests

### Creating the PR

1. **Push to Your Fork**
   ```bash
   git push origin feature/your-feature
   ```

2. **Open Pull Request on GitHub**
   - Use descriptive title
   - Fill out PR template
   - Link related issues

3. **PR Title Format**
   ```
   feat(component): add new feature
   fix(module): resolve bug
   docs: update contributing guide
   ```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update

## How Has This Been Tested?
Describe tests you ran

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests pass
- [ ] No new warnings generated
```

### Review Process

1. **Automated Checks**
   - Tests must pass
   - Lint must pass
   - Build must succeed

2. **Code Review**
   - At least one approval required
   - Address review comments
   - Push updates to same branch

3. **Merge**
   - Squash and merge (preferred)
   - Rebase and merge (for clean history)
   - Never force-push to main

---

## Project Structure

```
loukai/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.js        # Entry point
│   │   ├── appState.js    # Centralized state
│   │   ├── audioEngine.js # Audio processing
│   │   ├── webServer.js   # Express + Socket.IO
│   │   ├── creator/       # Karaoke file creation (in-browser WebGPU/WASM pipeline)
│   │   │   ├── creatorJob.js
│   │   │   ├── stemBuilder.js
│   │   │   └── webgpuAssets.js  # Same-origin proxy/cache for ONNX & transformers.js models
│   │   └── handlers/      # IPC handlers
│   │       └── autotuneHandlers.js
│   ├── renderer/          # Electron renderer (React)
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── js/            # Audio engine (vanilla JS)
│   │   │   ├── autoTuneWorklet.js
│   │   │   └── playerController.js
│   │   └── vite.config.js
│   ├── web/               # Web admin interface
│   │   ├── App.jsx        # Web admin root
│   │   ├── components/    # Web-specific components
│   │   └── vite.config.js
│   ├── offsite/           # Standalone offsite creator page
│   │   └── vite.config.js
│   ├── shared/            # Shared code (renderer + web)
│   │   ├── components/    # Reusable React components
│   │   ├── services/      # Business logic
│   │   └── utils/         # Utility functions
│   ├── utils/             # Node.js utilities
│   │   ├── m4aLoader.js   # M4A file parsing
│   │   └── cdgLoader.js   # CDG file parsing
│   └── test/              # Test setup
│       └── setup.js       # Vitest config
├── static/                # Static assets
├── docs/                  # Documentation
├── coverage/              # Test coverage reports
└── dist/                  # Build output
```

### Key Directories

- **`src/shared/services/`** - Pure business logic functions
- **`src/shared/components/`** - Reusable React components
- **`src/main/handlers/`** - IPC handlers (one per domain)
- **`src/main/creator/`** - Karaoke file creation (stem separation, lyrics)
- **`src/renderer/js/`** - Audio engine, auto-tune, pitch detection
- **`src/utils/`** - M4A file parsing and utilities

---

## Resources

### Documentation

- [README.md](./README.md) - Project overview
- [docs/m4a_format.md](./docs/m4a_format.md) - M4A Stems karaoke format specification
- [docs/architecture.md](./docs/architecture.md) - System architecture and design

### External Resources

- [React Documentation](https://react.dev/)
- [Electron Documentation](https://www.electronjs.org/docs)
- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Conventional Commits](https://www.conventionalcommits.org/)

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/monteslu/loukai/issues)
- **Discussions**: [GitHub Discussions](https://github.com/monteslu/loukai/discussions)

---

## License

By contributing to Loukai, you agree that your contributions will be licensed under the **AGPL-3.0** license.

---

**Thank you for contributing to Loukai!** 🎤🎵
