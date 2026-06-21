/**
 * Path Validation Utility
 * Prevents path traversal attacks by validating paths against allowed directories
 */

import path from 'path';
import fs from 'fs';

/**
 * Validates that a file path is within the allowed songs directory
 * @param {string} filePath - The path to validate
 * @param {string} songsFolder - The allowed songs directory
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string }}
 */
export function validateSongPath(filePath, songsFolder) {
  // Check for empty/null inputs
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path is required' };
  }

  if (!songsFolder || typeof songsFolder !== 'string') {
    return { valid: false, error: 'Songs folder not configured' };
  }

  // Normalize and resolve both paths to absolute paths
  const resolvedSongsFolder = path.resolve(songsFolder);
  const resolvedFilePath = path.resolve(songsFolder, filePath);

  // Check if the resolved path starts with the songs folder
  // This prevents ../../../etc/passwd style attacks
  if (
    !resolvedFilePath.startsWith(resolvedSongsFolder + path.sep) &&
    resolvedFilePath !== resolvedSongsFolder
  ) {
    return {
      valid: false,
      error: 'Access denied: path is outside songs directory',
    };
  }

  // Additional check: if the path was absolute, verify it's within songs folder
  if (path.isAbsolute(filePath)) {
    const resolvedAbsolute = path.resolve(filePath);
    if (
      !resolvedAbsolute.startsWith(resolvedSongsFolder + path.sep) &&
      resolvedAbsolute !== resolvedSongsFolder
    ) {
      return {
        valid: false,
        error: 'Access denied: absolute path is outside songs directory',
      };
    }
    // Use the absolute path as-is if it's valid
    return { valid: true, resolvedPath: resolvedAbsolute };
  }

  return { valid: true, resolvedPath: resolvedFilePath };
}

/**
 * Validates that a file path is within ANY of the allowed roots (e.g. the songs
 * folder OR the creator uploads dir). Keeps traversal protection — the resolved
 * path must sit inside one of the roots.
 * @param {string} filePath - absolute or relative path to validate
 * @param {string[]} roots - allowed base directories
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string }}
 */
export function validatePathInRoots(filePath, roots) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path is required' };
  }
  const validRoots = (roots || []).filter((r) => r && typeof r === 'string');
  if (validRoots.length === 0) {
    return { valid: false, error: 'No allowed directories configured' };
  }
  for (const root of validRoots) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(root, filePath);
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) {
      return { valid: true, resolvedPath: resolved };
    }
  }
  return { valid: false, error: 'Access denied: path is outside allowed directories' };
}

/**
 * Validates a base64-encoded path (used in editor audio endpoints)
 * @param {string} encodedPath - The base64url encoded path
 * @param {string} songsFolder - The allowed songs directory
 * @returns {{ valid: boolean, decodedPath?: string, error?: string }}
 */
export function validateBase64Path(encodedPath, songsFolder) {
  if (!encodedPath || typeof encodedPath !== 'string') {
    return { valid: false, error: 'Encoded path is required' };
  }

  try {
    const decoded = Buffer.from(encodedPath, 'base64url').toString('utf8');

    // The decoded format is "path:filename" or "path:trackName:trackIndex"
    const parts = decoded.split(':');
    if (parts.length < 2) {
      return { valid: false, error: 'Invalid encoded path format' };
    }

    const filePath = parts[0];

    // Validate the file path portion
    const validation = validateSongPath(filePath, songsFolder);
    if (!validation.valid) {
      return validation;
    }

    return {
      valid: true,
      decodedPath: decoded,
      resolvedPath: validation.resolvedPath,
    };
  } catch {
    return { valid: false, error: 'Invalid base64 encoding' };
  }
}

/**
 * Check if a path exists and is a file
 * @param {string} filePath - The path to check
 * @returns {boolean}
 */
export function isValidFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export default {
  validateSongPath,
  validatePathInRoots,
  validateBase64Path,
  isValidFile,
};
