import { Module } from '@nestjs/common';
import { ConfigModule } from './config/app-config.js';
import { CommonsImageService } from './importer/commons-image.service.js';
import { WIKIMEDIA, WikimediaHttpClient } from './importer/wikimedia.client.js';
import { CropService } from './media/crop.service.js';
import { MediaModule } from './media/media.module.js';
import { AutoPointsService } from './pipeline/auto-points.service.js';
import { FACE_DETECTOR } from './pipeline/face/detector.js';
import { FaceApiDetector } from './pipeline/face/face-api.detector.js';
import { IngestService } from './pipeline/ingest.service.js';
import { bullRoot, mediaQueue } from './pipeline/media-queue.js';
import { MediaProcessor } from './pipeline/media.processor.js';
import { WorkerHeartbeat } from './pipeline/worker-heartbeat.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, MediaModule, bullRoot(), mediaQueue()],
  providers: [
    CropService,
    IngestService,
    AutoPointsService,
    { provide: FACE_DETECTOR, useClass: FaceApiDetector },
    { provide: WIKIMEDIA, useFactory: () => new WikimediaHttpClient() },
    CommonsImageService,
    MediaProcessor,
    WorkerHeartbeat,
  ],
})
export class WorkerModule {}
