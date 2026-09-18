import { Module } from '@nestjs/common';
import { ConfigModule } from './config/app-config.js';
import { GameModule } from './game/game.module.js';
import { HealthModule } from './health/health.module.js';
import { MediaHttpModule, MediaModule } from './media/media.module.js';
import { bullRoot } from './pipeline/media-queue.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    MediaModule,
    MediaHttpModule,
    bullRoot(),
    HealthModule,
    GameModule,
  ],
})
export class AppModule {}
