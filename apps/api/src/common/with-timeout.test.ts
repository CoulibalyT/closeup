import { describe, expect, it } from 'vitest';
import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the work is fast enough', async () => {
    await expect(withTimeout(Promise.resolve('pong'), 50, 'redis')).resolves.toBe('pong');
  });

  it('rejects with a labelled error when the work hangs', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 20, 'redis')).rejects.toThrow('redis timed out after 20 ms');
  });

  it('passes the original rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('refused')), 50, 'pg')).rejects.toThrow(
      'refused',
    );
  });
});
