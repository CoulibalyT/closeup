import { BullModule } from '@nestjs/bullmq';
import type { ConnectionOptions } from 'bullmq';
import { AppConfig } from '../config/app-config.js';

/** One queue for every image job; producers (seed, admin upload, importers) only differ by job name. */
export const MEDIA_QUEUE = 'media';

export const MediaJob = {
  /** Round trip used by health checks to prove the worker consumes the queue. */
  ping: 'ping',
} as const;

export const WORKER_HEARTBEAT_KEY = 'closeup:worker:heartbeat';
export const WORKER_HEARTBEAT_EVERY_MS = 10_000;
export const WORKER_HEARTBEAT_TTL_S = 30;

/**
 * Options, not a client instance: BullMQ treats an instance as shared and never closes it, which
 * leaves shutdown hanging when Redis is unreachable. Given options, it owns the connection and
 * tears it down itself. It blocks on that connection, hence `maxRetriesPerRequest: null`.
 */
export const bullConnection = (config: AppConfig): ConnectionOptions => ({
  url: config.env.REDIS_URL,
  maxRetriesPerRequest: null,
});

export const bullRoot = () =>
  BullModule.forRootAsync({
    inject: [AppConfig],
    useFactory: (config: AppConfig) => ({ connection: bullConnection(config) }),
  });

export const mediaQueue = () =>
  BullModule.registerQueue({
    name: MEDIA_QUEUE,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
  });
