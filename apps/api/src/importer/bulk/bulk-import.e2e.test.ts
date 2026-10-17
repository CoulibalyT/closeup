import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { BulkImportView } from '@closeup/shared';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module.js';
import { AuthService } from '../../auth/auth.service.js';
import { configureApp } from '../../bootstrap.js';
import { playableWhere } from '../../content/playable.js';
import { FACE_DETECTOR } from '../../pipeline/face/detector.js';
import { BULK_PRIORITY, MEDIA_QUEUE } from '../../pipeline/media-queue.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import { listen } from '../../testing/listen.js';
import { WorkerModule } from '../../worker.module.js';
import type { CommonsFile, SparqlRow, WikimediaApi } from '../wikimedia.client.js';
import { WIKIMEDIA } from '../wikimedia.client.js';
import { BulkImportRunner } from './bulk-import.runner.js';

const PASSWORD = 'a long enough passphrase';

/** What the fake Wikidata answers for the "tools" class, changed by the tests. */
const state = {
  toolsRows: [] as SparqlRow[],
  queries: [] as string[],
  /** The whole query service is down: every query fails, the health check included. */
  down: false,
};

const LABELS: Record<string, { fr?: string; en?: string }> = {
  Q7401: { fr: 'marteau', en: 'hammer' },
  Q1131: { fr: 'clé à molette', en: 'spanner' },
  Q40847: { fr: 'scie', en: 'saw' },
  Q9999: { fr: 'éléphant', en: 'elephant' },
  Q7378: { fr: 'éléphant', en: 'elephant' },
  Q997601: { fr: 'Persona Testa', en: 'Persona Testa' },
  Q998001: { fr: 'tournevis', en: 'screwdriver' },
  Q998002: { fr: 'Elephant', en: 'elephant' },
  Q998003: { fr: 'pince', en: 'pliers' },
};

