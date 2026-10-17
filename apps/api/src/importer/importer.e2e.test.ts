import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { AdminCard, ImportResult, ImportSearch } from '@closeup/shared';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { configureApp } from '../bootstrap.js';
import { FACE_DETECTOR } from '../pipeline/face/detector.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { listen } from '../testing/listen.js';
import { WorkerModule } from '../worker.module.js';
import type { CommonsFile, PersonFacts, WikimediaApi } from './wikimedia.client.js';
import { WIKIMEDIA } from './wikimedia.client.js';

const PASSWORD = 'a long enough passphrase';

/** Wikimedia as the tests want it: four subjects, each with a reason to be there. */
function fakeWikimedia(picture: Buffer): WikimediaApi & { downloads: string[] } {
  const file = (
    name: string,
    overrides: Partial<CommonsFile> = {},
    metadata = {},
  ): CommonsFile => ({
    pageId: name.length,
    url: `https://upload.wikimedia.org/wikipedia/commons/x/${name}`,
    thumbUrl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/x/${name}/330px-${name}`,
    width: 3000,
    height: 2000,
    size: 3_000_000,
    mime: 'image/jpeg',
    ...overrides,
    metadata: {
      Artist: '<a href="//commons.wikimedia.org/wiki/User:Ann">Ann &amp; Bob</a>',
      License: 'cc-by-sa-4.0',
      LicenseShortName: 'CC BY-SA 4.0',
      ...metadata,
    },
  });
  const files = new Map([
    ['Lion.jpg', file('Lion.jpg')],
    ['Violin.png', file('Violin.png', { width: 700, height: 951, mime: 'image/png' })],
    ['Crowd.jpg', file('Crowd.jpg', {}, { Restrictions: 'personality' })],
    ['Nameless.jpg', file('Nameless.jpg')],
    ['Omar.jpg', file('Omar.jpg', {}, { Restrictions: 'personality' })],
    ['Omar2.jpg', file('Omar2.jpg')],
  ]);
  // Two namesakes, and a famous item that is not a person.
  const person = (overrides: Partial<PersonFacts>): PersonFacts => ({
    human: true,
    file: null,
    popularity: 10,
    frenchArticle: true,
    description: null,
    familyNameQid: null,
    ...overrides,
  });
  const people = new Map<string, PersonFacts>([
    [
      'Q501',
      person({
        file: 'Omar.jpg',
        popularity: 120,
        description: 'acteur français',
        familyNameQid: 'Q9501',
      }),
    ],
    ['Q502', person({ file: 'Omar2.jpg', popularity: 30, description: 'footballeur sénégalais' })],
    [
      'Q503',
      person({
        human: false,
        file: 'Paris.jpg',
        popularity: 300,
        description: 'capitale de la France',
      }),
    ],
  ]);
  const downloads: string[] = [];
  return {
    downloads,
    async sparql(query) {
      // A search that fails, to see the admin told so.
      if (query.includes('Q39546')) throw new Error('query.wikidata.org did not answer (HTTP 504)');
      if (query.includes('Q33999')) return [{ qid: 'Q501', popularity: 120, file: 'Omar.jpg' }];
      // The other occupation queries of the people themes find nobody here.
      if (query.includes('wdt:P106')) return [];
      return [
        { qid: 'Q140', popularity: 180, file: 'Lion.jpg' },
        { qid: 'Q8355', popularity: 170, file: 'Violin.png' },
        { qid: 'Q777', popularity: 90, file: 'Crowd.jpg' },
        { qid: 'Q999', popularity: 50, file: 'Nameless.jpg' },
      ];
    },
    async entities(qids) {
      const labels: Record<string, { fr?: string; en?: string }> = {
        Q140: { fr: 'lion', en: 'lion' },
        Q8355: { fr: 'violon', en: 'violin' },
        Q777: { fr: 'foule', en: 'crowd' },
        Q999: { en: 'nameless' },
        Q501: { fr: 'Omar Sy', en: 'Omar Sy' },
        Q502: { fr: 'Omar Sy' },
        Q9501: { fr: 'Sy', en: 'Sy' },
      };
      return new Map(
        qids.map((qid) => [
          qid,
          {
            labels: labels[qid] ?? {},
            aliases: { fr: qid === 'Q140' ? ['Panthera leo'] : [], en: [] },
          },
        ]),
      );
    },
    async people(qids) {
      return new Map(qids.flatMap((qid) => (people.has(qid) ? [[qid, people.get(qid)!]] : [])));
    },
    async subjects(qids) {
      return new Map(
        qids.map((qid) => [
          qid,
          { instanceOf: [], subclassOf: [], taxonName: null, description: { fr: null, en: null } },
        ]),
      );
    },
    async searchHumans(name) {
      if (name === 'Omar Sy') return ['Q501', 'Q502'];
      return name === 'Paris' ? ['Q503'] : [];
    },
    async files(names) {
      return new Map(names.flatMap((name) => (files.has(name) ? [[name, files.get(name)!]] : [])));
    },
    async download(url) {
      downloads.push(url);
      return picture;
    },
  };
}

describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('Wikimedia importer', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let url: string;
  let mediaDir: string;
  let cookie = '';
  let wikimedia: ReturnType<typeof fakeWikimedia>;
  const run = randomUUID();
  const email = `importer-${run}@test.local`;
  const packIds: string[] = [];

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${url}/api${path}`, { ...init, headers: { cookie, ...init.headers } });
  const send = (method: string, path: string, body: unknown) =>
    call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function searched(preset: string): Promise<ImportSearch> {
    for (let i = 0; i < 100; i++) {
      const { search } = (await (await call(`/admin/import/searches/${preset}`)).json()) as {
        search: ImportSearch | null;
      };
      if (search && search.state !== 'running') return search;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('the search never finished');
  }

  async function newPack(ownerId?: string): Promise<string> {
    const pack = await app.get(PrismaService).pack.create({
      data: { titleFr: `Import ${run}`, titleEn: `Import ${run}`, category: 'ANIMAL', ownerId },
    });
    packIds.push(pack.id);
    return pack.id;
  }

  async function celebrityPack(): Promise<string> {
    const pack = await app.get(PrismaService).pack.create({
      data: {
        titleFr: `Stars ${run}`,
        titleEn: `Stars ${run}`,
        category: 'CELEBRITY',
        restricted: true,
      },
    });
    packIds.push(pack.id);
    return pack.id;
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'closeup-import-'));
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      MEDIA_DIR: mediaDir,
      // Its own queues and search keys: the stack's worker must not take these jobs.
      QUEUE_PREFIX: `test-${run}`,
    });
    const picture = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: '#c08040' },
    })
      .jpeg()
      .toBuffer();
    wikimedia = fakeWikimedia(picture);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WIKIMEDIA)
      .useValue(wikimedia)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    url = await listen(app);
    // One clear face in the middle of the 1600 × 1200 test picture, its eyes 200 px apart.
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
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(WIKIMEDIA)
      .useValue(wikimedia)
      .overrideProvider(FACE_DETECTOR)
      .useValue({ detect: async () => [oneFace] })
      .compile();
    worker.useLogger(false);
    await worker.init();

    await app.get(AuthService).upsertAdmin(email, PASSWORD);
    const login = await send('POST', '/auth/login', { email, password: PASSWORD });
    cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.pack.deleteMany({ where: { id: { in: packIds } } });
    await prisma.user.deleteMany({ where: { email } });
    const redis = app.get<Redis>(REDIS);
    const keys = await redis.keys(`closeup:import:test-${run}:*`);
    if (keys.length) await redis.del(...keys);
    await worker.close();
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('is for admins only', async () => {
    const anonymous = await fetch(`${url}/api/admin/import/searches/animals`);
    expect(anonymous.status).toBe(401);
  });

  it('has nothing to show before a search, and refuses an unknown preset', async () => {
    expect(await (await call('/admin/import/searches/animals')).json()).toEqual({ search: null });
    expect((await call('/admin/import/searches/people')).status).toBe(400);
    expect((await send('POST', '/admin/import/searches', { preset: 'people' })).status).toBe(400);
  });

  it('searches in the background and says why a subject cannot be imported', async () => {
    const started = await send('POST', '/admin/import/searches', { preset: 'animals' });
    expect(started.status).toBe(201);

    const search = await searched('animals');
    expect(search.state).toBe('done');
    const byQid = Object.fromEntries(
      search.candidates.map((candidate) => [candidate.qid, candidate]),
    );
    expect(byQid.Q140).toMatchObject({
      rejection: null,
      difficulty: 1,
      answers: { fr: { text: 'lion', aliases: ['Panthera leo'] } },
      credit: { author: 'Ann & Bob', licence: 'CC BY-SA 4.0' },
      importedIn: [],
    });
    expect(byQid.Q8355?.rejection).toBe('TOO_SMALL');
    expect(byQid.Q777?.rejection).toBe('PERSONALITY');
    expect(byQid.Q999?.rejection).toBe('NO_FRENCH_NAME');
  });

  it('says when Wikidata did not answer, and lets the search be run again', async () => {
    await send('POST', '/admin/import/searches', { preset: 'tools' });
    expect((await searched('tools')).state).toBe('failed');
    const again = await send('POST', '/admin/import/searches', { preset: 'tools' });
    expect(((await again.json()) as { search: ImportSearch }).search.state).toBe('running');
    await searched('tools');
  });

  it('imports what the server found, never what the browser makes up', async () => {
    const packId = await newPack();
    const response = await send('POST', '/admin/import', {
      preset: 'animals',
      packId,
      qids: ['Q140', 'Q8355', 'Q12345', 'Q140'],
    });
    expect(response.status).toBe(201);
    expect((await response.json()) as ImportResult).toEqual({
      created: 1,
      cardIds: [expect.any(String)],
      skipped: [
        { qid: 'Q8355', reason: 'NOT_ELIGIBLE' },
        { qid: 'Q12345', reason: 'UNKNOWN' },
      ],
    });

    const prisma = app.get(PrismaService);
    const card = await prisma.card.findFirstOrThrow({
      where: { packId, slug: 'wd-Q140' },
      include: { answers: true },
    });
    expect(card).toMatchObject({
      source: 'WIKIMEDIA',
      category: 'ANIMAL',
      isPerson: false,
      creditAuthor: 'Ann & Bob',
      creditLicence: 'CC BY-SA 4.0',
      creditSourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=8',
    });
    expect(card.answers.find((answer) => answer.locale === 'fr')).toMatchObject({
      text: 'lion',
      aliases: ['Panthera leo'],
    });

    // The worker fetches the original from Commons and ingests it: the card waits for points.
    let current: AdminCard | undefined;
    for (let i = 0; i < 100; i++) {
      current = (await (await call(`/admin/cards/${card.id}`)).json()) as AdminCard;
      if (current.status !== 'PROCESSING') break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(current?.status).toBe('NEEDS_POINTS');
    expect(current?.image).toMatchObject({ width: 1600, height: 1200 });
    expect(wikimedia.downloads).toEqual([
      'https://upload.wikimedia.org/wikipedia/commons/x/Lion.jpg',
    ]);
  });

  it('never imports a subject twice into the same pack, and says where it already is', async () => {
    const [packId] = packIds;
    const again = await send('POST', '/admin/import', {
      preset: 'animals',
      packId,
      qids: ['Q140'],
    });
    expect(await again.json()).toEqual({
      created: 0,
      cardIds: [],
      skipped: [{ qid: 'Q140', reason: 'ALREADY_IN_PACK' }],
    });
    const search = await searched('animals');
    expect(search.candidates.find((candidate) => candidate.qid === 'Q140')?.importedIn).toEqual([
      `Import ${run}`,
    ]);
  });

  it('only fills house packs, and only from a search still at hand', async () => {
    const player = await app.get(PrismaService).player.create({ data: { nickname: `p-${run}` } });
    const playerPack = await newPack(player.id);
    const intoPlayerPack = await send('POST', '/admin/import', {
      preset: 'animals',
      packId: playerPack,
      qids: ['Q140'],
    });
    expect(intoPlayerPack.status).toBe(404);

    const noSearch = await send('POST', '/admin/import', {
      preset: 'fruits',
      packId: packIds[0],
      qids: ['Q140'],
    });
    expect(noSearch.status).toBe(409);
    await app.get(PrismaService).pack.deleteMany({ where: { id: playerPack } });
    await app.get(PrismaService).player.delete({ where: { id: player.id } });
  });

  it('finds actors, a personality flag notwithstanding, with the family name as an alias', async () => {
    await send('POST', '/admin/import/searches', { preset: 'actors' });
    const search = await searched('actors');
    expect(search.candidates[0]).toMatchObject({
      qid: 'Q501',
      rejection: null,
      description: 'acteur français',
      answers: { fr: { text: 'Omar Sy', aliases: ['Sy'] } },
    });
  });

  it('searches a list of names: namesakes grouped, unknown names reported', async () => {
    await send('POST', '/admin/import/searches', {
      preset: 'names',
      names: ['Omar Sy', 'Paris', 'Personne Inconnue'],
    });
    const search = await searched('names');
    expect(search.candidates.map((candidate) => [candidate.qid, candidate.query])).toEqual([
      ['Q501', 'Omar Sy'],
      ['Q502', 'Omar Sy'],
    ]);
    expect(search.unmatched).toEqual(['Paris', 'Personne Inconnue']);
  });

  it('imports people into a celebrity pack only, as persons', async () => {
    const animals = await newPack();
    const refused = await send('POST', '/admin/import', {
      preset: 'actors',
      packId: animals,
      qids: ['Q501'],
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'PACK_NOT_FOR_PEOPLE' });

    const stars = await celebrityPack();
    const result = (await (
      await send('POST', '/admin/import', { preset: 'actors', packId: stars, qids: ['Q501'] })
    ).json()) as ImportResult;
    expect(result.created).toBe(1);
    expect(result.cardIds).toHaveLength(1);
    const card = await app
      .get(PrismaService)
      .card.findUniqueOrThrow({ where: { id: result.cardIds[0]! } });
    expect(card).toMatchObject({ category: 'CELEBRITY', isPerson: true });
  });

  it('gives an imported person with one clear face their points and their crops', async () => {
    const stars = await celebrityPack();
    const { cardIds } = (await (
      await send('POST', '/admin/import', { preset: 'actors', packId: stars, qids: ['Q501'] })
    ).json()) as ImportResult;
    let card: AdminCard | undefined;
    for (let i = 0; i < 75; i++) {
      card = (await (await call(`/admin/cards/${cardIds[0]}`)).json()) as AdminCard;
      if (card.status !== 'PROCESSING') break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(card?.status).toBe('READY');
    expect(card?.zoomPoints).toHaveLength(5);
    expect(card?.zoomPoints.every((point) => point.cropsReady)).toBe(true);
  });
});
