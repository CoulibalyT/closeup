import { Module } from '@nestjs/common';
import { mediaQueue } from '../pipeline/media-queue.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminController } from './admin.controller.js';

/** The back-office API. Only a producer of image jobs: `sharp` stays in the worker. */
@Module({
  imports: [mediaQueue()],
  controllers: [AdminController],
  providers: [AdminContentService],
})
export class AdminModule {}
