import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AdminCard, AdminPack } from '@closeup/shared';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { configureApp } from '../bootstrap.js';
import { DeckService } from '../content/deck.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { listen } from '../testing/listen.js';
import { WorkerModule } from '../worker.module.js';

const PASSWORD = 'a long enough passphrase';

/** A picture with nothing secret in its pixels, and something secret in its metadata. */
const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#d9a066' } })
    .withExif({ IFD0: { Copyright: 'SECRET-OWNER', Artist: 'SECRET-ARTIST' } })
    .jpeg()
    .toBuffer();

// The whole back-office path, against the Compose Postgres and Redis (CI has them as services),
// with the real worker in the same process: upload, ingest, points, crops, publication.
describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('back-office', () => {
  let app: INestApplication;
  let worker: INestApplicationContext;
  let url: string;
  let mediaDir: string;
  let cookie = '';
  let pack: AdminPack;
  let card: AdminCard;
  const email = `admin-${randomUUID()}@test.local`;
  /** Accounts made inside a test, to be removed with the rest. */
  const victims: string[] = [];

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${url}/api${path}`, { ...init, headers: { cookie, ...init.headers } });
  const send = (method: string, path: string, body: unknown) =>
    call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const upload = (file: Buffer, rightsConfirmed: boolean, headers: Record<string, string> = {}) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(file)]), 'whatever.jpg');
    form.set('rightsConfirmed', String(rightsConfirmed));
    return call(`/admin/cards/${card.id}/image`, { method: 'POST', body: form, headers });
  };
  /** The worker is asynchronous: wait until it has dealt with the card. */
  async function settled(): Promise<AdminCard> {
    for (let i = 0; i < 100; i++) {
      const current = (await (await call(`/admin/cards/${card.id}`)).json()) as AdminCard;
      if (current.status !== 'PROCESSING') return current;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('the worker never finished');
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'closeup-media-'));
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      MEDIA_DIR: mediaDir,
      // A Compose worker may be listening on the same Redis: it must not take these jobs.
      QUEUE_PREFIX: `test-${randomUUID()}`,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    url = await listen(app);
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });

    // Failed logins are counted per address for 15 minutes: forget those of previous runs.
    const redis = app.get<Redis>(REDIS);
    const stale = await redis.keys('closeup:login:*');
    if (stale.length) await redis.del(...stale);
    await app.get(AuthService).upsertAdmin(email, PASSWORD);
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    if (pack) await prisma.pack.deleteMany({ where: { id: pack.id } });
    await prisma.user.deleteMany({ where: { email: { in: [email, ...victims] } } });
    await worker.close();
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('keeps the back-office shut without a session', async () => {
    expect((await call('/admin/packs')).status).toBe(401);
    expect((await call('/auth/me')).status).toBe(401);
  });

  it('answers a wrong password and an unknown address the same way', async () => {
    const wrong = await send('POST', '/auth/login', { email, password: 'not the password' });
    const unknown = await send('POST', '/auth/login', {
      email: 'nobody@test.local',
      password: 'x',
    });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('logs the admin in with an httpOnly cookie', async () => {
    const response = await send('POST', '/auth/login', {
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const [setCookie = ''] = response.headers.getSetCookie();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    cookie = setCookie.split(';')[0]!;
    expect(await (await call('/auth/me')).json()).toMatchObject({ email, role: 'ADMIN' });
  });

  it('shuts the door after five wrong passwords for one address', async () => {
    const victim = `victim-${randomUUID()}@test.local`;
    victims.push(victim);
    await app.get(AuthService).upsertAdmin(victim, PASSWORD);
    for (let i = 0; i < 5; i++)
      await send('POST', '/auth/login', { email: victim, password: 'nope' });
    const locked = await send('POST', '/auth/login', { email: victim, password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it('creates a pack, restricted when it is about real people', async () => {
    const people = await send('POST', '/admin/packs', {
      titleFr: 'Têtes connues',
      titleEn: 'Famous faces',
      category: 'CELEBRITY',
    });
    const celebrity = (await people.json()) as AdminPack;
    expect(celebrity).toMatchObject({ restricted: true, visibility: 'PRIVATE' });
    await app.get(PrismaService).pack.delete({ where: { id: celebrity.id } });

    const created = await send('POST', '/admin/packs', {
      titleFr: 'Cuisine',
      titleEn: 'Kitchen',
      category: 'OBJECT',
    });
    pack = (await created.json()) as AdminPack;
    expect(pack).toMatchObject({ restricted: false, visibility: 'PRIVATE', cards: {} });
  });

  it('never lets a restricted pack be marked safe for strangers', async () => {
    const refused = await send('POST', '/admin/packs', {
      titleFr: 'Têtes connues',
      titleEn: 'Famous faces',
      category: 'CELEBRITY',
      publicMatchSafe: true,
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'RESTRICTED_PUBLIC_MATCH' });

    const safe = (await (
      await send('POST', '/admin/packs', {
        titleFr: 'Objets sûrs',
        titleEn: 'Safe objects',
        category: 'OBJECT',
        publicMatchSafe: true,
      })
    ).json()) as AdminPack;
    const moved = await send('PUT', `/admin/packs/${safe.id}`, {
      titleFr: 'Objets sûrs',
      titleEn: 'Safe objects',
      category: 'CELEBRITY',
      publicMatchSafe: true,
    });
    expect(moved.status).toBe(409);
    await app.get(PrismaService).pack.delete({ where: { id: safe.id } });
  });

  it('refuses an upload before storing anything: no rights, not an image, another site', async () => {
    const created = await send('POST', `/admin/packs/${pack.id}/cards`, {
      category: 'OBJECT',
      isPerson: true,
    });
    card = (await created.json()) as AdminCard;
    expect(card).toMatchObject({ status: 'DRAFT', blockers: ['NO_IMAGE'] });

    const unconfirmed = await upload(await photo(1600, 1200), false);
    expect([unconfirmed.status, await unconfirmed.json()]).toEqual([
      400,
      expect.objectContaining({ code: 'RIGHTS_NOT_CONFIRMED' }),
    ]);

    const script = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const disguised = await upload(script, true);
    expect(await disguised.json()).toMatchObject({ code: 'UNSUPPORTED_TYPE' });

    const foreign = await upload(await photo(1600, 1200), true, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await readdir(mediaDir)).toEqual([]);
  });

  it('lets the worker refuse a picture that is too small, and says why', async () => {
    expect((await upload(await photo(500, 400), true)).status).toBe(201);
    expect(await settled()).toMatchObject({
      status: 'DRAFT',
      processingError: 'TOO_SMALL',
      image: null,
    });
  });

  it('stores an upright original without its EXIF, and looks for a face on a person', async () => {
    expect((await upload(await photo(5000, 3000), true)).status).toBe(201);
    card = await settled();
    expect(card).toMatchObject({
      status: 'NEEDS_POINTS',
      processingError: null,
      rightsConfirmed: true,
      // Resized: nothing downstream needs more than 4096 px.
      image: { width: 4096, height: 2458 },
      // The real detector ran, on a picture without anybody in it.
      detection: { verdict: 'none', faces: 0, proposals: [] },
    });

    const [original] = await readdir(join(mediaDir, 'originals'));
    const stored = await readFile(join(mediaDir, 'originals', original!));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes('SECRET-OWNER')).toBe(false);
    // The uploaded bytes themselves are gone.
    expect(await readdir(join(mediaDir, 'incoming'))).toEqual([]);
  });

  it('cuts the crops once two zoom points are placed, and waits to be published', async () => {
    const outside = await send('PUT', `/admin/cards/${card.id}/zoom-points`, {
      points: [{ x: 99_999, y: 10, baseRadius: 80 }],
    });
    expect(await outside.json()).toMatchObject({ code: 'POINT_OUTSIDE_IMAGE' });

    await send('PUT', `/admin/cards/${card.id}/zoom-points`, {
      points: [
        { x: 1000, y: 900, baseRadius: 90, labelFr: 'le levier', labelEn: 'the lever' },
        { x: 3000, y: 1500, baseRadius: 120 },
      ],
    });
    card = await settled();
    expect(card.status).toBe('READY');
    expect(card.zoomPoints.map((p) => p.cropsReady)).toEqual([true, true]);
    expect(card.blockers).toEqual(['CREDIT_MISSING', 'ANSWER_FR_MISSING', 'ANSWER_EN_MISSING']);
  });

  it('never publishes a card without a credit', async () => {
    const refused = await send('PUT', `/admin/cards/${card.id}/live`, { live: true });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'NOT_PUBLISHABLE' });

    const described = {
      category: 'OBJECT',
      difficulty: 2,
      isPerson: false,
      answers: {
        fr: { text: 'grille-pain', aliases: ['toaster'] },
        en: { text: 'toaster', aliases: [] },
      },
      credit: { author: '', licence: '', sourceUrl: '' },
    };
    await send('PUT', `/admin/cards/${card.id}`, described);
    const still = await send('PUT', `/admin/cards/${card.id}/live`, { live: true });
    expect(await still.json()).toMatchObject({ blockers: ['CREDIT_MISSING'] });

    const credit = { author: 'Awa Diop', licence: 'CC BY 4.0', sourceUrl: 'https://example.org/t' };
    await send('PUT', `/admin/cards/${card.id}`, { ...described, credit });
    const published = await send('PUT', `/admin/cards/${card.id}/live`, { live: true });
    expect(await published.json()).toMatchObject({ status: 'LIVE', blockers: [] });

    // Taking the credit away takes the card out of the game.
    const stripped = await send('PUT', `/admin/cards/${card.id}`, described);
    expect(await stripped.json()).toMatchObject({ status: 'READY' });
    await send('PUT', `/admin/cards/${card.id}`, { ...described, credit });
    await send('PUT', `/admin/cards/${card.id}/live`, { live: true });
  });

  it('takes a disabled pack out of the game at the next round, without a deploy', async () => {
    const decks = app.get(DeckService);
    expect(await decks.load(card.id, 'fr', 'text')).toBeNull();

    await send('PUT', `/admin/packs/${pack.id}/visibility`, { visibility: 'PUBLIC' });
    const playable = await decks.load(card.id, 'fr', 'text');
    expect(playable?.reveal).toMatchObject({
      answer: 'grille-pain',
      credit: { author: 'Awa Diop', licence: 'CC BY 4.0' },
    });

    await send('PUT', `/admin/packs/${pack.id}/visibility`, { visibility: 'DISABLED' });
    expect(await decks.load(card.id, 'fr', 'text')).toBeNull();
  });

  it('writes down who did what', async () => {
    const log = await app.get(PrismaService).auditLog.findMany({
      where: { targetId: { in: [pack.id, card.id] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'pack.create',
        'card.upload',
        'card.points',
        'card.publish',
        'pack.visibility',
      ]),
    );
  });

  it('deletes a card with every file it had', async () => {
    expect((await call(`/admin/cards/${card.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await readdir(join(mediaDir, 'originals'))).toEqual([]);
    expect(await readdir(join(mediaDir, 'reveal'))).toEqual([]);
    expect((await call(`/admin/cards/${card.id}`)).status).toBe(404);
  });

  it('deletes a pack only once it is empty, and never a seeded one', async () => {
    const seeded = await app.get(PrismaService).pack.findFirst({ where: { slug: { not: null } } });
    if (seeded) {
      const refused = await call(`/admin/packs/${seeded.id}`, { method: 'DELETE' });
      expect(refused.status).toBe(409);
    }
    expect((await call(`/admin/packs/${pack.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/admin/packs/${pack.id}`)).status).toBe(404);
  });

  it('ends the session on logout', async () => {
    expect((await call('/auth/logout', { method: 'POST' })).status).toBe(204);
    expect((await call('/admin/packs')).status).toBe(401);
  });
});
