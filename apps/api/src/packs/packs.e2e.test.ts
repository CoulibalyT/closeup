import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  type AdminCard,
  type AdminCardSummary,
  type AdminReport,
  type CataloguePack,
  type MyPack,
  type MyQuota,
  type PackCredits,
  QUOTA,
} from '@closeup/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { configureApp } from '../bootstrap.js';
import { DeckService } from '../content/deck.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { listen } from '../testing/listen.js';
import { WorkerModule } from '../worker.module.js';

const PASSWORD = 'a long enough passphrase';
const picture = (background: string) =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background } })
    .jpeg()
    .toBuffer();
/** A checkerboard: detail everywhere, so that automatic points find something. */
const textured = () => {
  const squares = Array.from({ length: 16 * 12 }, (_, i) => {
    const col = i % 16;
    const row = Math.floor(i / 16);
    return (col + row) % 2
      ? ''
      : `<rect x="${col * 100}" y="${row * 100}" width="100" height="100"/>`;
  }).join('');
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#eee"/><g fill="#222">${squares}</g></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
};

/** A browser that keeps its cookies, like the real thing. */
class Browser {
  private readonly jar = new Map<string, string>();
  constructor(private readonly url: string) {}

  async call(method: string, path: string, body?: unknown): Promise<Response> {
    const form = body instanceof FormData;
    const response = await fetch(`${this.url}/api${path}`, {
      method,
      headers: {
        cookie: [...this.jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(body === undefined || form ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [name = '', value = ''] = (line.split(';')[0] ?? '').split('=');
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
    return response;
  }

  json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.call(method, path, body).then((response) => response.json() as Promise<T>);
  }
}

// Player packs against the Compose Postgres and Redis, with the real worker in process.
describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('player packs', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let url: string;
  let mediaDir: string;
  let prisma: PrismaService;
  let author: Browser;
  let admin: Browser;
  let pack: MyPack;
  let card: AdminCard;
  let authorPlayerId = '';
  const run = randomUUID().slice(0, 6);
  const authorEmail = `author-${run}@test.local`;
  const adminEmail = `boss-${run}@test.local`;

  /** The worker is asynchronous: wait until it has finished with this card. */
  async function settled(id = card.id): Promise<AdminCard> {
    for (let i = 0; i < 80; i++) {
      const current = await author.json<AdminCard>('GET', `/me/packs/cards/${id}`);
      if (current.status !== 'PROCESSING') return current;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('the worker never finished');
  }

  /** A finished card of this pack: image, points, answers, credit, published. */
  async function makeCard(colour: string, answer: string, packId = pack.id): Promise<AdminCard> {
    const created = await author.json<AdminCard>('POST', `/me/packs/${packId}/cards`, {
      category: 'OBJECT',
    });
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(await picture(colour))]), 'mine.jpg');
    form.set('rightsConfirmed', 'true');
    await author.call('POST', `/me/packs/cards/${created.id}/image`, form);
    card = await settled(created.id);

    await author.call('PUT', `/me/packs/cards/${created.id}/zoom-points`, {
      points: [
        { x: 300, y: 300, baseRadius: 60 },
        { x: 900, y: 600, baseRadius: 60 },
      ],
    });
    await settled(created.id);
    await author.call('PUT', `/me/packs/cards/${created.id}`, {
      category: 'OBJECT',
      difficulty: 2,
      isPerson: false,
      answers: { fr: { text: answer, aliases: [] }, en: { text: answer, aliases: [] } },
      credit: { author: `Awa ${run}`, licence: 'CC BY 4.0', sourceUrl: '' },
    });
    return author.json<AdminCard>('PUT', `/me/packs/cards/${created.id}/live`, { live: true });
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'closeup-packs-'));
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      MEDIA_DIR: mediaDir,
      QUEUE_PREFIX: `test-${randomUUID()}`,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    url = await listen(app);
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    prisma = app.get(PrismaService);

    author = new Browser(url);
    const guest = await author.json<{ playerId: string }>('POST', '/identity/guest', {
      nickname: `Awa ${run}`,
    });
    authorPlayerId = guest.playerId;
    await author.call('POST', '/auth/register', { email: authorEmail, password: PASSWORD });

    admin = new Browser(url);
    await app.get(AuthService).upsertAdmin(adminEmail, PASSWORD);
    await admin.call('POST', '/auth/login', { email: adminEmail, password: PASSWORD });
  });

  afterAll(async () => {
    if (pack) await prisma.pack.deleteMany({ where: { id: pack.id } });
    await prisma.report.deleteMany({ where: { targetLabel: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { in: [authorEmail, adminEmail] } } });
    await prisma.player.deleteMany({ where: { nickname: { contains: run } } });
    await worker.close();
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('needs an account to make a pack', async () => {
    const stranger = new Browser(url);
    const refused = await stranger.call('POST', '/me/packs', {
      titleFr: 'Sans compte',
      titleEn: 'No account',
      category: 'OBJECT',
    });
    expect(refused.status).toBe(401);
  });

  it('creates a pack that is private, and says what the quota allows', async () => {
    pack = await author.json<MyPack>('POST', '/me/packs', {
      titleFr: `Ma cuisine ${run}`,
      titleEn: `My kitchen ${run}`,
      descriptionFr: 'Des objets de chez moi.',
      category: 'OBJECT',
    });
    expect(pack).toMatchObject({ visibility: 'PRIVATE', playableCards: 0 });

    const mine = await author.json<{ packs: MyPack[]; quota: MyQuota }>('GET', '/me/packs');
    expect(mine.packs.some((row) => row.id === pack.id)).toBe(true);
    expect(mine.quota.packs.used).toBeGreaterThan(0);
    expect(mine.quota.uploadsToday).toMatchObject({ used: 0, max: expect.any(Number) });
  });

  it('is nobody else’s to edit', async () => {
    const other = new Browser(url);
    await other.call('POST', '/identity/guest', { nickname: `Autre ${run}` });
    await other.call('POST', '/auth/register', {
      email: `other-${run}@test.local`,
      password: PASSWORD,
    });
    const refused = await other.call('PUT', `/me/packs/${pack.id}`, {
      titleFr: 'À moi',
      titleEn: 'Mine',
      category: 'OBJECT',
    });
    expect(refused.status).toBe(403);
    await prisma.user.deleteMany({ where: { email: `other-${run}@test.local` } });
  });

  it('makes a card playable in its author’s own rooms straight away', async () => {
    card = await makeCard('#c98', `théière ${run}`);
    expect(card).toMatchObject({ status: 'LIVE', blockers: [] });

    const decks = app.get(DeckService);
    // The pack is private, so only its author draws from it.
    expect(await decks.load(card.id, 'fr', 'text', { kind: 'room' })).toBeNull();
    const mine = await decks.load(card.id, 'fr', 'text', {
      kind: 'room',
      hostPlayerId: authorPlayerId,
    });
    expect(mine?.reveal.answer).toBe(`théière ${run}`);
    // And never in a public game between strangers.
    expect(await decks.load(card.id, 'fr', 'text', { kind: 'public' })).toBeNull();
  });

  it('refuses to submit a pack with nothing playable in it, and takes it afterwards', async () => {
    const empty = await author.json<MyPack>('POST', '/me/packs', {
      titleFr: `Vide ${run}`,
      titleEn: `Empty ${run}`,
      category: 'OBJECT',
    });
    const refused = await author.call('POST', `/me/packs/${empty.id}/submit`, {
      rightsConfirmed: true,
    });
    expect(await refused.json()).toMatchObject({ code: 'NO_PLAYABLE_CARD' });
    await author.call('DELETE', `/me/packs/${empty.id}`);

    const submitted = await author.json<MyPack>('POST', `/me/packs/${pack.id}/submit`, {
      rightsConfirmed: true,
    });
    expect(submitted).toMatchObject({ visibility: 'PENDING_REVIEW' });
    // Waiting for review changes nothing for its author's own games.
    const decks = app.get(DeckService);
    expect(
      await decks.load(card.id, 'fr', 'text', { kind: 'room', hostPlayerId: authorPlayerId }),
    ).not.toBeNull();
    // And it is not in the catalogue yet.
    const catalogue = await author.json<CataloguePack[]>('GET', '/packs');
    expect(catalogue.some((row) => row.id === pack.id)).toBe(false);
  });

  it('is sent back with a word for its author, then published on a second look', async () => {
    const queue = await admin.json<AdminReport[]>('GET', '/admin/reports');
    const submission = queue.find((row) => row.targetId === pack.id)!;
    expect(submission).toMatchObject({ targetType: 'PACK', reason: 'submission' });

    await admin.call('PUT', `/admin/reports/${submission.id}/pack`, {
      verdict: 'REJECT',
      note: 'Il manque les crédits sur deux images.',
    });
    const back = (await author.json<{ packs: MyPack[] }>('GET', '/me/packs')).packs.find(
      (row) => row.id === pack.id,
    )!;
    expect(back).toMatchObject({
      visibility: 'PRIVATE',
      reviewNote: 'Il manque les crédits sur deux images.',
    });

    await author.call('POST', `/me/packs/${pack.id}/submit`, { rightsConfirmed: true });
    const again = await admin.json<AdminReport[]>('GET', '/admin/reports');
    const second = again.find((row) => row.targetId === pack.id)!;
    await admin.call('PUT', `/admin/reports/${second.id}/pack`, { verdict: 'PUBLISH', note: '' });

    const published = (await author.json<{ packs: MyPack[] }>('GET', '/me/packs')).packs.find(
      (row) => row.id === pack.id,
    )!;
    expect(published.visibility).toBe('PUBLIC');
  });

  it('appears in the catalogue with its author and a cover, and owes its credits', async () => {
    const catalogue = await author.json<CataloguePack[]>('GET', '/packs');
    const row = catalogue.find((entry) => entry.id === pack.id)!;
    expect(row).toMatchObject({
      byPlayer: true,
      authorNickname: `Awa ${run}`,
      cards: 1,
      // Published is not the same as safe for strangers: that stays the owner's call.
      publicMatchSafe: false,
    });
    expect(row.coverUrl).toContain('/api/media/');

    const credits = await author.json<PackCredits>('GET', `/packs/${pack.id}/credits`);
    expect(credits.cards).toEqual([
      expect.objectContaining({ author: `Awa ${run}`, licence: 'CC BY 4.0' }),
    ]);
  });

  it('is playable by everybody once published, but still not by strangers', async () => {
    const decks = app.get(DeckService);
    expect(await decks.load(card.id, 'fr', 'text', { kind: 'room' })).not.toBeNull();
    expect(await decks.load(card.id, 'fr', 'text', { kind: 'public' })).toBeNull();

    // A room that picks another pack does not see this one.
    const elsewhere = await decks.load(card.id, 'fr', 'text', {
      kind: 'room',
      packIds: [randomUUID()],
    });
    expect(elsewhere).toBeNull();
  });

  it('can be reported by anybody who can see it', async () => {
    const stranger = new Browser(url);
    const sent = await stranger.call('POST', '/reports', {
      targetType: 'PACK',
      targetId: pack.id,
      reason: 'rights',
      message: `une image est à moi ${run}`,
    });
    expect(sent.status).toBe(204);
    const queue = await admin.json<AdminReport[]>('GET', '/admin/reports');
    expect(queue.some((row) => row.targetId === pack.id && row.reason === 'rights')).toBe(true);
  });

  it('takes a takedown request from somebody who does not play at all', async () => {
    const stranger = new Browser(url);
    const sent = await stranger.call('POST', '/takedown', {
      about: `pack ${run}`,
      contactEmail: 'rights@example.org',
      message: 'Cette photo est la mienne, merci de la retirer.',
      locale: 'fr',
    });
    expect(sent.status).toBe(204);
    const queue = await admin.json<AdminReport[]>('GET', '/admin/reports?status=all');
    const takedown = queue.find((row) => row.targetType === 'TAKEDOWN');
    expect(takedown).toMatchObject({ targetLabel: `pack ${run}` });
  });

  it('cannot be deleted while it is in the catalogue, and withdraws instead', async () => {
    const refused = await author.call('DELETE', `/me/packs/${pack.id}`);
    expect(await refused.json()).toMatchObject({ code: 'PUBLIC_PACK' });

    const withdrawn = await author.json<MyPack>('POST', `/me/packs/${pack.id}/withdraw`);
    expect(withdrawn.visibility).toBe('PRIVATE');
    const catalogue = await author.json<CataloguePack[]>('GET', '/packs');
    expect(catalogue.some((row) => row.id === pack.id)).toBe(false);
  });

  it('lists what a room may be told to play: the catalogue, plus one’s own', async () => {
    const mine = await author.json<CataloguePack[]>('GET', '/playable-packs');
    expect(mine.some((row) => row.id === pack.id)).toBe(true);

    const stranger = new Browser(url);
    await stranger.call('POST', '/identity/guest', { nickname: `Passant ${run}` });
    const theirs = await stranger.json<CataloguePack[]>('GET', '/playable-packs');
    expect(theirs.some((row) => row.id === pack.id)).toBe(false);
  });

  it('shows the pack’s cards to its author through the shared editor', async () => {
    const view = await author.json<{ pack: MyPack; cards: AdminCardSummary[] }>(
      'GET',
      `/me/packs/${pack.id}`,
    );
    expect(view.cards).toHaveLength(1);
    expect(view.cards[0]).toMatchObject({ status: 'LIVE', answerFr: `théière ${run}` });
  });
  it('an admin account is not held to the player quotas', async () => {
    // The admin plays too: a device with a guest player, then the admin's login takes it over.
    const boss = new Browser(url);
    const { playerId: bossPlayerId } = await boss.json<{ playerId: string }>(
      'POST',
      '/identity/guest',
      { nickname: `Boss ${run}` },
    );
    await boss.call('POST', '/auth/login', { email: adminEmail, password: PASSWORD });
    for (let i = 1; i <= QUOTA.packs + 1; i++) {
      const response = await boss.call('POST', '/me/packs', {
        titleFr: `Chef ${run} ${i}`,
        titleEn: `Boss ${run} ${i}`,
        category: 'OBJECT',
      });
      expect(response.status).toBe(201);
    }
    await prisma.pack.deleteMany({ where: { ownerId: bossPlayerId } });

    // A player still is.
    const { quota } = await author.json<{ quota: MyQuota }>('GET', '/me/packs');
    const extra: string[] = [];
    for (let i = quota.packs.used; i < QUOTA.packs; i++) {
      const made = await author.json<MyPack>('POST', '/me/packs', {
        titleFr: `Plein ${run} ${i}`,
        titleEn: `Full ${run} ${i}`,
        category: 'OBJECT',
      });
      extra.push(made.id);
    }
    const refused = await author.call('POST', '/me/packs', {
      titleFr: `Trop ${run}`,
      titleEn: `Too many ${run}`,
      category: 'OBJECT',
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'QUOTA_PACKS' });
    await prisma.pack.deleteMany({ where: { id: { in: extra } } });
  });

  it('a dropped picture gets its points and goes live in the private pack', async () => {
    const drop = await author.json<MyPack>('POST', '/me/packs', {
      titleFr: `Mon dossier ${run}`,
      titleEn: `My folder ${run}`,
      category: 'OBJECT',
    });
    // What the page does for every file: a card, its answer from the file name, the picture.
    const created = await author.json<AdminCard>('POST', `/me/packs/${drop.id}/cards`, {
      category: 'OBJECT',
    });
    await author.call('PUT', `/me/packs/cards/${created.id}`, {
      category: 'OBJECT',
      difficulty: 2,
      isPerson: false,
      answers: {
        fr: { text: `râpe ${run}`, aliases: [] },
        en: { text: `grater ${run}`, aliases: [] },
      },
      credit: { author: `Awa ${run}`, licence: 'Collection privée', sourceUrl: '' },
    });
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(await textured())]), 'rape.jpg');
    form.set('rightsConfirmed', 'true');
    form.set('auto', 'true');
    const accepted = await author.call('POST', `/me/packs/cards/${created.id}/image`, form);
    expect(accepted.status).toBe(201);

    const done = await settled(created.id);
    expect(done.status).toBe('LIVE');
    const points = await prisma.zoomPoint.findMany({ where: { cardId: created.id } });
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.every((point) => point.origin === 'AUTO')).toBe(true);

    // Drawn in a party of its owner that ticks the pack; never in a public game.
    const decks = app.get(DeckService);
    const mine = await decks.load(created.id, 'fr', 'text', {
      kind: 'room',
      hostPlayerId: authorPlayerId,
      packIds: [drop.id],
    });
    expect(mine?.reveal.answer).toBe(`râpe ${run}`);
    expect(await decks.load(created.id, 'fr', 'text', { kind: 'public' })).toBeNull();
    await prisma.pack.deleteMany({ where: { id: drop.id } });
  });
  it('never lets a locked pack out, whatever the door, until its owner vouches for the rights', async () => {
    const locked = await author.json<MyPack>('POST', '/me/packs', {
      titleFr: `Verrou ${run}`,
      titleEn: `Lock ${run}`,
      category: 'CHARACTER',
    });
    await prisma.pack.update({ where: { id: locked.id }, data: { publishable: false } });
    const live = await makeCard('#9c6', `héros ${run}`, locked.id);
    expect(live.status).toBe('LIVE');

    const submit = await author.call('POST', `/me/packs/${locked.id}/submit`, {
      rightsConfirmed: true,
    });
    expect(submit.status).toBe(409);
    expect(await submit.json()).toMatchObject({ code: 'NOT_PUBLISHABLE' });

    const visible = await admin.call('PUT', `/admin/packs/${locked.id}/visibility`, {
      visibility: 'PUBLIC',
    });
    expect(visible.status).toBe(409);

    const flags = await admin.call('PUT', `/admin/packs/${locked.id}`, {
      titleFr: `Verrou ${run}`,
      titleEn: `Lock ${run}`,
      category: 'OBJECT',
      publicMatchSafe: true,
    });
    expect(flags.status).toBe(409);

    // Nor by its owner turning it into an unrestricted category.
    const recat = await author.call('PUT', `/me/packs/${locked.id}`, {
      titleFr: `Verrou ${run}`,
      titleEn: `Lock ${run}`,
      category: 'OBJECT',
    });
    expect(recat.status).toBe(409);
    expect(await recat.json()).toMatchObject({ code: 'NOT_PUBLISHABLE' });

    // A submission that slipped in before the lock is refused at review too.
    await prisma.pack.update({ where: { id: locked.id }, data: { visibility: 'PENDING_REVIEW' } });
    const report = await prisma.report.create({
      data: {
        targetType: 'PACK',
        targetId: locked.id,
        targetLabel: `x ${run}`,
        reason: 'submission',
      },
    });
    const review = await admin.call('PUT', `/admin/reports/${report.id}/pack`, {
      verdict: 'PUBLISH',
      note: '',
    });
    expect(review.status).toBe(409);
    expect((await prisma.pack.findUniqueOrThrow({ where: { id: locked.id } })).visibility).not.toBe(
      'PUBLIC',
    );
    const mine = await author.json<{ pack: MyPack }>('GET', `/me/packs/${locked.id}`);
    expect(mine.pack.publishable).toBe(false);

    // The owner lifts the lock only by vouching for the rights, and it is written down.
    const noBox = await admin.call('POST', `/admin/packs/${locked.id}/unlock`, {});
    expect(noBox.status).toBe(400);
    const unlock = await admin.call('POST', `/admin/packs/${locked.id}/unlock`, {
      rightsConfirmed: true,
    });
    expect(unlock.status).toBe(201);
    expect(await unlock.json()).toMatchObject({ publishable: true });
    expect(
      await prisma.auditLog.count({ where: { action: 'pack.unlock', targetId: locked.id } }),
    ).toBe(1);
    const now = await admin.call('PUT', `/admin/packs/${locked.id}/visibility`, {
      visibility: 'PUBLIC',
    });
    expect(now.status).toBe(200);

    await prisma.report.delete({ where: { id: report.id } });
    await prisma.pack.delete({ where: { id: locked.id } });
  });
});
