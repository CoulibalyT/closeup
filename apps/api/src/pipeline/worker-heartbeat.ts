import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import {
  WORKER_HEARTBEAT_EVERY_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_S,
} from './media-queue.js';

/** The worker has no HTTP port; Docker's health check reads this key instead. */
@Injectable()
export class WorkerHeartbeat implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationBootstrap(): void {
    const beat = () =>
      void this.redis
        .set(WORKER_HEARTBEAT_KEY, Date.now(), 'EX', WORKER_HEARTBEAT_TTL_S)
        .catch(() => undefined);
    beat();
    this.timer = setInterval(beat, WORKER_HEARTBEAT_EVERY_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
