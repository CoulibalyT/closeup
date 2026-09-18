import { Module } from '@nestjs/common';
import { ConfigModule } from './config/app-config.js';
import { CropService } from './media/crop.service.js';
import { MediaModule } from './media/media.module.js';
import { bullRoot, mediaQueue } from './pipeline/media-queue.js';
import { MediaProcessor } from './pipeline/media.processor.js';
import { WorkerHeartbeat } from './pipeline/worker-heartbeat.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, MediaModule, bullRoot(), mediaQueue()],
  providers: [CropService, MediaProcessor, WorkerHeartbeat],
})
export class WorkerModule {}
