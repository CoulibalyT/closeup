import { describe, expect, it } from 'vitest';
import { hashToken, newDeviceToken, readCookie } from './device-token.js';

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('theme=dark; closeup_device=abc123; lang=fr', 'closeup_device')).toBe(
      'abc123',
    );
  });

  it('does not confuse a cookie with one whose name merely ends the same', () => {
    expect(readCookie('xcloseup_device=evil; closeup_device=good', 'closeup_device')).toBe('good');
  });

  it('decodes the value and copes with a missing header', () => {
    expect(readCookie('closeup_device=a%2Bb', 'closeup_device')).toBe('a+b');
    expect(readCookie(undefined, 'closeup_device')).toBeUndefined();
    expect(readCookie('', 'closeup_device')).toBeUndefined();
    expect(readCookie('closeup_device=%E0%A4%A', 'closeup_device')).toBeUndefined();
  });
});

describe('device tokens', () => {
  it('are long, URL safe and different every time', () => {
    const a = newDeviceToken();
    const b = newDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('are stored as a hash that does not reveal them', () => {
    const token = newDeviceToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});
