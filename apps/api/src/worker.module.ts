import { Module } from '@nestjs/common';
import { ConfigModule } from './config/app-config.js';
import { bullRoot, mediaQueue } from './pipeline/media-queue.js';
import { MediaProcessor } from './pipeline/media.processor.js';
import { WorkerHeartbeat } from './pipeline/worker-heartbeat.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [ConfigModule, RedisModule, bullRoot(), mediaQueue()],
  providers: [MediaProcessor, WorkerHeartbeat],
})
export class WorkerModule {}