function fakeWikimedia(picture: Buffer): WikimediaApi {
  const file = (name: string): CommonsFile => ({
    pageId: name.length,
    url: `https://upload.wikimedia.org/wikipedia/commons/x/${name}`,
    thumbUrl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/x/${name}/330px-${name}`,
    width: 3000,
    height: 2000,
    size: 3_000_000,
    mime: 'image/jpeg',
    metadata: {
      Artist: '<a href="//commons.wikimedia.org/wiki/User:Ann">Ann</a>',
      License: 'cc-by-sa-4.0',
      LicenseShortName: 'CC BY-SA 4.0',
    },
  });
  return {
    async sparql(query) {
      state.queries.push(query);
      if (state.down) throw new Error('fetch failed (ECONNRESET)');
      if (query.includes('wd:Q3773693')) {
        throw new Error('query.wikidata.org did not answer (HTTP 504)');
      }
      if (query.includes('wd:Q39546')) {
        if (query.includes('?links >= 150)')) return state.toolsRows;
        if (query.includes('>= 80 && ?links <= 149')) {
          return [{ qid: 'Q7378', popularity: 100, file: 'Elephant.jpg' }];
        }
      }
      if (query.includes('wd:Q33999'))
        return [{ qid: 'Q997601', popularity: 120, file: 'Omar.jpg' }];
      return [];
    },
    async entities(qids) {
      return new Map(
        qids.map((qid) => [
          qid,
          {
            labels: LABELS[qid] ?? { fr: `sujet ${qid}`, en: `subject ${qid}` },
            aliases: { fr: [], en: [] },
          },
        ]),
      );
    },
    async people(qids) {
      return new Map(
        qids.map((qid) => [
          qid,
          {
            human: qid === 'Q997601',
            file: 'Omar.jpg',
            popularity: 120,
            frenchArticle: true,
            description: 'acteur français',
            familyNameQid: null,
          },
        ]),
      );
    },
    async subjects(qids) {
      return new Map(
        qids.map((qid) => [
          qid,
          {
            instanceOf: qid === 'Q40847' ? ['Q728'] : [],
            subclassOf: [],
            taxonName: null,
            description: { fr: null, en: null },
          },
        ]),
      );
    },
    async itemsForTitles() {
      return new Map();
    },
    async searchHumans() {
      return [];
    },
    async files(names) {
      return new Map(names.map((name) => [name, file(name)]));
    },
    async download() {
      return picture;
    },
  };
}

describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('mass import', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let runner: BulkImportRunner;
  let queue: Queue;
  let prisma: PrismaService;
  let url: string;
  let mediaDir: string;
  let cookie = '';
  const run = randomUUID();
  const email = `bulk-${run}@test.local`;
  const runIds: string[] = [];
  const extraPackIds: string[] = [];

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${url}/api${path}`, { ...init, headers: { cookie, ...init.headers } });
  const send = (method: string, path: string, body?: unknown) =>
    call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const current = async () =>
    ((await (await call('/admin/import/bulk')).json()) as { run: BulkImportView | null }).run!;
  const start = async (family: string, target: number) => {
    const response = await send('POST', '/admin/import/bulk', { family, target });
    const body = (await response.json()) as { run?: BulkImportView; code?: string };
    if (body.run) runIds.push(body.run.id);
    return { status: response.status, body };
  };
  /** Ticks until `until` holds, a few hundred times at most. */
  const tickUntil = async (until: () => Promise<boolean>) => {
    for (let i = 0; i < 300; i++) {
      await runner.tick();
      if (await until()) return;
    }
    throw new Error('the run never got there');
  };
  const created = async (runId: string) => prisma.card.count({ where: { bulkImportId: runId } });
  const settled = async (runId: string) => {
    for (let i = 0; i < 150; i++) {
      const processing = await prisma.card.count({
        where: { bulkImportId: runId, status: 'PROCESSING' },
      });
      if (!processing) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('the worker never finished');
  };
  const rows = (from: number, count: number): SparqlRow[] =>
    Array.from({ length: count }, (_, i) => ({
      // Far above real items: the dev database may hold real catalogue cards.
      qid: `Q99${from + i}`,
      popularity: 200 - i,
      file: `Tool${from + i}.jpg`,
    }));

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'closeup-bulk-'));
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      MEDIA_DIR: mediaDir,
      QUEUE_PREFIX: `test-${run}`,
      // The tests drive the runner by hand.
      BULK_RUNNER: 'off',
    });
    // A checkerboard: detail everywhere, so that object cards get their points.
    const squares = Array.from({ length: 16 * 12 }, (_, i) => {
      const col = i % 16;
      const row = Math.floor(i / 16);
      return (col + row) % 2
        ? ''
        : `<rect x="${col * 100}" y="${row * 100}" width="100" height="100"/>`;
    }).join('');
    const picture = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#eee"/><g fill="#222">${squares}</g></svg>`,
      ),
    )
      .jpeg()
      .toBuffer();
    const wikimedia = fakeWikimedia(picture);
    const oneFace = {
      score: 0.95,
      box: { x: 500, y: 200, width: 600, height: 700 },
      landmarks: {
        leftEye: { x: 700, y: 500 },
        rightEye: { x: 900, y: 500 },
        nose: { x: 800, y: 620 },
        mouth: { x: 800, y: 720 },
        chin: { x: 800, y: 820 },
        brow: { x: 800, y: 440 },
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WIKIMEDIA)
      .useValue(wikimedia)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    url = await listen(app);
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(WIKIMEDIA)
      .useValue(wikimedia)
      .overrideProvider(FACE_DETECTOR)
      .useValue({ detect: async () => [oneFace] })
      .compile();
    worker.useLogger(false);
    await worker.init();
    runner = worker.get(BulkImportRunner);
    queue = worker.get<Queue>(getQueueToken(MEDIA_QUEUE));
    prisma = app.get(PrismaService);

    await app.get(AuthService).upsertAdmin(email, PASSWORD);
    const login = await send('POST', '/auth/login', { email, password: PASSWORD });
    cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;

    // A hand-made pack already holds a live elephant: the mass import must not bring a second one.
    // (Not the lion: the importer's own e2e test owns Q140, and the two suites share the base.)
    const hand = await prisma.pack.create({
      data: {
        titleFr: `Main ${run}`,
        titleEn: `Hand ${run}`,
        category: 'ANIMAL',
        visibility: 'PUBLIC',
        cards: {
          create: {
            slug: 'wd-Q7378',
            category: 'ANIMAL',
            source: 'WIKIMEDIA',
            status: 'LIVE',
            answers: { create: [{ locale: 'fr', text: 'éléphant', aliases: [] }] },
          },
        },
      },
    });
    extraPackIds.push(hand.id);
  });

  afterAll(async () => {
    await prisma.card.deleteMany({ where: { bulkImportId: { in: runIds } } });
    await prisma.bulkImport.deleteMany({ where: { id: { in: runIds } } });
    await prisma.pack.deleteMany({ where: { id: { in: extraPackIds } } });
    await prisma.pack.deleteMany({ where: { slug: { startsWith: 'bulk-' }, cards: { none: {} } } });
    await prisma.user.deleteMany({ where: { email } });
    await worker.close();
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('starts a run from the API and refuses a second one', async () => {
    state.toolsRows = [
      { qid: 'Q7401', popularity: 200, file: 'Hammer.jpg' },
      { qid: 'Q1131', popularity: 190, file: 'Spanner.jpg' },
      { qid: 'Q40847', popularity: 160, file: 'Saw.jpg' },
      { qid: 'Q9999', popularity: 155, file: 'Elephant2.jpg' },
    ];
    const first = await start('objects', 3);
    expect(first.status).toBe(201);
    expect(first.body.run).toMatchObject({ family: 'objects', target: 3, status: 'running' });
    const second = await start('objects', 3);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BULK_RUNNING');
  });

  it('creates cards tick by tick, in a pack it opens, skipping guards and duplicates', async () => {
    const runId = runIds[0]!;
    await tickUntil(async () => (await current()).status === 'done');
    const view = await current();
    expect(view.created).toBe(2);
    expect(view.skipReasons).toEqual({ GUARD_CLASS: 1, DUPLICATE: 1, DUPLICATE_ANSWER: 1 });
    expect(view.note).toContain('kitchenware');

    // The pack the run filled: on a dev database earlier catalogue packs may already exist.
    const { packId } = await prisma.card.findFirstOrThrow({ where: { bulkImportId: runId } });
    const pack = await prisma.pack.findUniqueOrThrow({ where: { id: packId } });
    expect(pack.slug).toMatch(/^bulk-objects-\d+$/);
    expect(pack).toMatchObject({ visibility: 'PUBLIC', category: 'OBJECT', restricted: false });

    await settled(runId);
    const cards = await prisma.card.findMany({
      where: { bulkImportId: runId },
      include: { zoomPoints: true, answers: true },
    });
    expect(cards.map((card) => card.status)).toEqual(['LIVE', 'LIVE']);
    for (const card of cards) {
      expect(card.packId).toBe(pack.id);
      expect(card.zoomPoints.length).toBeGreaterThanOrEqual(2);
      expect(card.zoomPoints.every((point) => point.origin === 'AUTO')).toBe(true);
    }
    expect((await current()).published).toBe(2);
  });

  it('resumes from the cursor after the worker forgot everything, and is done at the target', async () => {
    // Ten tools for eight cards: the first tick makes five, the rest comes after the restart.
    state.toolsRows = rows(2001, 10);
    const { body } = await start('objects', 8);
    const runId = body.run!.id;
    await tickUntil(async () => (await created(runId)) >= 1);

    // Paused: nothing moves.
    await send('POST', `/admin/import/bulk/${runId}/pause`);
    expect(await runner.tick()).toBe('idle');
    const before = await created(runId);
    // The queue drains meanwhile: the next step is not held back by pending jobs.
    await settled(runId);

    // A restart: the buffer is gone, the row remembers the page it was on; that page is asked
    // again, and what it already gave is skipped as a duplicate.
    runner.forget();
    const asked = state.queries.length;
    await send('POST', `/admin/import/bulk/${runId}/resume`);
    await runner.tick();
    const again = state.queries[asked]!;
    expect(again).toContain('wd:Q39546');
    expect(again).toContain('?links >= 150)');

    await tickUntil(async () => (await current()).status === 'done');
    expect(await created(runId)).toBe(8);
    expect(before).toBeLessThan(8);
    expect((await current()).skipReasons.DUPLICATE).toBe(before);
    await settled(runId);
  });

  it('opens the next pack when the current one is switched off', async () => {
    // The pack the first run filled is switched off, then put back as it was.
    const { pack: used } = await prisma.card.findFirstOrThrow({
      where: { bulkImportId: runIds[0] },
      include: { pack: true },
    });
    await prisma.pack.update({ where: { id: used.id }, data: { visibility: 'DISABLED' } });
    try {
      state.toolsRows = rows(3001, 1);
      const { body } = await start('objects', 1);
      const runId = body.run!.id;
      await tickUntil(async () => (await created(runId)) >= 1);
      const card = await prisma.card.findFirstOrThrow({
        where: { bulkImportId: runId },
        include: { pack: true },
      });
      expect(card.pack.id).not.toBe(used.id);
      expect(card.pack).toMatchObject({ visibility: 'PUBLIC', category: 'OBJECT' });
      expect(card.pack.slug).toMatch(/^bulk-objects-\d+$/);
      await tickUntil(async () => (await current()).status === 'done');
      await settled(runId);
    } finally {
      await prisma.pack.update({ where: { id: used.id }, data: { visibility: used.visibility } });
    }
  });

  it('never fills the public queue with the people pack', async () => {
    const { body } = await start('people', 1);
    const runId = body.run!.id;
    await tickUntil(async () => (await created(runId)) >= 1);
    await tickUntil(async () => (await current()).status === 'done');
    await settled(runId);
    const card = await prisma.card.findFirstOrThrow({
      where: { bulkImportId: runId },
      include: { pack: true, zoomPoints: true },
    });
    expect(card.pack.slug).toMatch(/^bulk-people-\d+$/);
    expect(card.pack).toMatchObject({
      category: 'CELEBRITY',
      restricted: true,
      visibility: 'PUBLIC',
    });
    expect(card).toMatchObject({ isPerson: true, status: 'LIVE' });
    expect(card.zoomPoints).toHaveLength(5);
    const inPublicQueue = await prisma.card.count({
      where: { ...playableWhere({ kind: 'public' }), id: card.id },
    });
    expect(inPublicQueue).toBe(0);
    const whenChosen = await prisma.card.count({
      where: { ...playableWhere({ kind: 'room', packIds: [card.packId] }), id: card.id },
    });
    expect(whenChosen).toBe(1);
  });

  it('keeps at most five image jobs pending', async () => {
    state.toolsRows = rows(4001, 20);
    const { body } = await start('objects', 20);
    const runId = body.run!.id;
    await tickUntil(async () => (await created(runId)) >= 1);
    expect(await created(runId)).toBe(5);
    const counts = await queue.getCountsPerPriority([BULK_PRIORITY]);
    expect(counts[BULK_PRIORITY] ?? 0).toBeLessThanOrEqual(5);
    await send('POST', `/admin/import/bulk/${runId}/stop`);
    expect((await current()).status).toBe('stopped');
    await settled(runId);
  });
  it('waits out an outage of the query service instead of walking past its classes', async () => {
    state.toolsRows = rows(5001, 1);
    state.down = true;
    const { body } = await start('objects', 1);
    const runId = body.run!.id;
    const before = await prisma.bulkImport.findUniqueOrThrow({ where: { id: runId } });
    for (let i = 0; i < 8; i++) expect(await runner.tick()).toBe('retry');
    const during = await prisma.bulkImport.findUniqueOrThrow({ where: { id: runId } });
    // Nothing skipped: the walk has not moved, the run is still running, and it says why.
    expect(during.status).toBe('running');
    expect(during.cursor ?? null).toEqual(before.cursor ?? null);
    expect(during.note).toMatch(/Wikidata/);
    // And it waits longer each time, within reason.
    expect(runner.backoffMs).toBeGreaterThan(60_000);
    expect(runner.backoffMs).toBeLessThanOrEqual(30 * 60_000);

    state.down = false;
    await tickUntil(async () => (await created(runId)) >= 1);
    const after = await prisma.bulkImport.findUniqueOrThrow({ where: { id: runId } });
    expect(after.note ?? '').not.toMatch(/injoignable|unreachable/);
    await tickUntil(async () => (await current()).status === 'done');
    await settled(runId);
  });

  it('judges a duplicate answer against the catalogue only, in flight too, accents aside', async () => {
    // A player's private card does not block a catalogue subject…
    const player = await prisma.player.create({ data: { nickname: `Bulk ${run}` } });
    const mine = await prisma.pack.create({
      data: {
        titleFr: `Perso ${run}`,
        titleEn: `Mine ${run}`,
        category: 'OBJECT',
        visibility: 'PRIVATE',
        ownerId: player.id,
        cards: {
          create: {
            category: 'OBJECT',
            source: 'UPLOAD',
            status: 'LIVE',
            answers: { create: [{ locale: 'fr', text: 'tournevis', aliases: [] }] },
          },
        },
      },
    });
    // …while a house card still being processed does.
    const house = await prisma.pack.create({
      data: {
        titleFr: `Maison ${run}`,
        titleEn: `House ${run}`,
        category: 'OBJECT',
        visibility: 'PUBLIC',
        cards: {
          create: {
            category: 'OBJECT',
            source: 'UPLOAD',
            status: 'PROCESSING',
            answers: { create: [{ locale: 'fr', text: 'pince', aliases: [] }] },
          },
        },
      },
    });
    extraPackIds.push(mine.id, house.id);
    state.toolsRows = [
      { qid: 'Q998001', popularity: 190, file: 'Screwdriver.jpg' },
      { qid: 'Q998002', popularity: 180, file: 'Elephant3.jpg' },
      { qid: 'Q998003', popularity: 170, file: 'Pliers.jpg' },
    ];
    const { body } = await start('objects', 3);
    const runId = body.run!.id;
    await tickUntil(async () => (await current()).status === 'done');
    const made = await prisma.card.findMany({
      where: { bulkImportId: runId },
      include: { answers: true },
    });
    expect(made.map((card) => card.answers.find((a) => a.locale === 'fr')?.text)).toEqual([
      'tournevis',
    ]);
    // "Elephant" is the hand pack's "éléphant"; "pince" is in flight in the house pack.
    expect((await current()).skipReasons).toMatchObject({ DUPLICATE_ANSWER: 2 });
    await settled(runId);
    await prisma.pack.deleteMany({ where: { id: { in: [mine.id, house.id] } } });
    await prisma.player.delete({ where: { id: player.id } });
  });

  it('counts its pictures in flight from the cards, and gives up on a card left without a job', async () => {
    state.toolsRows = rows(6001, 3);
    const { body } = await start('objects', 10);
    const runId = body.run!.id;
    const pack = await prisma.pack.create({
      data: { titleFr: `Vol ${run}`, titleEn: `Flight ${run}`, category: 'OBJECT' },
    });
    extraPackIds.push(pack.id);
    // Five pictures in flight that the queue does not list as waiting (active, or retrying).
    const inFlight = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.card.create({
          data: {
            packId: pack.id,
            slug: `wd-Q9969${i}`,
            category: 'OBJECT',
            source: 'WIKIMEDIA',
            status: 'PROCESSING',
            bulkImportId: runId,
          },
        }),
      ),
    );
    expect(await runner.tick()).toBe('full');

    // One of them lost its job an hour ago: it is given up, and no longer holds a place.
    await prisma.$executeRaw`UPDATE "Card" SET "updatedAt" = now() - interval '1 hour' WHERE id = ${inFlight[0]!.id}::uuid`;
    expect(await runner.tick()).not.toBe('full');
    const lost = await prisma.card.findUniqueOrThrow({ where: { id: inFlight[0]!.id } });
    expect(lost).toMatchObject({ status: 'DRAFT', processingError: 'FAILED' });
    await send('POST', `/admin/import/bulk/${runId}/stop`);
    await prisma.card.deleteMany({ where: { packId: pack.id } });
    await settled(runId);
  });

  it('pauses when the pictures keep failing, rather than burning subjects', async () => {
    state.toolsRows = rows(7001, 3);
    const { body } = await start('objects', 10);
    const runId = body.run!.id;
    const pack = await prisma.pack.create({
      data: { titleFr: `Raté ${run}`, titleEn: `Failed ${run}`, category: 'OBJECT' },
    });
    extraPackIds.push(pack.id);
    await prisma.card.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        packId: pack.id,
        slug: `wd-Q9979${i}`,
        category: 'OBJECT' as const,
        source: 'WIKIMEDIA' as const,
        status: 'DRAFT' as const,
        processingError: 'FAILED',
        bulkImportId: runId,
      })),
    });
    expect(await runner.tick()).toBe('idle');
    const row = await current();
    expect(row.status).toBe('paused');
    expect(row.note).toMatch(/images|pictures/i);
    await send('POST', `/admin/import/bulk/${runId}/stop`);
    await prisma.card.deleteMany({ where: { packId: pack.id } });
  });

  it('removes a card whose picture could not be queued', async () => {
    state.toolsRows = rows(8101, 1);
    const { body } = await start('objects', 1);
    const runId = body.run!.id;
    const add = vi.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Redis went away'));
    try {
      for (let i = 0; i < 300 && add.mock.calls.length === 0; i++) {
        await runner.tick().catch(() => 'failed');
      }
      expect(add).toHaveBeenCalled();
      expect(await prisma.card.count({ where: { slug: 'wd-Q998101' } })).toBe(0);
    } finally {
      add.mockRestore();
    }
    await tickUntil(async () => (await created(runId)) >= 1);
    await tickUntil(async () => (await current()).status === 'done');
    await settled(runId);
  });
});
