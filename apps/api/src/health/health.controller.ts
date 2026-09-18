import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { WorkerHealth } from '@closeup/shared';
import { PostgresHealth, RedisHealth } from './indicators.js';
import { WorkerProbe } from './worker-probe.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealth,
    private readonly redis: RedisHealth,
    private readonly worker: WorkerProbe,
  ) {}

  /** Liveness: the process answers. Used by Docker; must not depend on anything else. */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: 503 with the same body when Postgres or Redis is down. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.postgres.check('postgres'),
      () => this.redis.check('redis'),
    ]);
  }

  @Get('worker')
  async workerHealth(): Promise<WorkerHealth> {
    const result = await this.worker.ping();
    if (result.status === 'down') throw new ServiceUnavailableException(result);
    return result;
  }
}
