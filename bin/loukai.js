#!/usr/bin/env node

/**
 * Loukai Karaoke - CLI Launcher
 *
 * Launches the Loukai Karaoke Electron app in production mode.
 *
 * Usage: npx loukai-app
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

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('Error: Could not find Electron.');
  console.error('Make sure electron is installed: npm install electron');
  process.exit(1);
}

if (typeof electronPath !== 'string') {
  console.error('Error: Invalid electron path');
  process.exit(1);
}

console.log('Starting Loukai Karaoke...');

// Launch Electron pointing at the app root
const child = spawn(electronPath, [appRoot, '--no-sandbox'], {
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('error', (err) => {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
