#!/usr/bin/env node
/**
 * Rename build artifacts to use x86_64/aarch64 instead of x64/arm64
 * for consistent Linux-style naming across all platforms
 */

import { readdir, rename } from 'fs/promises';
import { join } from 'path';

const archMap = {
  '-linux-x64.': '-linux-x86_64.',
  '-linux-arm64.': '-linux-aarch64.',
  '-macos-x64.': '-macos-x86_64.',
  '-macos-arm64.': '-macos-aarch64.',
  '-windows-x64.': '-windows-x86_64.',
  '-windows-arm64.': '-windows-aarch64.',
};

const distDir = 'dist';

async function renameArtifacts() {
  try {
    const files = await readdir(distDir);

    for (const file of files) {
      // Skip flatpak files - they already use x86_64/aarch64
      if (file.includes('.flatpak')) {
        console.log(`Skipped (already correct): ${file}`);
        continue;
      }

      let newName = file;

      // Replace arch names
      for (const [oldPattern, newPattern] of Object.entries(archMap)) {
        if (newName.includes(oldPattern)) {
          newName = newName.replace(oldPattern, newPattern);
        }
      }

      // If name changed, rename the file
      if (newName !== file) {
        const oldPath = join(distDir, file);
        const newPath = join(distDir, newName);
        await rename(oldPath, newPath);
        console.log(`✅ Renamed: ${file} -> ${newName}`);
      }
    }

    console.log('\n✅ All artifacts renamed to x86_64/aarch64 format');
  } catch (error) {
    console.error('❌ Error renaming artifacts:', error);
    process.exit(1);
  }
}

renameArtifacts();
