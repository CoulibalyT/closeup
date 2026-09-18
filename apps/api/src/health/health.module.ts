import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { mediaQueue } from '../pipeline/media-queue.js';
import { HealthController } from './health.controller.js';
import { PostgresHealth, RedisHealth } from './indicators.js';
import { WorkerProbe } from './worker-probe.js';

@Module({
  imports: [TerminusModule, mediaQueue()],
  controllers: [HealthController],
  providers: [PostgresHealth, RedisHealth, WorkerProbe],
})
export class HealthModule {}
