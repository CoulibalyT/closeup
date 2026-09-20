import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id (the library's default algorithm) with OWASP's minimum parameters: 19 MiB, 2 passes,
 * 1 lane. Modest on purpose: the API shares a small VPS, and a login is rate limited anyway.
 * The parameters travel inside the hash, so they can be raised later without a migration.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed hash is a failed login, not a crash.
    return false;
  }
}
