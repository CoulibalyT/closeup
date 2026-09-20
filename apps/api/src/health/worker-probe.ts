import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { WorkerHealth } from '@closeup/shared';
import { type Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { AppConfig } from '../config/app-config.js';
import { MEDIA_QUEUE, MediaJob } from '../pipeline/media-queue.js';
import { logErrorsOnce } from '../redis/redis.module.js';

const PROBE_TIMEOUT_MS = 3_000;
const CLOSE_TIMEOUT_MS = 2_000;

/** Sends a `ping` job through the real queue: up means the worker is consuming, not just alive. */
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
