import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ackSchema, fail, nicknameSchema, ok, roomCodeSchema } from './common.js';
import { handshakeAuthSchema, roomJoinSchema, roundGuessSchema, timePingSchema } from './events.js';
import { readinessSchema } from './rest.js';

describe('roomCodeSchema', () => {
  it('normalises what people type', () => {
    expect(roomCodeSchema.parse('  ab2cd ')).toBe('AB2CD');
  });

  it.each(['AB2C', 'AB2CDE', 'AB0CD', 'AB1CD', 'ABICD', 'ABOCD', 'ABLCD', 'AB-CD'])(
    'rejects %s',
    (code) => {
      expect(roomCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});

describe('nicknameSchema', () => {
  it('trims and enforces 2 to 16 characters', () => {
    expect(nicknameSchema.parse('  Awa ')).toBe('Awa');
    expect(nicknameSchema.safeParse('A').success).toBe(false);
    expect(nicknameSchema.safeParse('x'.repeat(17)).success).toBe(false);
  });
});

describe('event payloads', () => {
  it('time:ping needs a numeric t0', () => {
    expect(timePingSchema.safeParse({ t0: 12 }).success).toBe(true);
    expect(timePingSchema.safeParse({ t0: '12' }).success).toBe(false);
    expect(timePingSchema.safeParse({}).success).toBe(false);
  });

  it('room:join only knows players and screens', () => {
    const base = { code: 'ab2cd', nickname: 'Moussa' };
    expect(roomJoinSchema.parse({ ...base, role: 'screen' }).code).toBe('AB2CD');
    expect(roomJoinSchema.safeParse({ ...base, role: 'admin' }).success).toBe(false);
  });

  it('round:guess rejects blank and oversized text', () => {
    expect(roundGuessSchema.safeParse({ roundId: 'r1', text: '   ' }).success).toBe(false);
    expect(roundGuessSchema.safeParse({ roundId: 'r1', text: 'x'.repeat(81) }).success).toBe(false);
  });

  it('handshake requires an integer protocol version', () => {
    expect(handshakeAuthSchema.safeParse({ protocolVersion: 1 }).success).toBe(true);
    expect(handshakeAuthSchema.safeParse({ protocolVersion: 1.5 }).success).toBe(false);
    expect(handshakeAuthSchema.safeParse({}).success).toBe(false);
  });
});

describe('ack envelope', () => {
  const schema = ackSchema(z.object({ t1: z.number() }));

  it('round-trips success and failure', () => {
    expect(schema.parse(ok({ t1: 5 }))).toEqual({ ok: true, data: { t1: 5 } });
    expect(schema.parse(fail('RATE_LIMITED', 'slow down'))).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'slow down' },
    });
  });

  it('rejects an unknown error code', () => {
    expect(schema.safeParse({ ok: false, error: { code: 'NOPE', message: '' } }).success).toBe(
      false,
    );
  });
});

describe('readinessSchema', () => {
  it('accepts the Terminus body, extra fields included', () => {
    const body = {
      status: 'error',
      info: { postgres: { status: 'up' } },
      error: { redis: { status: 'down', message: 'timeout' } },
      details: { postgres: { status: 'up' }, redis: { status: 'down', message: 'timeout' } },
    };
    expect(readinessSchema.parse(body).details.redis?.status).toBe('down');
  });
});
