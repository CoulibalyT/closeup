import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { WorkerHealth } from '@closeup/shared';
import { type Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { AppConfig } from '../config/app-config.js';
import {
  MEDIA_QUEUE,
  MediaJob,
  WORKER_HEARTBEAT_EVERY_MS,
  WORKER_HEARTBEAT_KEY,
} from '../pipeline/media-queue.js';
import { logErrorsOnce } from '../redis/redis.module.js';

const PROBE_TIMEOUT_MS = 3_000;
const HEARTBEAT_READ_TIMEOUT_MS = 1_000;
const CLOSE_TIMEOUT_MS = 2_000;

/**
 * Is the worker there? Its heartbeat answers first: the worker cuts one image at a time, so a
 * `ping` job queued behind twenty cards proves nothing except that the queue is busy — which is
 * how this used to report a perfectly healthy worker as down. The round trip is the fallback,
 * for the case where there is no heartbeat yet (an older worker, or one just started).
 */
@Injectable()
export class WorkerProbe implements OnModuleDestroy {
  private readonly eventsClient: Redis;
  private readonly events: QueueEvents;

  constructor(
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue,
    config: AppConfig,
  ) {
    // Unlike Queue, QueueEvents.close() first awaits a *ready* connection, which never comes if
    // Redis has been down since boot. Owning the client lets onModuleDestroy end it first.
    this.eventsClient = new Redis(config.env.REDIS_URL, {
      connectionName: 'closeup:queue-events',
      maxRetriesPerRequest: null,
    });
    this.events = new QueueEvents(MEDIA_QUEUE, {
      connection: this.eventsClient,
      prefix: config.env.QUEUE_PREFIX,
    });
    logErrorsOnce(this.eventsClient, 'MediaQueueEvents');
    logErrorsOnce(this.events, 'MediaQueueEvents');
    logErrorsOnce(this.queue, 'MediaQueue');
  }

  async ping(): Promise<WorkerHealth> {
    const startedAt = Date.now();
    // Bounded: ioredis queues commands while disconnected instead of failing, so a dead Redis
    // would hang the health endpoint rather than answer it.
    const beat = await withTimeout(
      this.eventsClient.get(WORKER_HEARTBEAT_KEY),
      HEARTBEAT_READ_TIMEOUT_MS,
      'redis',
    ).catch(() => null);
    if (beat) {
      const age = Date.now() - Number(beat);
      // Two missed beats: something is wrong, fall through to the round trip and say so.
      if (Number.isFinite(age) && age < WORKER_HEARTBEAT_EVERY_MS * 2) {
        return { status: 'up', latencyMs: Math.max(0, age) };
      }
    }
    try {
      const roundTrip = async () => {
        const job = await this.queue.add(MediaJob.ping, {}, { removeOnComplete: true });
        await job.waitUntilFinished(this.events, PROBE_TIMEOUT_MS);
      };
      await withTimeout(roundTrip(), PROBE_TIMEOUT_MS + 500, 'worker');
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { status: 'down', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.eventsClient.disconnect();
    await withTimeout(this.events.close(), CLOSE_TIMEOUT_MS, 'queue events close').catch(
      () => undefined,
    );
  }
}
