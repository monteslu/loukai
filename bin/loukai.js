#!/usr/bin/env node

/**
 * Loukai Karaoke - CLI Launcher
 * 
 * Launches the Loukai Karaoke Electron app in production mode.
 * 
 * Usage: npx loukai
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.join(__dirname, '..');

// Find the electron binary
const require = createRequire(import.meta.url);
const electronPath = require('electron');

// Launch Electron pointing at the app root
const child = spawn(electronPath, [appRoot, '--no-sandbox'], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('close', (code) => {
  process.exit(code);
});
