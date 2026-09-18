import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type MediaKind = 'crop' | 'image';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KINDS: Record<string, MediaKind> = { c: 'crop', i: 'image' };

/**
 * Opaque, short-lived media URLs. The payload is encrypted (AES-256-GCM), not just signed: a
 * signed token would show the same crop id in every game, enough to build a cheat table of
 * "this id is that answer". With a random IV the same crop never yields the same URL twice.
 */
export class MediaTokens {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly ttlMs: number,
  ) {
    if (secret.length < 32) throw new Error('The media secret must be at least 32 characters');
    this.key = createHash('sha256').update(secret).digest();
  }

  seal(kind: MediaKind, id: string, now: number): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plain = `${kind[0]}|${id}|${now + this.ttlMs}`;
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  /** `null` for anything that is not a token we issued and that is still valid. */
  open(token: string, now: number): { kind: MediaKind; id: string } | null {
    try {
      const raw = Buffer.from(token, 'base64url');
      if (raw.length <= IV_BYTES + TAG_BYTES) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const plain = Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');

      const [k, id, expiresAt] = plain.split('|');
      const kind = KINDS[k ?? ''];
      if (!kind || !id || !(Number(expiresAt) >= now)) return null;
      return { kind, id };
    } catch {
      return null;
    }
  }
}
