import { Module } from '@nestjs/common';
import { mediaQueue } from '../pipeline/media-queue.js';
import { ImporterController } from './importer.controller.js';
import { ImporterService } from './importer.service.js';
import { WIKIMEDIA, WikimediaHttpClient } from './wikimedia.client.js';

/** Searches run here; downloads and pictures are the worker's (`CommonsImageService`). */
@Module({
  imports: [mediaQueue()],
  controllers: [ImporterController],
  providers: [ImporterService, { provide: WIKIMEDIA, useFactory: () => new WikimediaHttpClient() }],
})
export class ImporterModule {}
