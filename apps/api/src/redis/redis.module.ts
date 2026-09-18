import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';

export const REDIS = Symbol('REDIS');

interface ErrorEmitter {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Redis clients retry forever and emit an error per attempt. Unheard, those are unhandled error
 * events (ioredis) or raw console.error dumps (BullMQ). This logs each distinct message once.
 */
export function logErrorsOnce(emitter: ErrorEmitter, name: string): void {
  const logger = new Logger(name);
  let lastMessage = '';
  emitter.on('error', (error) => {
    if (error.message === lastMessage) return;
    lastMessage = error.message;
    logger.warn(error.message || String(error));
  });
}

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const client = new Redis(config.env.REDIS_URL, { connectionName: 'closeup:app' });
        logErrorsOnce(client, 'Redis');
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
