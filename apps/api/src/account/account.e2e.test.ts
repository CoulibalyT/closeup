import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PlayerStats, Rankings, SessionUser } from '@closeup/shared';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { engineCard } from '../testing/cards.js';
import { Party } from '../testing/party.js';
import { HistoryService, rankByScore } from '../history/history.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { listen } from '../testing/listen.js';

describe('rankByScore', () => {
  it('lets equal scores share a rank and skips the next one', () => {
    const ranked = rankByScore([{ score: 500 }, { score: 900 }, { score: 500 }, { score: 100 }]);
    expect(ranked.map((p) => p.rank)).toEqual([2, 1, 2, 4]);
  });
});

/** A browser: it keeps whatever cookies the server sets, like the real thing. */
class Browser {
  private readonly jar = new Map<string, string>();
  constructor(private readonly url: string) {}

  async call(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.url}/api${path}`, {
      method,
      headers: {
        cookie: [...this.jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
    return response;
  }

  /** Hands one cookie over to another browser: a session that outlived its device cookie. */
  give(name: RegExp, to: Browser): void {
    for (const [key, value] of this.jar) if (name.test(key)) to.jar.set(key, value);
  }

  async guest(nickname: string): Promise<string> {
    const response = await this.call('POST', '/identity/guest', { nickname });
    return ((await response.json()) as { playerId: string }).playerId;
  }

  async stats(): Promise<PlayerStats> {
    return (await (await this.call('GET', '/me/stats')).json()) as PlayerStats;
  }
}

// Accounts against the Compose Postgres and Redis (CI has them as services).
describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('accounts', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let history: HistoryService;
  const sent: { to: string; token: string }[] = [];
  const run = randomUUID().slice(0, 8);
  const email = `awa-${run}@test.local`;
  const PASSWORD = 'a long enough passphrase';
  const startedAt = new Date();

  /** Plays a three-round game between these players and writes it down, as a room would. */
  async function playGame(ids: [string, string, string], winner: string): Promise<void> {
    const party = new Party({ players: 3 });
    // The test party names its players p1..p3: give them the real ids of this test.
    const rename = (value: unknown): unknown =>
      JSON.parse(
        JSON.stringify(value).replace(/"p([123])"/g, (_, n: string) => `"${ids[Number(n) - 1]}"`),
      );
    party.state = rename(party.state) as typeof party.state;
    const roundId = () => party.state.round!.id;
    party.send(
      { type: 'guess', playerId: winner, roundId: roundId(), text: 'orange' },
      party.start + 3_000,
    );
    party.send({ type: 'tick' }, party.start + 30_000);
    party.send({ type: 'tick' }, party.start + 38_000);
    party.send({ type: 'cardReady', card: engineCard(7) }, party.start + 38_000);
    const second = party.state.round!.startsAt;
    party.send({ type: 'tick' }, second);
    party.send(
      { type: 'guess', playerId: winner, roundId: roundId(), text: 'orange' },
      second + 5_000,
    );
    party.send({ type: 'tick' }, second + 30_000);
    // Test cards are called "card-1"; real ones have the UUID the history table expects.
    party.state.history = party.state.history!.map((round) => ({ ...round, cardId: randomUUID() }));
    expect(await history.record(party.state)).toEqual(expect.any(String));
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      QUEUE_PREFIX: `test-${randomUUID()}`,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    url = await listen(app);
    prisma = app.get(PrismaService);
    history = app.get(HistoryService);

    // The reset link leaves by e-mail: catch it on its way out.
    vi.spyOn(app.get(MailService), 'passwordReset').mockImplementation(
      async (to, _locale, token) => {
        sent.push({ to, token });
      },
    );
    const redis = app.get<Redis>(REDIS);
    const stale = await redis.keys('closeup:*:ip:*');
    if (stale.length) await redis.del(...stale);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `${run}@test.local` } } });
    // Test players, and the anonymous guests that logging out or deleting an account created.
    await prisma.player.deleteMany({
      where: {
        OR: [
          { nickname: { endsWith: run } },
          { nickname: 'Joueur', userId: null, createdAt: { gte: startedAt } },
        ],
      },
    });
    await app.close();
  });

  it('gives a guest statistics of their own, without any account', async () => {
    const phone = new Browser(url);
    expect((await phone.call('GET', '/me/stats')).status).toBe(404);

    const awa = await phone.guest(`Awa ${run}`);
    const moussa = await new Browser(url).guest(`Moussa ${run}`);
    const ines = await new Browser(url).guest(`Inès ${run}`);
    await playGame([awa, moussa, ines], awa);

    expect(await phone.stats()).toMatchObject({
      hasAccount: false,
      games: 1,
      multiplayerGames: 1,
      wins: 1,
      roundsSeated: 2,
      correctCount: 2,
      averageFoundMs: 4_000,
    });
  });

  it('turns that guest into an account without losing anything', async () => {
    const phone = new Browser(url);
    const awa = await phone.guest(`Awa ${run}`);
    const others = [
      await new Browser(url).guest(`M ${run}`),
      await new Browser(url).guest(`I ${run}`),
    ];
    await playGame([awa, others[0]!, others[1]!], awa);

    const weak = await phone.call('POST', '/auth/register', { email, password: 'short' });
    expect(weak.status).toBe(400);

    const created = await phone.call('POST', '/auth/register', { email, password: PASSWORD });
    expect(created.status).toBe(201);
    expect((await created.json()) as SessionUser).toMatchObject({
      email,
      role: 'PLAYER',
      nickname: `Awa ${run}`,
    });
    // The same player row, now owned: nothing was copied.
    expect(await prisma.player.findUnique({ where: { id: awa } })).toMatchObject({
      userId: expect.any(String),
    });
    expect(await phone.stats()).toMatchObject({ hasAccount: true, games: 1, wins: 1 });

    const again = await new Browser(url).call('POST', '/auth/register', {
      email,
      password: PASSWORD,
    });
    expect([again.status, await again.json()]).toEqual([
      409,
      expect.objectContaining({ code: 'EMAIL_TAKEN' }),
    ]);
  });

  it('merges what was played as a guest on another device when its owner logs in there', async () => {
    const tablet = new Browser(url);
    const guest = await tablet.guest(`Tab ${run}`);
    const others = [
      await new Browser(url).guest(`M2 ${run}`),
      await new Browser(url).guest(`I2 ${run}`),
    ];
    await playGame([others[0]!, guest, others[1]!], others[0]!);
    await prisma.soloBest.create({ data: { playerId: guest, configKey: 'mcq:5', score: 3_200 } });
    expect(await tablet.stats()).toMatchObject({ games: 1, wins: 0 });

    const wrong = await tablet.call('POST', '/auth/login', { email, password: 'not this one' });
    expect(wrong.status).toBe(401);
    const login = await tablet.call('POST', '/auth/login', { email, password: PASSWORD });
    expect(login.status).toBe(200);

    // One player now: the phone's game and the tablet's, the guest row gone, its best kept.
    const stats = await tablet.stats();
    expect(stats).toMatchObject({ hasAccount: true, games: 2, wins: 1, nickname: `Awa ${run}` });
    expect(stats.soloBests).toEqual([
      expect.objectContaining({ configKey: 'mcq:5', score: 3_200 }),
    ]);
    expect(await prisma.player.findUnique({ where: { id: guest } })).toBeNull();
  });

  it('realigns a browser whose session outlived its device cookie: it plays as the account again', async () => {
    const before = new Browser(url);
    await before.call('POST', '/auth/login', { email, password: PASSWORD });

    // Same session, but the device cookie is a fresh guest's (cleared storage, restored backup).
    const after = new Browser(url);
    await after.guest(`Perdu ${run}`);
    before.give(/_session$/, after);
    expect(await after.stats()).toMatchObject({ hasAccount: false, games: 0 });

    expect(await (await after.call('GET', '/auth/me')).json()).toMatchObject({
      email,
      nickname: `Awa ${run}`,
    });
    expect(await after.stats()).toMatchObject({ hasAccount: true, games: 2 });
  });

  it('shows accounts in the ranking, never guests, and says which line is yours', async () => {
    const phone = new Browser(url);
    await phone.call('POST', '/auth/login', { email, password: PASSWORD });
    const rankings = (await (await phone.call('GET', '/rankings?period=week')).json()) as Rankings;

    const mine = rankings.rows.find((row) => row.you) ?? rankings.you;
    expect(mine).toMatchObject({ nickname: `Awa ${run}`, games: 2, wins: 1 });
    const names = rankings.rows.map((row) => row.nickname);
    expect(names).not.toContain(`M ${run}`);
    expect(names).not.toContain(`Moussa ${run}`);

    // Somebody who is not logged in sees the same board, with no line of their own.
    const stranger = (await (await new Browser(url).call('GET', '/rankings')).json()) as Rankings;
    expect(stranger.rows.some((row) => row.you)).toBe(false);
  });

  it('hands the device a fresh guest on logout: the history stays with the account', async () => {
    const phone = new Browser(url);
    await phone.call('POST', '/auth/login', { email, password: PASSWORD });
    expect((await phone.stats()).games).toBe(2);

    expect((await phone.call('POST', '/auth/logout')).status).toBe(204);
    expect((await phone.call('GET', '/auth/me')).status).toBe(401);
    expect(await phone.stats()).toMatchObject({ hasAccount: false, games: 0 });
  });

  it('resets a forgotten password with a one-hour, one-use link, and never says who has an account', async () => {
    const anyone = new Browser(url);
    const unknown = await anyone.call('POST', '/auth/password/forgot', {
      email: `nobody-${run}@test.local`,
    });
    const known = await anyone.call('POST', '/auth/password/forgot', { email });
    expect([unknown.status, known.status]).toEqual([204, 204]);
    expect(sent.map((mail) => mail.to)).toEqual([email]);

    const { token } = sent[0]!;
    const forged = await anyone.call('POST', '/auth/password/reset', {
      token: 'x'.repeat(43),
      password: 'another long passphrase',
    });
    expect(await forged.json()).toMatchObject({ code: 'RESET_INVALID' });

    const reset = await anyone.call('POST', '/auth/password/reset', {
      token,
      password: 'another long passphrase',
    });
    expect(reset.status).toBe(204);
    const replay = await anyone.call('POST', '/auth/password/reset', { token, password: PASSWORD });
    expect(replay.status).toBe(409);

    expect((await anyone.call('POST', '/auth/login', { email, password: PASSWORD })).status).toBe(
      401,
    );
    const login = await anyone.call('POST', '/auth/login', {
      email,
      password: 'another long passphrase',
    });
    expect(login.status).toBe(200);
  });

  it('changes the password only with the current one, and ends the other sessions', async () => {
    const phone = new Browser(url);
    const laptop = new Browser(url);
    for (const device of [phone, laptop]) {
      await device.call('POST', '/auth/login', { email, password: 'another long passphrase' });
    }
    const refused = await phone.call('POST', '/auth/password/change', {
      current: 'not the current one',
      next: PASSWORD,
    });
    expect(await refused.json()).toMatchObject({ code: 'WRONG_PASSWORD' });

    const changed = await phone.call('POST', '/auth/password/change', {
      current: 'another long passphrase',
      next: PASSWORD,
    });
    expect(changed.status).toBe(204);
    expect((await phone.call('GET', '/auth/me')).status).toBe(200);
    expect((await laptop.call('GET', '/auth/me')).status).toBe(401);
  });

  it('deletes the account for good, and keeps its games anonymous in other people’s history', async () => {
    const phone = new Browser(url);
    await phone.call('POST', '/auth/login', { email, password: PASSWORD });
    const refused = await phone.call('DELETE', '/auth/me', { password: 'nope' });
    expect(refused.status).toBe(409);

    expect((await phone.call('DELETE', '/auth/me', { password: PASSWORD })).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect((await phone.call('POST', '/auth/login', { email, password: PASSWORD })).status).toBe(
      401,
    );
    // The device plays on as a fresh guest.
    expect(await phone.stats()).toMatchObject({ hasAccount: false, games: 0 });
    const left = await prisma.gameParticipant.count({ where: { nickname: `Awa ${run}` } });
    expect(left).toBe(0);
  });
});
