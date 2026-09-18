import { createHash, randomBytes } from 'node:crypto';
import { brand } from '@closeup/shared';

export const DEVICE_COOKIE = `${brand.codename}_device`;
export const DEVICE_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 400;

/** 256 random bits. The database only ever sees the hash, so a leaked table logs nobody in. */
export const newDeviceToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
