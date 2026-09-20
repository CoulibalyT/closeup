import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { SessionUser } from '@closeup/shared';
import type { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { hashToken, newDeviceToken } from '../identity/device-token.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { hashPassword, verifyPassword } from './password.js';
import { LOGIN_LIMIT, SESSION_TTL_MS } from './session-cookie.js';

export type LoginResult =
  | { ok: true; token: string; user: SessionUser }
  | { ok: false; reason: 'INVALID' | 'RATE_LIMITED' | 'UNAVAILABLE' };

const REDIS_TIMEOUT_MS = 1_500;
const attemptsKey = (kind: 'email' | 'ip', value: string) =>
  `closeup:login:${kind}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;

/**
 * Sessions work like device tokens: an opaque random token in an httpOnly cookie, its hash in
 * the database. Phase 5 only has the owner's admin account; phase 6 lets players sign up.
 */
@Injectable()
export class AuthService {
  /** Verified when the email is unknown, so that a miss costs the same time as a wrong password. */
  private decoy?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async login(email: string, password: string, ip: string): Promise<LoginResult> {
    const keys = [attemptsKey('email', email), attemptsKey('ip', ip)] as const;
    let counts: (string | null)[];
    try {
      counts = await withTimeout(this.redis.mget(...keys), REDIS_TIMEOUT_MS, 'redis');
    } catch {
      // Without the counters there is no brute-force protection: the door stays shut.
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    if (
      Number(counts[0] ?? 0) >= LOGIN_LIMIT.perEmail ||
      Number(counts[1] ?? 0) >= LOGIN_LIMIT.perIp
    ) {
      return { ok: false, reason: 'RATE_LIMITED' };
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    this.decoy ??= hashPassword('not-a-real-password');
    const valid = await verifyPassword(user?.passwordHash ?? (await this.decoy), password);
    if (!user || !valid || user.bannedAt) {
      const pipeline = this.redis.multi();
      for (const key of keys) pipeline.incr(key).expire(key, LOGIN_LIMIT.windowS);
      await pipeline.exec();
      return { ok: false, reason: 'INVALID' };
    }

    await this.redis.del(keys[0]);
    const token = newDeviceToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { ok: true, token, user: { id: user.id, email: user.email, role: user.role } };
  }

  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.bannedAt) return null;
    return { id: session.user.id, email: session.user.email, role: session.user.role };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /** For the `admin:create` command. Promotes and resets the password of an existing address. */
  async upsertAdmin(email: string, password: string): Promise<SessionUser> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email, passwordHash, role: 'ADMIN' },
      update: { passwordHash, role: 'ADMIN', bannedAt: null },
    });
    // A new password ends every open session of that account.
    await this.prisma.session.deleteMany({ where: { userId: user.id } });
    return { id: user.id, email: user.email, role: user.role };
  }
}
