#!/usr/bin/env node
/**
 * Repair existing .stem.m4a files to fix NI Stems metadata
 *
 * Usage:
 *   node scripts/repair-stems.js <file.stem.m4a>
 *   node scripts/repair-stems.js <file1.stem.m4a> <file2.stem.m4a> ...
 *   node scripts/repair-stems.js --force <file.stem.m4a>  # Force rewrite even if valid
 *
 * For glob patterns, use shell expansion:
 *   node scripts/repair-stems.js /path/to/folder/*.stem.m4a
 */

import { repairStemFile, repairStemFiles } from '../src/main/creator/stemBuilder.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

async function main() {
  const args = process.argv.slice(2);

  // Check for --force flag
  const forceIndex = args.indexOf('--force');
  const force = forceIndex !== -1;
  if (force) {
    args.splice(forceIndex, 1);
  }

  if (args.length === 0) {
    console.log('Usage: node scripts/repair-stems.js [--force] <file.stem.m4a> [file2.stem.m4a ...]');
    console.log('');
    console.log('This script repairs existing stem files to fix NI Stems metadata');
    console.log('so they are properly recognized by Mixxx, Traktor, and other DJ software.');
    console.log('');
    console.log('Options:');
    console.log('  --force    Force rewrite metadata even if already valid');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/repair-stems.js "Artist - Song.stem.m4a"');
    console.log('  node scripts/repair-stems.js /path/to/music/*.stem.m4a');
    console.log('  node scripts/repair-stems.js --force "Artist - Song.stem.m4a"');
    process.exit(1);
  }

  // Resolve paths and filter to existing .stem.m4a files
  const files = args
    .map(f => resolve(f))
    .filter(f => {
      if (!existsSync(f)) {
        console.warn(`⚠️  File not found: ${f}`);
        return false;
      }
      if (!f.endsWith('.stem.m4a') && !f.endsWith('.stem.mp4')) {
        console.warn(`⚠️  Not a stem file: ${f}`);
        return false;
      }
      return true;
    });

  if (files.length === 0) {
    console.error('No valid .stem.m4a files found');
    process.exit(1);
  }

  console.log(`\n🔧 Checking ${files.length} stem file(s)...${force ? ' (force mode)' : ''}\n`);

  if (files.length === 1) {
    const result = await repairStemFile(files[0], { force });
    process.exit(result.success ? 0 : 1);
  } else {
    const results = await repairStemFiles(files, { force });
    process.exit(results.failed === 0 ? 0 : 1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
