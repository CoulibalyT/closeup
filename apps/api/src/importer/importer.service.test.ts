import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config.js';
import type { PrismaService } from '../prisma/prisma.module.js';
import { ImporterService, searchLimits } from './importer.service.js';
import type { SparqlRow, WikimediaApi } from './wikimedia.client.js';

describe('searchLimits', () => {
  it('gives a search as long as its queries may take, and keeps it a while longer', () => {
    expect(searchLimits('animals')).toEqual({ staleMs: 5 * 60_000, pendingTtlS: 10 * 60 });
    // Eight occupation queries in a row.
    expect(searchLimits('historical')).toEqual({ staleMs: 40 * 60_000, pendingTtlS: 45 * 60 });
  });
});

describe('ImporterService.start', () => {
  it('never lets an older run overwrite the search started after it', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    };
    const pending: ((rows: SparqlRow[]) => void)[] = [];
    const wikimedia = {
      sparql: vi.fn(() => new Promise<SparqlRow[]>((resolve) => pending.push(resolve))),
      entities: vi.fn(async () => new Map()),
      files: vi.fn(async () => new Map()),
    };
    const prisma = { card: { findMany: vi.fn(async () => []) } };
    const service = new ImporterService(
      prisma as unknown as PrismaService,
      { env: { QUEUE_PREFIX: 'unit' } } as unknown as AppConfig,
      redis as never,
      wikimedia as unknown as WikimediaApi,
      {} as never,
    );

    await service.start({ preset: 'heritage' });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    // The first run looks lost: a second one starts.
    const [key] = [...store.keys()];
    const stored = JSON.parse(store.get(key!)!) as { startedAt: string };
    store.set(key!, JSON.stringify({ ...stored, startedAt: '2000-01-01T00:00:00.000Z' }));
    await service.start({ preset: 'heritage' });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    pending[1]!([{ qid: 'Q2', popularity: 90, file: 'Two.jpg' }]);
    await vi.waitFor(async () => expect((await service.get('heritage'))?.state).toBe('done'));
    pending[0]!([{ qid: 'Q1', popularity: 99, file: 'One.jpg' }]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await service.get('heritage'))?.candidates.map((c) => c.qid)).toEqual(['Q2']);
  });
});
