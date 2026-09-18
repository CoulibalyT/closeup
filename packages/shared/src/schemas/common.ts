import { z } from 'zod';
import { NICKNAME, ROOM } from '../constants/game.js';

export const LOCALES = ['fr', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

const roomCodePattern = new RegExp(`^[${ROOM.codeAlphabet}]{${ROOM.codeLength}}$`);
/** Accepts what people actually type ("  ab2cd "), rejects characters the generator never uses. */
export const roomCodeSchema = z.string().trim().toUpperCase().regex(roomCodePattern);

export const nicknameSchema = z.string().trim().min(NICKNAME.minLength).max(NICKNAME.maxLength);

export const idSchema = z.string().min(1).max(64);

export const ERROR_CODES = [
  'INVALID_PAYLOAD',
  'PROTOCOL_MISMATCH',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'NOT_HOST',
  'BAD_PHASE',
  'RATE_LIMITED',
  'LOCKED',
  'FROZEN',
  'BANNED',
  'NICKNAME_REJECTED',
  'BONUS_NOT_OWNED',
  'TARGET_INVALID',
  'TARGET_BUSY',
  'INTERNAL',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorSchema = z.object({ code: errorCodeSchema, message: z.string() });
export type ErrorPayload = z.infer<typeof errorSchema>;

/** Every client → server event is acknowledged with this envelope. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload };

export function ackSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: errorSchema }),
  ]);
}

export const ok = <T>(data: T): Ack<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string): Ack<never> => ({
  ok: false,
  error: { code, message },
});
