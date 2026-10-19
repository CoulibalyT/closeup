import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { AuthService } from '../../auth/auth.service.js';
import { AdminContentService } from '../../admin/admin-content.service.js';
import { configureApp } from '../../bootstrap.js';
import { playableWhere } from '../../content/playable.js';
import { FACE_DETECTOR } from '../../pipeline/face/detector.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import { listen } from '../../testing/listen.js';
import { WorkerModule } from '../../worker.module.js';
import type { CommonsFile, WikimediaApi } from '../wikimedia.client.js';
import { WIKIMEDIA } from '../wikimedia.client.js';
import { DatasetCorrections } from './corrections.js';
import { type DatasetLine, DatasetImporter } from './dataset-importer.service.js';

const PASSWORD = 'a long enough passphrase';
const run = randomUUID().slice(0, 6);
/** Pack and card slugs of this run: the dev database may hold the real `ds-*` packs. */
const prefix = `t${run}`;

const commonsFile = (name: string, author: string | null): CommonsFile => ({
  pageId: name.length,
  url: `https://upload.wikimedia.org/wikipedia/commons/x/${name}`,
  thumbUrl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/x/${name}/330px-${name}`,
  width: 3000,
  height: 2000,
  size: 3_000_000,
  mime: 'image/jpeg',
  metadata: {
    ...(author ? { Artist: author } : {}),
    License: 'cc-by-sa-4.0',
    LicenseShortName: 'CC BY-SA 4.0',
  },
});

const fakeWikimedia = {
  async files(names: string[]) {
    return new Map(
      names.map((name) => [name, commonsFile(name, name.startsWith('Ann') ? null : 'Ann Photo')]),
    );
  },
  async itemsForTitles(titles: string[]) {
    return new Map(
      titles.flatMap((t) =>
        t.startsWith('Omar Sy')
          ? [[t, 'Q998601']]
          : t.startsWith('Persona')
            ? [[t, 'Q998701']]
            : [],
      ),
    );
  },
} as unknown as WikimediaApi;

const entries = [
  {
    id: 'omar',
    name: `Omar Sy ${run}`,
    category: 'acteur',
    image: 'images/acteur/omar.jpg',
    source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Omar.jpg?utm=1',
    page_url: `https://fr.wikipedia.org/wiki/Omar_Sy_${run}`,
    page_title: `Omar Sy ${run}`,
    tags: ['acteur'],
  },
  {
    id: 'ann',
    name: `Ann Author ${run}`,
    category: 'chanteur',
    image: 'images/chanteur/ann.jpg',
    source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Ann.jpg',
    page_url: 'https://fr.wikipedia.org/wiki/Ann',
    page_title: 'Ann',
  },
  {
    id: 'zidane',
    name: `Zinedine Zidane ${run}`,
    category: 'sportif',
    image: 'images/sportif/zidane.jpg',
    source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Zidane.jpg',
    page_url: 'https://fr.wikipedia.org/wiki/Zidane',
    page_title: 'Zidane',
  },
  {
    id: 'missing',
    name: `Missing ${run}`,
    category: 'acteur',
    image: 'images/acteur/missing.jpg',
    source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Missing.jpg',
    page_url: 'https://fr.wikipedia.org/wiki/Missing',
    page_title: 'Missing',
  },
  {
    id: 'alex',
    name: `Alex ${run} (Totally Spies)`,
    category: 'fiction',
    image: 'images/fiction/alex.jpg',
    source: 'fandom',
    wiki: 'totallyspies',
    source_url: 'https://static.wikia.nocookie.net/totallyspies/images/alex.png',
    page_url: 'https://totallyspies.fandom.com/wiki/Alex',
    page_title: 'Alex',
    tags: ['fiction', 'enfants'],
  },
  {
    id: 'babar',
    name: `Babar ${run}`,
    category: 'fiction',
    image: 'images/fiction/babar.jpg',
    source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Babar.jpg',
    page_url: 'https://fr.wikipedia.org/wiki/Babar',
    page_title: 'Babar',
    tags: ['fiction'],
  },
];

describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('dataset import', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let importer: DatasetImporter;
  let dir: string;
  let mediaDir: string;
  let ownerPlayerId = '';
  let housePackId = '';
  const ownerEmail = `owner-${run}@test.local`;

  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const processing = await prisma.card.count({
        where: { status: 'PROCESSING', pack: { slug: { startsWith: `${prefix}-` } } },
      });
      if (!processing) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('the worker never finished');
  };
  const runOnce = async (over: Record<string, unknown> = {}) => {
    const lines: DatasetLine[] = [];
    await importer.run({ dir, ownerEmail, slugPrefix: prefix, ...over }, (line) =>
      lines.push(line),
    );
    return lines;
  };
  const outcome = (lines: DatasetLine[], name: string, pack: string) =>
    lines.find((line) => line.name.startsWith(name) && line.pack === `${prefix}-${pack}`)?.outcome;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'closeup-dataset-'));
    mediaDir = await mkdtemp(join(tmpdir(), 'closeup-dataset-media-'));
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      MEDIA_DIR: mediaDir,
      QUEUE_PREFIX: `test-${randomUUID()}`,
      BULK_RUNNER: 'off',
    });
    // A checkerboard: detail everywhere, so that characters get their points.
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
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(entries));
    for (const entry of entries) {
      if (entry.id === 'missing') continue;
      await mkdir(join(dir, 'images', entry.category), { recursive: true });
      await writeFile(join(dir, entry.image), picture);
    }

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
      .useValue(fakeWikimedia)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await listen(app);
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(FACE_DETECTOR)
      .useValue({ detect: async () => [oneFace] })
      .compile();
    worker.useLogger(false);
    await worker.init();
    prisma = app.get(PrismaService);
    importer = app.get(DatasetImporter);

    // The owner: an admin account that has played (it has a player).
    const user = await app.get(AuthService).upsertAdmin(ownerEmail, PASSWORD);
    const player = await prisma.player.create({
      data: { nickname: `Owner ${run}`, userId: user.id },
    });
    ownerPlayerId = player.id;
    // A house card already answers "Zinédine Zidane": the dataset must not bring a second one.
    const house = await prisma.pack.create({
      data: {
        titleFr: `Maison ${run}`,
        titleEn: `House ${run}`,
        category: 'CELEBRITY',
        visibility: 'PUBLIC',
        restricted: true,
        cards: {
          create: {
            slug: `ds-house-${run}`,
            category: 'CELEBRITY',
            source: 'UPLOAD',
            status: 'LIVE',
            answers: { create: [{ locale: 'fr', text: `Zinédine Zidane ${run}`, aliases: [] }] },
          },
        },
      },
    });
    housePackId = house.id;
  });

  afterAll(async () => {
    await prisma.card.deleteMany({ where: { pack: { slug: { startsWith: `${prefix}-` } } } });
    await prisma.pack.deleteMany({ where: { slug: { startsWith: `${prefix}-` } } });
    // `in` lists, never bare values: an undefined filter is no filter at all.
    await prisma.pack.deleteMany({ where: { id: { in: [housePackId].filter(Boolean) } } });
    await prisma.player.deleteMany({ where: { id: { in: [ownerPlayerId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: ownerEmail } });
    await worker.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('refuses an owner without a player before writing anything', async () => {
    await expect(
      importer.run({ dir, ownerEmail: `nobody-${run}@test.local`, slugPrefix: prefix }, () => {}),
    ).rejects.toThrow(/OWNER_EMAIL/);
    expect(await prisma.pack.count({ where: { slug: { startsWith: `${prefix}-` } } })).toBe(0);
  });

  it('imports real people with their Commons credit, characters private and locked', async () => {
    const lines = await runOnce();
    expect(outcome(lines, 'Omar Sy', 'acteur')).toBe('created');
    expect(outcome(lines, 'Ann Author', 'chanteur')).toBe('refused:NO_AUTHOR');
    expect(outcome(lines, 'Zinedine Zidane', 'sportif')).toBe('exists');
    expect(outcome(lines, 'Missing', 'acteur')).toBe('refused:NO_FILE');
    expect(outcome(lines, 'Alex', 'fiction')).toBe('created');
    expect(outcome(lines, 'Alex', 'enfants')).toBe('created');
    expect(outcome(lines, 'Babar', 'fiction')).toBe('created');

    const packs = await prisma.pack.findMany({ where: { slug: { startsWith: `${prefix}-` } } });
    const bySlug = Object.fromEntries(packs.map((pack) => [pack.slug, pack]));
    expect(bySlug[`${prefix}-acteur`]).toMatchObject({
      ownerId: null,
      visibility: 'PUBLIC',
      category: 'CELEBRITY',
      restricted: true,
      publicMatchSafe: false,
      publishable: true,
    });
    for (const key of ['fiction', 'enfants']) {
      expect(bySlug[`${prefix}-${key}`]).toMatchObject({
        ownerId: ownerPlayerId,
        visibility: 'PRIVATE',
        category: 'CHARACTER',
        restricted: true,
        publicMatchSafe: false,
        publishable: false,
      });
    }

    await settled();
    const omar = await prisma.card.findFirstOrThrow({
      where: { slug: 'wd-Q998601' },
      include: { zoomPoints: true },
    });
    expect(omar).toMatchObject({
      status: 'LIVE',
      isPerson: true,
      source: 'WIKIMEDIA',
      creditAuthor: 'Ann Photo',
      creditLicence: 'CC BY-SA 4.0',
    });
    expect(omar.zoomPoints).toHaveLength(3);

    const alex = await prisma.card.findFirstOrThrow({
      where: { slug: `${prefix}-alex` },
      include: { zoomPoints: true, answers: true },
    });
    expect(alex).toMatchObject({
      status: 'LIVE',
      isPerson: false,
      source: 'UPLOAD',
      creditAuthor: 'Fandom — totallyspies',
      creditLicence: 'Usage privé',
      creditSourceUrl: 'https://totallyspies.fandom.com/wiki/Alex',
      difficulty: 2,
    });
    expect(alex.answers.find((a) => a.locale === 'fr')?.text).toBe(`Alex ${run}`);
    expect(alex.zoomPoints.length).toBeGreaterThanOrEqual(2);
    expect(alex.zoomPoints.every((point) => point.origin === 'AUTO')).toBe(true);
    const kids = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-alex-kids` } });
    expect(kids).toMatchObject({ status: 'LIVE', difficulty: 1 });
    const babar = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } });
    expect(babar.creditAuthor).toBe('Wikipédia');

    // Isolation: never in a public game; in the owner's room when ticked; not in someone else's.
    const fiction = bySlug[`${prefix}-fiction`]!;
    expect(
      await prisma.card.count({ where: { ...playableWhere({ kind: 'public' }), id: alex.id } }),
    ).toBe(0);
    expect(
      await prisma.card.count({
        where: {
          ...playableWhere({ kind: 'room', hostPlayerId: ownerPlayerId, packIds: [fiction.id] }),
          id: alex.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.card.count({
        where: {
          ...playableWhere({ kind: 'room', hostPlayerId: randomUUID(), packIds: [fiction.id] }),
          id: alex.id,
        },
      }),
    ).toBe(0);
  });

  it('creates nothing on a rerun, and remakes a card whose picture failed', async () => {
    const before = await prisma.card.count({
      where: { pack: { slug: { startsWith: `${prefix}-` } } },
    });
    const again = await runOnce();
    expect(again.filter((line) => line.outcome === 'created')).toEqual([]);
    expect(
      await prisma.card.count({ where: { pack: { slug: { startsWith: `${prefix}-` } } } }),
    ).toBe(before);

    const babar = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } });
    await prisma.card.update({
      where: { id: babar.id },
      data: { status: 'DRAFT', processingError: 'FAILED' },
    });
    const third = await runOnce();
    expect(outcome(third, 'Babar', 'fiction')).toBe('remade');
    await settled();
    expect(
      (await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } })).status,
    ).toBe('LIVE');
  });

  it('decides without writing on a dry run, and reports status per pack', async () => {
    await prisma.card.deleteMany({ where: { slug: `${prefix}-babar` } });
    const dry = await runOnce({ dryRun: true });
    expect(outcome(dry, 'Babar', 'fiction')).toBe('created');
    expect(await prisma.card.count({ where: { slug: `${prefix}-babar` } })).toBe(0);
    const status = await importer.status(prefix);
    expect(status[`${prefix}-acteur`]).toMatchObject({ LIVE: 1 });
    expect(status[`${prefix}-enfants`]).toMatchObject({ LIVE: 1 });
  });
  it('gives up a card left in flight without a job, and stops waiting for a worker that is gone', async () => {
    const fiction = await prisma.pack.findFirstOrThrow({ where: { slug: `${prefix}-fiction` } });
    const orphan = await prisma.card.create({
      data: {
        packId: fiction.id,
        slug: `${prefix}-babar`,
        category: 'CHARACTER',
        source: 'UPLOAD',
        status: 'PROCESSING',
      },
    });
    await prisma.$executeRaw`UPDATE "Card" SET "updatedAt" = now() - interval '1 hour' WHERE id = ${orphan.id}::uuid`;
    const lines = await runOnce();
    expect(outcome(lines, 'Babar', 'fiction')).toBe('remade');
    await settled();

    // Five pictures in flight that never move: the command says so and stops, it does not hang.
    await prisma.card.deleteMany({ where: { slug: `${prefix}-babar` } });
    await prisma.card.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        packId: fiction.id,
        slug: `${prefix}-stuck-${i}`,
        category: 'CHARACTER' as const,
        source: 'UPLOAD' as const,
        status: 'PROCESSING' as const,
      })),
    });
    let waited = 0;
    await expect(
      importer.run(
        { dir, ownerEmail, slugPrefix: prefix, waitLimitMs: 300, onWait: () => waited++ },
        () => {},
      ),
    ).rejects.toThrow(/worker/);
    expect(waited).toBe(1);
    await prisma.card.deleteMany({ where: { slug: { startsWith: `${prefix}-stuck-` } } });
    await runOnce();
    await settled();
  });

  it('adds nothing to a character pack its owner unlocked', async () => {
    const fiction = await prisma.pack.findFirstOrThrow({ where: { slug: `${prefix}-fiction` } });
    await prisma.pack.update({ where: { id: fiction.id }, data: { publishable: true } });
    await prisma.card.deleteMany({ where: { slug: `${prefix}-alex` } });
    const lines = await runOnce();
    expect(outcome(lines, 'Alex', 'fiction')).toBe('refused:PACK_UNLOCKED');
    expect(await prisma.card.count({ where: { slug: `${prefix}-alex` } })).toBe(0);
    await prisma.pack.update({ where: { id: fiction.id }, data: { publishable: false } });
  });

  it('does not remake what will fail again, and an unreadable image is one line', async () => {
    const kids = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-alex-kids` } });
    await prisma.card.update({
      where: { id: kids.id },
      data: { status: 'DRAFT', processingError: 'TOO_SMALL' },
    });
    const lines = await runOnce();
    expect(outcome(lines, 'Alex', 'enfants')).toBe('refused:TOO_SMALL');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: kids.id } })).status).toBe('DRAFT');

    // An image path that is a folder, then a sound one: the first is a line, the second goes in.
    const other = await mkdtemp(join(tmpdir(), 'closeup-dataset-bad-'));
    await mkdir(join(other, 'images', 'fiction', 'folder.jpg'), { recursive: true });
    await writeFile(
      join(other, 'manifest.json'),
      JSON.stringify([
        { ...entries[5], id: 'folder', name: `Dossier ${run}`, image: 'images/fiction/folder.jpg' },
      ]),
    );
    const bad = await importer.run({ dir: other, ownerEmail, slugPrefix: prefix }, () => {});
    expect(bad[`${prefix}-fiction`]).toEqual({ 'refused:NO_FILE': 1 });
    await rm(other, { recursive: true, force: true });
  });
  it('takes smaller drawings into the locked packs, not smaller photos into the published ones', async () => {
    const other = await mkdtemp(join(tmpdir(), 'closeup-dataset-small-'));
    const squares = Array.from({ length: 6 * 5 }, (_, i) =>
      (i % 6) + (Math.floor(i / 6) % 2) * 1 === 0 || ((i % 6) + Math.floor(i / 6)) % 2
        ? ''
        : `<rect x="${(i % 6) * 70}" y="${Math.floor(i / 6) * 70}" width="70" height="70"/>`,
    ).join('');
    const small = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="350"><rect width="420" height="350" fill="#eee"/><g fill="#222">${squares}</g></svg>`,
      ),
    )
      .png()
      .toBuffer();
    await mkdir(join(other, 'images', 'fiction'), { recursive: true });
    await mkdir(join(other, 'images', 'acteur'), { recursive: true });
    await writeFile(join(other, 'images', 'fiction', 'petit.png'), small);
    await writeFile(join(other, 'images', 'acteur', 'petit.png'), small);
    await writeFile(
      join(other, 'manifest.json'),
      JSON.stringify([
        {
          ...entries[4],
          id: 'petit',
          name: `Petit ${run}`,
          image: 'images/fiction/petit.png',
          tags: ['fiction'],
        },
        {
          ...entries[0],
          id: 'petite',
          name: `Omar Sy ${run} bis`,
          image: 'images/acteur/petit.png',
          page_title: 'none',
          page_url: 'https://fr.wikipedia.org/wiki/None',
        },
      ]),
    );
    await importer.run({ dir: other, ownerEmail, slugPrefix: prefix }, () => {});
    await settled();
    expect(
      (await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-petit` } })).status,
    ).toBe('LIVE');
    expect(
      await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-petite` } }),
    ).toMatchObject({ status: 'DRAFT', processingError: 'TOO_SMALL' });
    await rm(other, { recursive: true, force: true });
  });
  it('exports the review and plays it back on another base: points, levels, cards taken out', async () => {
    await settled();
    const corrections = app.get(DatasetCorrections);
    const alex = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } });
    const omar = await prisma.card.findFirstOrThrow({ where: { slug: 'wd-Q998601' } });
    // The review: Babar moves to level 1 with hand-placed points, Omar is taken out.
    await prisma.card.update({ where: { id: alex.id }, data: { difficulty: 1 } });
    const image = await prisma.imageAsset.findUniqueOrThrow({ where: { id: alex.imageId! } });
    const admin = app.get(AdminContentService);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const actor = {
      id: owner.id,
      email: ownerEmail,
      role: 'ADMIN' as const,
      playerId: null,
      nickname: null,
      emailVerified: true,
    };
    await admin.setZoomPoints(
      alex.id,
      [
        {
          x: image.width * 0.25,
          y: image.height * 0.25,
          baseRadius: 40,
          labelFr: '',
          labelEn: '',
          weight: 1,
          origin: 'MANUAL',
        },
        {
          x: image.width * 0.75,
          y: image.height * 0.5,
          baseRadius: 40,
          labelFr: '',
          labelEn: '',
          weight: 1,
          origin: 'MANUAL',
        },
      ],
      actor,
    );
    await settled();
    await admin.setLive(omar.id, false, actor);

    const file = join(dir, 'corrections.json');
    const exported = await corrections.export(file, prefix);
    expect(exported.cards).toBeGreaterThanOrEqual(3);

    // Another base: the same cards as the import left them.
    await prisma.card.update({ where: { id: alex.id }, data: { difficulty: 2 } });
    await admin.setZoomPoints(
      alex.id,
      [
        { x: 10, y: 10, baseRadius: 20, labelFr: '', labelEn: '', weight: 1, origin: 'AUTO' },
        { x: 30, y: 30, baseRadius: 20, labelFr: '', labelEn: '', weight: 1, origin: 'AUTO' },
      ],
      actor,
    );
    await settled();
    await admin.setLive(alex.id, true, actor).catch(() => undefined);
    await admin.setLive(omar.id, true, actor);

    const applied = await corrections.apply(file, ownerEmail, prefix);
    expect(applied).toMatchObject({ points: 1, off: 1 });
    expect(applied.difficulty).toBeGreaterThanOrEqual(1);
    const after = await prisma.card.findUniqueOrThrow({
      where: { id: alex.id },
      include: { zoomPoints: true },
    });
    expect(after).toMatchObject({ difficulty: 1, status: 'LIVE' });
    expect(after.zoomPoints.map((p) => Math.round((p.x / image.width) * 100)).sort()).toEqual([
      25, 75,
    ]);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: omar.id } })).status).toBe('READY');
    // Played again, nothing more to do.
    expect(await corrections.apply(file, ownerEmail, prefix)).toMatchObject({
      points: 0,
      difficulty: 0,
      off: 0,
    });
  });
  it('carries face landmarks placed by hand to another base, and cuts the card again', async () => {
    await settled();
    const corrections = app.get(DatasetCorrections);
    const card = await prisma.card.findFirstOrThrow({
      where: { slug: `${prefix}-alex` },
      include: { image: true },
    });
    const { width, height } = card.image!;
    const at = (zone: string, x: number, y: number) => ({
      zone,
      x: width * x,
      y: height * y,
      baseRadius: width * 0.05,
      labelFr: '',
      labelEn: '',
      weight: 1,
    });
    const landmarks = [at('leftEye', 0.4, 0.4), at('rightEye', 0.6, 0.4), at('nose', 0.5, 0.5)];
    await prisma.card.update({
      where: { id: card.id },
      data: { detection: { verdict: 'none', faces: 0, eyeDistancePx: null, proposals: landmarks } },
    });
    const file = join(dir, 'corrections-face.json');
    await corrections.export(file, prefix);

    // Another base, where detection found nothing on this photo.
    await prisma.card.update({
      where: { id: card.id },
      data: { detection: { verdict: 'none', faces: 0, eyeDistancePx: null, proposals: [] } },
    });
    const applied = await corrections.apply(file, ownerEmail, prefix);
    expect(applied.faces).toBe(1);
    await settled();
    const after = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    const proposals = (after.detection as { proposals: { zone: string; x: number }[] }).proposals;
    expect(proposals.map((p) => p.zone).sort()).toEqual(['leftEye', 'nose', 'rightEye']);
    expect(Math.round(proposals.find((p) => p.zone === 'nose')!.x)).toBe(Math.round(width * 0.5));
    // Played again, nothing more to do.
    expect((await corrections.apply(file, ownerEmail, prefix)).faces).toBe(0);
  });

  it('keeps the labels of the points it plays back, which the room difficulty reads', async () => {
    await settled();
    const corrections = app.get(DatasetCorrections);
    const admin = app.get(AdminContentService);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const actor = {
      id: owner.id,
      email: ownerEmail,
      role: 'ADMIN' as const,
      playerId: null,
      nickname: null,
      emailVerified: true,
    };
    const card = await prisma.card.findFirstOrThrow({
      where: { slug: `${prefix}-alex` },
      include: { image: true },
    });
    const { width, height } = card.image!;
    const point = (x: number, en: string, fr: string) => ({
      x: width * x,
      y: height * 0.5,
      baseRadius: 30,
      labelFr: fr,
      labelEn: en,
      weight: 1,
      origin: 'MANUAL' as const,
    });
    await admin.setZoomPoints(
      card.id,
      [point(0.3, 'an eye', 'un œil'), point(0.6, 'the nose', 'le nez')],
      actor,
    );
    await settled();
    const file = join(dir, 'corrections-labels.json');
    await corrections.export(file, prefix);
    await admin.setZoomPoints(card.id, [point(0.1, '', ''), point(0.9, '', '')], actor);
    await settled();

    await corrections.apply(file, ownerEmail, prefix);
    await settled();
    const after = await prisma.zoomPoint.findMany({
      where: { cardId: card.id },
      orderBy: { x: 'asc' },
    });
    expect(after.map((p) => [p.labelEn, p.labelFr])).toEqual([
      ['an eye', 'un œil'],
      ['the nose', 'le nez'],
    ]);
  });

  it('makes one card per photo of a person, skips a tiny face, and opens a second pack when one is full', async () => {
    const other = await mkdtemp(join(tmpdir(), 'closeup-dataset-photos-'));
    const picture = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#a86' },
    })
      .jpeg()
      .toBuffer();
    await mkdir(join(other, 'images', 'tele'), { recursive: true });
    for (const name of ['persona', 'persona-2', 'persona-3', 'autre']) {
      await writeFile(join(other, 'images', 'tele', `${name}.jpg`), picture);
    }
    const commons = (name: string) =>
      `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}.jpg`;
    await writeFile(
      join(other, 'manifest.json'),
      JSON.stringify([
        {
          id: 'persona',
          name: `Persona ${run}`,
          category: 'tele',
          source: 'wikipedia',
          image: 'images/tele/persona.jpg',
          source_url: commons('Persona'),
          page_url: `https://fr.wikipedia.org/wiki/Persona_${run}`,
          page_title: `Persona ${run}`,
          face_px: 400,
          images: [
            { file: 'images/tele/persona.jpg', face_px: 400, source_url: commons('Persona') },
            { file: 'images/tele/persona-2.jpg', face_px: 300, source_url: commons('Persona2') },
            { file: 'images/tele/persona-3.jpg', face_px: 120, source_url: commons('Persona3') },
          ],
        },
        {
          id: 'autre',
          name: `Autre ${run}`,
          category: 'tele',
          source: 'wikipedia',
          image: 'images/tele/autre.jpg',
          source_url: commons('Autre'),
          page_url: 'https://fr.wikipedia.org/wiki/Autre',
          page_title: 'Autre',
          face_px: 350,
        },
      ]),
    );
    const lines: DatasetLine[] = [];
    await importer.run({ dir: other, ownerEmail, slugPrefix: prefix, packSize: 2 }, (line) =>
      lines.push(line),
    );
    expect(lines.map((l) => `${l.name.split(' ')[0]}${l.photo ?? ''} ${l.outcome}`)).toEqual([
      'Persona created',
      'Persona-p2 created',
      'Persona-p3 refused:SMALL_FACE',
      'Autre created',
    ]);
    const cards = await prisma.card.findMany({
      where: { slug: { in: ['wd-Q998701', 'wd-Q998701-p2', `${prefix}-autre`] } },
      include: { pack: true, answers: true },
    });
    const bySlug: Record<string, (typeof cards)[number]> = Object.fromEntries(
      cards.map((c) => [c.slug!, c]),
    );
    expect(bySlug['wd-Q998701-p2']!.answers.find((a) => a.locale === 'fr')?.text).toBe(
      `Persona ${run}`,
    );
    expect(bySlug['wd-Q998701']!.pack.slug).toBe(`${prefix}-tele`);
    expect(bySlug['wd-Q998701-p2']!.pack.slug).toBe(`${prefix}-tele`);
    // Two cards fill the first pack: the third goes to "— 2", published and restricted too.
    expect(bySlug[`${prefix}-autre`]!.pack).toMatchObject({
      slug: `${prefix}-tele-2`,
      titleFr: 'Télé & internet — 2',
      visibility: 'PUBLIC',
      restricted: true,
    });

    // A rerun finds every card where it is, whichever pack.
    const again: DatasetLine[] = [];
    await importer.run({ dir: other, ownerEmail, slugPrefix: prefix, packSize: 2 }, (l) =>
      again.push(l),
    );
    expect(again.filter((l) => l.outcome === 'created')).toEqual([]);
    await settled();
    await prisma.card.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
    await rm(other, { recursive: true, force: true });
  });
  it('drops, only when asked and on a full run, the cards the manifest no longer has', async () => {
    await settled();
    const babar = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } });
    // The dataset excluded Babar.
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify(entries.filter((entry) => entry.id !== 'babar')),
    );
    try {
      await runOnce();
      expect(await prisma.card.findUnique({ where: { id: babar.id } })).not.toBeNull();
      // A partial run knows too little to drop anything.
      await runOnce({ dropMissing: true, only: 'fiction' });
      expect(await prisma.card.findUnique({ where: { id: babar.id } })).not.toBeNull();

      const lines = await runOnce({ dropMissing: true });
      expect(lines.filter((line) => line.outcome === 'dropped').map((line) => line.name)).toContain(
        `${prefix}-babar`,
      );
      expect(await prisma.card.findUnique({ where: { id: babar.id } })).toBeNull();
      // Everything the manifest still has stays.
      expect(await prisma.card.count({ where: { slug: `${prefix}-alex` } })).toBe(1);
    } finally {
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(entries));
      await runOnce();
      await settled();
    }
  });

  it('replaces a photo the dataset changed, only when asked, and never plays an old correction on it', async () => {
    await settled();
    const corrections = app.get(DatasetCorrections);
    const file = join(dir, 'corrections-photo.json');
    const before = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } });
    expect(before.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    await corrections.export(file, prefix);

    // The dataset swaps Babar's picture.
    const swapped = await sharp({
      create: { width: 900, height: 900, channels: 3, background: '#36c' },
    })
      .png()
      .toBuffer();
    await writeFile(join(dir, 'images/fiction/babar.jpg'), swapped);

    const plain = await runOnce();
    expect(outcome(plain, 'Babar', 'fiction')).toBe('exists');
    const replaced = await runOnce({ replaceChanged: true });
    expect(outcome(replaced, 'Babar', 'fiction')).toBe('replaced');
    await settled();
    const after = await prisma.card.findFirstOrThrow({ where: { slug: `${prefix}-babar` } });
    expect(after.id).not.toBe(before.id);
    expect(after.sourceHash).not.toBe(before.sourceHash);

    // The review was of the old picture: it is not played on the new one.
    const applied = await corrections.apply(file, ownerEmail, prefix);
    expect(applied.stale).toBeGreaterThanOrEqual(1);
  });
});
