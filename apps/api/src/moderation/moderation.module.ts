import { Global, Module } from '@nestjs/common';
import { ReportsController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';

@Global()
@Module({
  controllers: [ReportsController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
