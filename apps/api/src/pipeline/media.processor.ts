import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CropService } from '../media/crop.service.js';
import { IngestService } from './ingest.service.js';
import { MEDIA_QUEUE, MediaJob } from './media-queue.js';

// Image work is memory hungry (sharp, later face landmarks): one job at a time on a small VPS.
@Processor(MEDIA_QUEUE, { concurrency: 1 })
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger('MediaWorker');
  private lastError = '';

  constructor(
    private readonly crops: CropService,
    private readonly ingest: IngestService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case MediaJob.ping:
        return { pong: true, at: Date.now() };
      case MediaJob.processCard: {
        const { cardId, publish } = job.data as { cardId: string; publish?: boolean };
        return this.crops.processCard(cardId, publish);
      }
      case MediaJob.ingestImage: {
        const { cardId, incomingKey } = job.data as { cardId: string; incomingKey: string };
        return this.ingest.ingest(cardId, incomingKey);
      }
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
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    this.logger.error(`Job ${job?.name ?? '?'} (${job?.id ?? '?'}) failed: ${error.message}`);
    // Out of attempts: a card must not stay in PROCESSING for ever, the admin polls it.
    const cardId = (job?.data as { cardId?: string } | undefined)?.cardId;
    if (!job || !cardId || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await this.ingest.giveUp(cardId).catch((failure: unknown) => {
      this.logger.error(`Card ${cardId} could not be released: ${String(failure)}`);
    });
  }
}
