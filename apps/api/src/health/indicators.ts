import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';

const DEPENDENCY_TIMEOUT_MS = 2_500;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

@Injectable()
export class PostgresHealth {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async check(key: string) {
    const indicator = this.indicators.check(key);
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, DEPENDENCY_TIMEOUT_MS, key);
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: reason(error) });
    }
  }
}

@Injectable()
export class RedisHealth {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async check(key: string) {
    const indicator = this.indicators.check(key);
    try {
      await withTimeout(this.redis.ping(), DEPENDENCY_TIMEOUT_MS, key);
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: reason(error) });
    }
  }
}
