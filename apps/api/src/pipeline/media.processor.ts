import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MEDIA_QUEUE, MediaJob } from './media-queue.js';

// Image work is memory hungry (sharp, later face landmarks): one job at a time on a small VPS.
@Processor(MEDIA_QUEUE, { concurrency: 1 })
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger('MediaWorker');
  private lastError = '';

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case MediaJob.ping:
        return { pong: true, at: Date.now() };
      default:
        throw new Error(`Unknown media job: ${job.name}`);
    }
  }

  /** Without a listener BullMQ dumps every reconnection attempt through console.error. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    if (error.message === this.lastError) return;
    this.lastError = error.message;
    this.logger.warn(error.message);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Job ${job?.name ?? '?'} (${job?.id ?? '?'}) failed: ${error.message}`);
  }
}
