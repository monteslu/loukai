/**
 * Stem×bus mixer — the effective-gain formula and default/merge logic, as PURE
 * functions (no Web Audio), per the audio enhancement plan §5:
 *
 *   stemNodeGain(bus, stem) =
 *       dbToLinear(stem.fileTrimDb)          // authored mix
 *     × stemMix[bus][stem].gain              // user slider 0..1.5 (1.0 = authored)
 *     × (stemMix[bus][stem].muted ? 0 : 1)   // per-stem mute
 *
 * Bus master gain/mute stay on the bus masterGain node and must NOT appear here
 * (double-applying was gotcha #9). The `backup:PA` punchthrough overlays PA-vocals
 * only (D2): while active, the node targets max(userLevel, authored level) — it can
 * ADD vocals for the line but never fights the user downward.
 *
 * This module is the single init path for every per-stem gain node: the graph is
 * rebuilt on every play(), so nodes are always initialized from this formula plus
 * the persisted stemMix state (plan §11.2).
 */

import { isVocalStem } from './stemClassify.js';

/** Canonical display/UI order; unknown stems append in file order after these. */
export const CANONICAL_STEMS = ['drums', 'bass', 'other', 'vocals'];

/** Slider range: 0..150% (unity 1.0 = the authored mix; headroom for jam-along). */
export const STEM_GAIN_MAX = 1.5;

export function dbToLinear(db) {
  return Math.pow(10, (Number(db) || 0) / 20);
}

/** Clamp a user slider value into 0..STEM_GAIN_MAX; non-numbers become unity. */
export function clampStemGain(gain) {
  const g = Number(gain);
  if (!Number.isFinite(g)) return 1;
  return Math.min(STEM_GAIN_MAX, Math.max(0, g));
}

/**
 * Runtime default entry for a stem the persisted stemMix doesn't know (§5.1):
 * audible on PA, muted on IEM — flipped for vocal stems (muted on PA, audible on
 * IEM), preserving the D1 defaults' spirit for unusual stem names.
 */
export function defaultStemEntry(bus, stemName) {
  const vocal = isVocalStem(stemName);
  const mutedOnIem = bus === 'IEM';
  return { gain: 1, muted: vocal ? !mutedOnIem : mutedOnIem };
}

/** The persisted entry for (bus, stem), or the runtime default. Never mutates. */
export function resolveStemEntry(stemMix, bus, stemName) {
  const entry = stemMix?.[bus]?.[stemName];
  if (entry && typeof entry === 'object') {
    return { gain: clampStemGain(entry.gain), muted: Boolean(entry.muted) };
  }
  return defaultStemEntry(bus, stemName);
}

/**
 * The effective gain for one stem's gain node on one bus (§5.2 + §7).
 *
 * @param {Object} opts
 * @param {number} [opts.fileTrimDb=0]  authored per-stem trim from song metadata (dB)
 * @param {number} [opts.userGain=1]    user slider (linear multiplier, clamped 0..1.5)
 * @param {boolean} [opts.muted=false]  per-stem-per-bus mute
 * @param {boolean} [opts.punchthroughActive=false]  backup:PA overlay (PA vocals only)
 * @returns {number} linear gain for the node
 */
export function effectiveStemGain({
  fileTrimDb = 0,
  userGain = 1,
  muted = false,
  punchthroughActive = false,
} = {}) {
  const authored = dbToLinear(fileTrimDb);
  const userLevel = authored * clampStemGain(userGain) * (muted ? 0 : 1);
  if (!punchthroughActive) return userLevel;
  // D2: punchthrough can only ADD vocals — the authored full level wins only when
  // it's above what the user already set.
  return Math.max(userLevel, authored);
}

/**
 * D1 seed: the defaults table for a fresh profile (canonical 4 stems).
 * PA plays the backing mix (vocals muted); IEM is the guide-vocal bus (vocals on,
 * everything else muted; the IEM MASTER stays muted separately as the opt-in guard).
 */
export function seedDefaultStemMix() {
  const seed = { PA: {}, IEM: {} };
  for (const stem of CANONICAL_STEMS) {
    seed.PA[stem] = defaultStemEntry('PA', stem);
    seed.IEM[stem] = defaultStemEntry('IEM', stem);
  }
  return seed;
}

/**
 * Merge a persisted stemMix over the D1 seed: unknown buses are dropped, unknown
 * stem keys are kept (files with unusual stems persist the user's choices), gains
 * are clamped and mutes coerced. Absence of persisted state yields the pure seed
 * (§5.3 migration: no versioning needed, old shape is a strict subset).
 */
export function mergeStemMix(persisted) {
  const out = seedDefaultStemMix();
  for (const bus of ['PA', 'IEM']) {
    const savedBus = persisted?.[bus];
    if (!savedBus || typeof savedBus !== 'object') continue;
    for (const [stemName, entry] of Object.entries(savedBus)) {
      if (!entry || typeof entry !== 'object') continue;
      out[bus][stemName] = {
        gain: clampStemGain(entry.gain),
        muted: Boolean(entry.muted),
      };
    }
  }
  return out;
}

/**
 * Order stem names for display: canonical order first, then the rest in file
 * order. Mixdown stems are the caller's concern (they are filtered from playback
 * and from the UI before ordering).
 */
export function orderStems(stemNames) {
  const names = [...(stemNames || [])];
  const canonical = CANONICAL_STEMS.filter((c) => names.includes(c));
  const rest = names.filter((n) => !CANONICAL_STEMS.includes(n));
  return [...canonical, ...rest];
}
