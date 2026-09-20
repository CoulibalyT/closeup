import { describe, expect, it } from 'vitest';
import { type AdminRequest, sameOrigin } from './admin.guard.js';
import { hashPassword, verifyPassword } from './password.js';

describe('passwords', () => {
  it('are stored as argon2id hashes that only the right password verifies', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery stapl')).toBe(false);
  });

  it('salts: the same password never gives the same hash twice', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('treats a malformed hash as a failed login, not a crash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});

describe('sameOrigin', () => {
  const request = (method: string, headers: AdminRequest['headers']): AdminRequest => ({
    method,
    headers,
  });
  const allowed = ['http://localhost:3100'];

  it('lets reads through wherever they come from', () => {
    expect(sameOrigin(request('GET', { origin: 'https://evil.example' }), allowed)).toBe(true);
  });

  it('accepts a change coming from the web app, in dev (other port) and in prod (same host)', () => {
    expect(sameOrigin(request('POST', { origin: 'http://localhost:3100' }), allowed)).toBe(true);
    expect(
      sameOrigin(
        request('PUT', { origin: 'https://closeup.example', host: 'closeup.example' }),
        [],
      ),
    ).toBe(true);
  });

  it('refuses a change coming from another site, a file upload form included', () => {
    const foreign = { origin: 'https://evil.example', host: 'closeup.example' };
    expect(sameOrigin(request('POST', foreign), allowed)).toBe(false);
    expect(sameOrigin(request('DELETE', foreign), allowed)).toBe(false);
    expect(sameOrigin(request('POST', { origin: 'null', host: 'closeup.example' }), [])).toBe(
      false,
    );
  });

  it('does not get in the way of scripts, which send no Origin', () => {
    expect(sameOrigin(request('POST', { host: 'closeup.example' }), [])).toBe(true);
  });
});
