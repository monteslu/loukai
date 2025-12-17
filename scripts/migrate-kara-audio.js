#!/usr/bin/env node
/**
 * Migrate existing .stem.m4a files to remove redundant audio section from kara atom
 *
 * The audio sources are now read from the NI Stems 'stem' atom, so we no longer
 * store them in the kara atom. This script cleans up existing files.
 *
 * Usage:
 *   node scripts/migrate-kara-audio.js <file.stem.m4a>
 *   node scripts/migrate-kara-audio.js <file1.stem.m4a> <file2.stem.m4a> ...
 *
 * For glob patterns, use shell expansion:
 *   node scripts/migrate-kara-audio.js /path/to/folder/*.stem.m4a
 */

import { Atoms as M4AAtoms } from 'm4a-stems';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';

/**
 * Migrate a single stem file to remove audio from kara atom
 * @param {string} filePath - Path to .stem.m4a file
 * @returns {Promise<Object>} Migration result
 */
async function migrateFile(filePath) {
  const fileName = basename(filePath);
  console.log(`\n📄 Processing: ${fileName}`);

  try {
    // Read existing kara atom
    let karaData;
    try {
      karaData = await M4AAtoms.readKaraAtom(filePath);
    } catch {
      console.log(`  ⚠️  No kara atom found - skipping`);
      return { success: true, skipped: true, reason: 'no kara atom' };
    }

    // Check if audio section exists
    if (!karaData.audio) {
      console.log(`  ✓ Already migrated (no audio section)`);
      return { success: true, skipped: true, reason: 'already migrated' };
    }

    // Preserve encoder_delay_samples in timing if it was in audio
    if (karaData.audio.encoder_delay_samples && !karaData.timing?.encoder_delay_samples) {
      karaData.timing = karaData.timing || {};
      karaData.timing.encoder_delay_samples = karaData.audio.encoder_delay_samples;
    }

    // Remove the audio section
    delete karaData.audio;

    // Write updated kara atom
    await M4AAtoms.writeKaraAtom(filePath, karaData);

    console.log(`  ✅ Migrated successfully (removed audio section)`);
    return { success: true, migrated: true };
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/migrate-kara-audio.js <file.stem.m4a> [file2.stem.m4a ...]');
    console.log('');
    console.log('This script migrates existing stem files to remove the redundant');
    console.log('audio section from the kara atom. Audio sources are now read from');
    console.log('the NI Stems atom instead.');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/migrate-kara-audio.js "Artist - Song.stem.m4a"');
    console.log('  node scripts/migrate-kara-audio.js /path/to/music/*.stem.m4a');
    process.exit(1);
  }

  // Resolve paths and filter to existing .stem.m4a files
  const files = args
    .map((f) => resolve(f))
    .filter((f) => {
      if (!existsSync(f)) {
        console.warn(`  File not found: ${f}`);
        return false;
      }
      if (!f.endsWith('.stem.m4a') && !f.endsWith('.stem.mp4')) {
        console.warn(`  Not a stem file: ${f}`);
        return false;
      }
      return true;
    });

  if (files.length === 0) {
    console.error('No valid .stem.m4a files found');
    process.exit(1);
  }

  console.log(`\n🔄 Migrating ${files.length} stem file(s)...`);

  const results = {
    total: files.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const filePath of files) {
    const result = await migrateFile(filePath);
    if (result.success) {
      if (result.migrated) {
        results.migrated++;
      } else if (result.skipped) {
        results.skipped++;
      }
    } else {
      results.failed++;
    }
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`   Migrated: ${results.migrated}`);
  console.log(`   Skipped:  ${results.skipped}`);
  console.log(`   Failed:   ${results.failed}`);

  process.exit(results.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
