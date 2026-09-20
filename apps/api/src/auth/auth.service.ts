import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { SessionUser } from '@closeup/shared';
import type { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { hashToken, newDeviceToken } from '../identity/device-token.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { MailService } from '../mail/mail.service.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  FORGOT_LIMIT,
  LOGIN_LIMIT,
  RESET_TTL_MS,
  SESSION_TTL_MS,
  SIGNUP_LIMIT,
} from './session-cookie.js';

export type LoginResult =
  | { ok: true; token: string; user: SessionUser }
  | { ok: false; reason: 'INVALID' | 'RATE_LIMITED' | 'UNAVAILABLE' };

const REDIS_TIMEOUT_MS = 1_500;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const attemptsKey = (kind: 'email' | 'ip', value: string) =>
  `closeup:login:${kind}:${digest(value)}`;

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
    private readonly mail: MailService,
  ) {}

  /** Counts one more event under `key`; false once `max` is passed, or when Redis is away. */
  private async allowed(key: string, max: number, windowS: number): Promise<boolean> {
    try {
      const count = await withTimeout(this.redis.incr(key), REDIS_TIMEOUT_MS, 'redis');
      // The window opens with the first event (works on every Redis, unlike EXPIRE … NX).
      if (count === 1) await this.redis.expire(key, windowS);
      return count <= max;
    } catch {
      return false;
    }
  }

  private async openSession(userId: string): Promise<string> {
    const token = newDeviceToken();
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  /**
   * Accounts are optional and unverified (no e-mail round trip in v1), so "this address is
   * taken" has to be said: there is no inbox to say it to instead.
   */
  async register(
    email: string,
    password: string,
    locale: string,
    ip: string,
  ): Promise<LoginResult | { ok: false; reason: 'EMAIL_TAKEN' }> {
    const open = await this.allowed(
      `closeup:signup:ip:${digest(ip)}`,
      SIGNUP_LIMIT.perIp,
      SIGNUP_LIMIT.windowS,
    );
    if (!open) return { ok: false, reason: 'RATE_LIMITED' };
    if (await this.prisma.user.findUnique({ where: { email } })) {
      return { ok: false, reason: 'EMAIL_TAKEN' };
    }
    const user = await this.prisma.user.create({
      data: { email, passwordHash: await hashPassword(password), locale },
    });
    const token = await this.openSession(user.id);
    return {
      ok: true,
      token,
      user: { id: user.id, email, role: user.role, playerId: null, nickname: null },
    };
  }

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
    const token = await this.openSession(user.id);
    return {
      ok: true,
      token,
      user: { id: user.id, email: user.email, role: user.role, playerId: null, nickname: null },
    };
  }

  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { player: true } } },
    });
    if (!session || session.expiresAt < new Date() || session.user.bannedAt) return null;
    const { user } = session;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      playerId: user.player?.id ?? null,
      nickname: user.player?.nickname ?? null,
    };
  }

  /** Changing the password ends every other session: a thief's included. */
  async changePassword(
    userId: string,
    current: string,
    next: string,
    keepToken: string | undefined,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(user.passwordHash, current))) return false;
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next) },
    });
    await this.prisma.session.deleteMany({
      where: { userId, NOT: { tokenHash: hashToken(keepToken ?? '') } },
    });
    return true;
  }

  async checkPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return Boolean(user && (await verifyPassword(user.passwordHash, password)));
  }

  /**
   * Always answers the same, whether the address has an account or not, and whether an e-mail
   * left or not: the form is not a way to find out who plays here.
   */
  async forgotPassword(email: string, ip: string): Promise<void> {
    const open =
      (await this.allowed(
        `closeup:forgot:ip:${digest(ip)}`,
        FORGOT_LIMIT.perIp,
        FORGOT_LIMIT.windowS,
      )) &&
      (await this.allowed(
        `closeup:forgot:email:${digest(email)}`,
        FORGOT_LIMIT.perEmail,
        FORGOT_LIMIT.windowS,
      ));
    const user = open ? await this.prisma.user.findUnique({ where: { email } }) : null;
    if (!user || user.bannedAt) return;

    const token = newDeviceToken();
    await this.prisma.passwordReset.deleteMany({ where: { userId: user.id } });
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await this.mail.passwordReset(user.email, user.locale, token);
  }

  /** One use: the link, every session and the failed-login counter of the address all go. */
  async resetPassword(token: string, password: string): Promise<boolean> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!reset || reset.expiresAt < new Date()) return false;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: await hashPassword(password) },
      }),
      this.prisma.passwordReset.deleteMany({ where: { userId: reset.userId } }),
      this.prisma.session.deleteMany({ where: { userId: reset.userId } }),
    ]);
    await this.redis.del(attemptsKey('email', reset.user.email)).catch(() => undefined);
    return true;
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
    return { id: user.id, email: user.email, role: user.role, playerId: null, nickname: null };
  }
}
