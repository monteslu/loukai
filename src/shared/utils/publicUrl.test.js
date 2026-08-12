import { describe, it, expect } from 'vitest';
import { normalizePublicUrl, resolvePublicUrl } from './publicUrl.js';

describe('normalizePublicUrl', () => {
  it('keeps a full https URL', () => {
    expect(normalizePublicUrl('https://karaoke.example.com')).toBe('https://karaoke.example.com');
  });

  it('keeps an explicit http URL (a plain LAN hostname behind a proxy)', () => {
    expect(normalizePublicUrl('http://karaoke.local:8080')).toBe('http://karaoke.local:8080');
  });

  it('assumes https for a bare host', () => {
    expect(normalizePublicUrl('karaoke.example.com')).toBe('https://karaoke.example.com');
  });

  it('keeps a path (proxy mounted on a subpath)', () => {
    expect(normalizePublicUrl('example.com/karaoke')).toBe('https://example.com/karaoke');
  });

  it('trims surrounding whitespace from a paste', () => {
    expect(normalizePublicUrl('  https://karaoke.example.com  ')).toBe(
      'https://karaoke.example.com'
    );
  });

  it('drops a trailing slash on the root so it matches what users expect', () => {
    expect(normalizePublicUrl('https://karaoke.example.com/')).toBe('https://karaoke.example.com');
  });

  it('rejects empty and whitespace-only input', () => {
    expect(normalizePublicUrl('')).toBeNull();
    expect(normalizePublicUrl('   ')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizePublicUrl(null)).toBeNull();
    expect(normalizePublicUrl(undefined)).toBeNull();
    expect(normalizePublicUrl(42)).toBeNull();
  });

  it('rejects schemes a phone camera cannot open', () => {
    expect(normalizePublicUrl('file:///etc/passwd')).toBeNull();
    expect(normalizePublicUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePublicUrl('ftp://example.com')).toBeNull();
  });
});

describe('resolvePublicUrl', () => {
  const local = 'http://192.168.1.50:3069';

  it('uses the local address when the override is off', () => {
    expect(resolvePublicUrl({ publicUrlEnabled: false, publicUrl: 'https://x.com' }, local)).toBe(
      local
    );
  });

  it('uses the override when enabled and valid', () => {
    expect(
      resolvePublicUrl({ publicUrlEnabled: true, publicUrl: 'https://karaoke.example.com' }, local)
    ).toBe('https://karaoke.example.com');
  });

  it('falls back to local while the override is still being typed', () => {
    // Half-typed input must never black out the QR code.
    expect(resolvePublicUrl({ publicUrlEnabled: true, publicUrl: 'http://' }, local)).toBe(local);
    expect(resolvePublicUrl({ publicUrlEnabled: true, publicUrl: '' }, local)).toBe(local);
  });

  it('falls back to local for a rejected scheme', () => {
    expect(
      resolvePublicUrl({ publicUrlEnabled: true, publicUrl: 'javascript:alert(1)' }, local)
    ).toBe(local);
  });

  it('tolerates missing settings and a not-yet-started server', () => {
    expect(resolvePublicUrl(undefined, local)).toBe(local);
    expect(resolvePublicUrl({}, null)).toBeNull();
    expect(resolvePublicUrl({ publicUrlEnabled: true, publicUrl: 'https://x.com' }, null)).toBe(
      'https://x.com'
    );
  });
});
