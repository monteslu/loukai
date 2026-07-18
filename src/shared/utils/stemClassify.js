/**
 * Stem classification heuristics — pure, name-keyword based.
 *
 * Extracted verbatim from KAIPlayer (isVocalStem/isMixdownStem/isMelodicStem) so the
 * rules are unit-testable and shared by the stem×bus mixer (runtime defaults for
 * unknown stems, §5.1 of the plan) without touching Web Audio. KAIPlayer switches to
 * these in the audio-graph step; keep the logic IDENTICAL to what shipped there.
 */

const VOCAL_KEYWORDS = ['vocals', 'vocal', 'voice', 'lead', 'singing', 'vox'];

export function isVocalStem(stemName) {
  const lowerName = String(stemName || '').toLowerCase();
  return VOCAL_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

// Mixdown stems contain the full mix and are skipped when individual stems exist.
const MIXDOWN_KEYWORDS = ['mixdown', 'mix', 'master', 'full mix', 'stereo mix'];

export function isMixdownStem(stemName) {
  const lowerName = String(stemName || '').toLowerCase();
  return MIXDOWN_KEYWORDS.some(
    (keyword) =>
      lowerName === keyword ||
      lowerName.includes(`_${keyword}`) ||
      lowerName.includes(`${keyword}_`)
  );
}

// True for stems containing melodic instruments (typically "other") — the best
// pitch-detection melody reference. Unknown stems default to melodic.
export function isMelodicStem(stemName) {
  const lowerName = String(stemName || '').toLowerCase();

  if (
    lowerName.includes('other') ||
    lowerName.includes('music') ||
    lowerName.includes('instrumental') ||
    lowerName.includes('accompaniment') ||
    lowerName.includes('melody')
  ) {
    return true;
  }

  if (isVocalStem(stemName)) return false;
  if (lowerName.includes('drum') || lowerName.includes('percussion')) return false;
  if (lowerName.includes('bass')) return false;

  return true;
}
