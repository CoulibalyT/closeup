import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { readinessSchema, workerHealthSchema } from '@closeup/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { listen } from '../testing/listen.js';
import { WorkerModule } from '../worker.module.js';

async function startApi(env: Record<string, string>): Promise<{
  app: INestApplication;
  url: string;
}> {
  Object.assign(process.env, env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  return { app, url: await listen(app) };
}

describe('health with Postgres and Redis unreachable', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    // Port 1 refuses connections immediately on every platform.
    ({ app, url } = await startApi({
      DATABASE_URL: 'postgresql://closeup:closeup@127.0.0.1:1/closeup',
      REDIS_URL: 'redis://127.0.0.1:1',
    }));
  });

  afterAll(() => app.close());

  it('stays alive', async () => {
    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports 503 and names both dependencies as down', async () => {
    const response = await fetch(`${url}/api/health/ready`);
    expect(response.status).toBe(503);
    const body = readinessSchema.parse(await response.json());
    expect(body.status).toBe('error');
    expect(body.details.postgres?.status).toBe('down');
    expect(body.details.redis?.status).toBe('down');
  });

  it('reports the worker as down instead of hanging', async () => {
    const response = await fetch(`${url}/api/health/worker`);
    expect(response.status).toBe(503);
    expect(workerHealthSchema.parse(await response.json()).status).toBe('down');
  });
});

// Needs the Compose Postgres and Redis (CI provides them as services).
describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('health with real infrastructure', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let url: string;

  beforeAll(async () => {
    const env = {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
    };
    ({ app, url } = await startApi(env));
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
  });

  it('is ready', async () => {
    const response = await fetch(`${url}/api/health/ready`);
    expect(response.status).toBe(200);
    const body = readinessSchema.parse(await response.json());
    expect(body.details.postgres?.status).toBe('up');
    expect(body.details.redis?.status).toBe('up');
  });

  it('gets a ping job through the queue and back', async () => {
    const response = await fetch(`${url}/api/health/worker`);
    expect(response.status).toBe(200);
    const body = workerHealthSchema.parse(await response.json());
    expect(body.status).toBe('up');
    expect(body.latencyMs).toBeLessThan(3_000);
  });
});
