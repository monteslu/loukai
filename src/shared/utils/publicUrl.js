/**
 * Public URL override.
 *
 * The address the app advertises (QR code on the canvas, the link in the status
 * bar) is normally derived from the detected LAN IP and the listening port. That
 * is wrong whenever something else fronts the server: a reverse proxy, a tunnel,
 * or a hostname on the local network. This lets the KJ state the address singers
 * should actually reach.
 *
 * Kept as a pure function so the main process, the renderer's validation hint,
 * and the tests all agree on what counts as usable.
 */

/**
 * Normalize a user-typed override into something a phone camera can open.
 * Accepts "example.com/karaoke" (assumes https) as well as full URLs, trims
 * whitespace, and drops a trailing slash.
 *
 * @returns {string|null} the normalized URL, or null if unusable
 */
export function normalizePublicUrl(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  // A bare host/path is the common typo-shaped input; assume https rather than
  // rejecting it, since a proxy that needs an override is almost always TLS.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  // A QR code has to open in a browser; anything else (file:, javascript:) is
  // not a place to send a singer.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;

  const normalized = parsed.toString();
  return normalized.endsWith('/') && parsed.pathname === '/' ? normalized.slice(0, -1) : normalized;
}

/**
 * The address to advertise, given the server settings and the detected local
 * URL. Falls back to the local URL whenever the override is off or unusable, so
 * a half-typed value can never black out the QR code.
 */
export function resolvePublicUrl(settings, localUrl) {
  if (settings?.publicUrlEnabled) {
    const override = normalizePublicUrl(settings.publicUrl);
    if (override) return override;
  }
  return localUrl ?? null;
}
