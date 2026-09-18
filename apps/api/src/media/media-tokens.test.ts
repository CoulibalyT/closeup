import { describe, expect, it } from 'vitest';
import { MediaTokens } from './media-tokens.js';

const NOW = 1_700_000_000_000;
const tokens = new MediaTokens('a-secret-that-is-long-enough-for-tests-0123456789', 45_000);
const cropId = '0198c2f4-7b1e-7c3a-9f00-aabbccddeeff';

describe('MediaTokens', () => {
  it('round-trips a kind and an id', () => {
    const token = tokens.seal('crop', cropId, NOW);
    expect(tokens.open(token, NOW + 1_000)).toEqual({ kind: 'crop', id: cropId });
  });

  it('is URL safe', () => {
    expect(tokens.seal('image', cropId, NOW)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never gives the same token twice, so a crop cannot be recognised across games', () => {
    const a = tokens.seal('crop', cropId, NOW);
    const b = tokens.seal('crop', cropId, NOW);
    expect(a).not.toBe(b);
  });

  it('does not carry the id in the clear', () => {
    const token = tokens.seal('crop', cropId, NOW);
    const decoded = Buffer.from(token, 'base64url').toString('latin1');
    expect(decoded).not.toContain(cropId);
    expect(decoded).not.toContain('crop');
  });

  it('expires', () => {
    const token = tokens.seal('crop', cropId, NOW);
    expect(tokens.open(token, NOW + 45_000)).not.toBeNull();
    expect(tokens.open(token, NOW + 45_001)).toBeNull();
  });

  it('rejects a token that was altered, truncated or made up', () => {
    const token = tokens.seal('crop', cropId, NOW);
    const flipped = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1);
    expect(tokens.open(flipped, NOW)).toBeNull();
    expect(tokens.open(token.slice(0, 20), NOW)).toBeNull();
    expect(tokens.open('not-a-token', NOW)).toBeNull();
    expect(tokens.open('', NOW)).toBeNull();
  });

  it('cannot be opened with another secret', () => {
    const other = new MediaTokens('another-secret-that-is-also-long-enough-9876543210', 45_000);
    expect(other.open(tokens.seal('crop', cropId, NOW), NOW)).toBeNull();
  });

  it('refuses a short secret', () => {
    expect(() => new MediaTokens('too short', 45_000)).toThrow(/32/);
  });
});
