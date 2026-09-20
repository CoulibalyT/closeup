import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/app-config.js';
import { GameModule } from './game/game.module.js';
import { HealthModule } from './health/health.module.js';
import { HistoryModule } from './history/history.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { MailModule } from './mail/mail.module.js';
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
    IdentityModule,
    MailModule,
    AccountModule,
    HistoryModule,
    AuthModule,
    bullRoot(),
    HealthModule,
    GameModule,
    AdminModule,
  ],
})
export class AppModule {}
