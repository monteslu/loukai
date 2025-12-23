/**
 * Musical Key Detection
 * Detects the musical key from CREPE pitch data using Krumhansl-Schmuckler algorithm
 */

// Note names for output
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler key profiles (normalized weights for each pitch class)
// These represent how often each scale degree appears in typical major/minor music
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Normalize an array so values sum to 1
 */
function normalize(arr) {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum === 0) return arr.map(() => 0);
  return arr.map((v) => v / sum);
}

/**
 * Calculate Pearson correlation coefficient between two arrays
 */
function correlation(arr1, arr2) {
  const n = arr1.length;
  if (n !== arr2.length || n === 0) return 0;

  const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
  const mean2 = arr2.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let sum1Sq = 0;
  let sum2Sq = 0;

  for (let i = 0; i < n; i++) {
    const diff1 = arr1[i] - mean1;
    const diff2 = arr2[i] - mean2;
    numerator += diff1 * diff2;
    sum1Sq += diff1 * diff1;
    sum2Sq += diff2 * diff2;
  }

  const denominator = Math.sqrt(sum1Sq * sum2Sq);
  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Rotate array by n positions (for testing different root notes)
 */
function rotate(arr, n) {
  const len = arr.length;
  const shift = ((n % len) + len) % len;
  return [...arr.slice(shift), ...arr.slice(0, shift)];
}

/**
 * Detect musical key from CREPE pitch data
 *
 * @param {Object} pitchData - CREPE output with pitch_data containing midi array and confidence
 * @param {number} confidenceThreshold - Minimum confidence to include a pitch (0-1)
 * @returns {Object} { key: 'C major', confidence: 0.85, pitchHistogram: [...] }
 */
export function detectKey(pitchData, confidenceThreshold = 0.7) {
  if (!pitchData?.pitch_data) {
    return { key: 'unknown', confidence: 0, method: 'no_data' };
  }

  const { midi, confidence } = pitchData.pitch_data;

  if (!midi || !confidence || midi.length === 0) {
    return { key: 'unknown', confidence: 0, method: 'no_pitch_data' };
  }

  // Build pitch class histogram (0-11) from valid pitches
  const pitchHistogram = new Array(12).fill(0);
  let validCount = 0;

  for (let i = 0; i < midi.length; i++) {
    const midiNote = midi[i];
    const conf = confidence[i];

    // Skip low confidence or invalid pitches
    if (conf < confidenceThreshold || midiNote <= 0 || !isFinite(midiNote)) {
      continue;
    }

    // Get pitch class (0-11) from MIDI note
    const pitchClass = Math.round(midiNote) % 12;
    pitchHistogram[pitchClass]++;
    validCount++;
  }

  if (validCount < 10) {
    return { key: 'unknown', confidence: 0, method: 'insufficient_data' };
  }

  // Normalize histogram and profiles
  const normalizedHistogram = normalize(pitchHistogram);
  const normalizedMajor = normalize(MAJOR_PROFILE);
  const normalizedMinor = normalize(MINOR_PROFILE);

  // Test all 24 keys (12 major + 12 minor) and find best correlation
  let bestKey = 'C';
  let bestMode = 'major';
  let bestCorrelation = -1;

  for (let root = 0; root < 12; root++) {
    // Test major key with this root
    const shiftedMajor = rotate(normalizedMajor, root);
    const corrMajor = correlation(normalizedHistogram, shiftedMajor);

    if (corrMajor > bestCorrelation) {
      bestCorrelation = corrMajor;
      bestKey = NOTE_NAMES[root];
      bestMode = 'major';
    }

    // Test minor key with this root
    const shiftedMinor = rotate(normalizedMinor, root);
    const corrMinor = correlation(normalizedHistogram, shiftedMinor);

    if (corrMinor > bestCorrelation) {
      bestCorrelation = corrMinor;
      bestKey = NOTE_NAMES[root];
      bestMode = 'minor';
    }
  }

  const keyString = bestCorrelation > 0 ? `${bestKey} ${bestMode}` : 'unknown';

  return {
    key: keyString,
    confidence: Math.max(0, bestCorrelation),
    method: 'krumhansl_schmuckler',
    pitchHistogram: pitchHistogram,
    validPitchCount: validCount,
  };
}

/**
 * Convert key string to Camelot notation (used by DJs)
 * e.g., "C major" -> "8B", "A minor" -> "8A"
 */
export function keyToCamelot(keyString) {
  const camelotMap = {
    'C major': '8B',
    'G major': '9B',
    'D major': '10B',
    'A major': '11B',
    'E major': '12B',
    'B major': '1B',
    'F# major': '2B',
    'C# major': '3B',
    'G# major': '4B',
    'D# major': '5B',
    'A# major': '6B',
    'F major': '7B',
    'A minor': '8A',
    'E minor': '9A',
    'B minor': '10A',
    'F# minor': '11A',
    'C# minor': '12A',
    'G# minor': '1A',
    'D# minor': '2A',
    'A# minor': '3A',
    'F minor': '4A',
    'C minor': '5A',
    'G minor': '6A',
    'D minor': '7A',
  };

  return camelotMap[keyString] || '';
}

/**
 * Convert key string to Open Key notation (alternative to Camelot)
 * e.g., "C major" -> "1d", "A minor" -> "1m"
 */
export function keyToOpenKey(keyString) {
  const openKeyMap = {
    'C major': '1d',
    'G major': '2d',
    'D major': '3d',
    'A major': '4d',
    'E major': '5d',
    'B major': '6d',
    'F# major': '7d',
    'C# major': '8d',
    'G# major': '9d',
    'D# major': '10d',
    'A# major': '11d',
    'F major': '12d',
    'A minor': '1m',
    'E minor': '2m',
    'B minor': '3m',
    'F# minor': '4m',
    'C# minor': '5m',
    'G# minor': '6m',
    'D# minor': '7m',
    'A# minor': '8m',
    'F minor': '9m',
    'C minor': '10m',
    'G minor': '11m',
    'D minor': '12m',
  };

  return openKeyMap[keyString] || '';
}
