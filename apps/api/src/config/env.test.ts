import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://closeup:closeup@localhost:5432/closeup',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('coerces the port and splits CORS origins', () => {
    const env = parseEnv({
      ...valid,
      API_PORT: '4000',
      CORS_ORIGINS: 'http://localhost:3000, http://localhost:3100 ,',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3100']);
  });

  it('names every offending variable', () => {
    expect(() => parseEnv({ REDIS_URL: 'not a url', API_PORT: '99999' })).toThrowError(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*API_PORT|API_PORT[\s\S]*DATABASE_URL[\s\S]*REDIS_URL/,
    );
  });
});
