import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type AdminReport,
  MATCHMAKING,
  PROTOCOL_VERSION,
  SOCKET_NAMESPACE,
  SOCKET_PATH,
} from '@closeup/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { configureApp } from '../bootstrap.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { listen } from '../testing/listen.js';

const PASSWORD = 'a long enough passphrase';

/** A phone: a device cookie, and a socket that carries it. */
class Phone {
  cookie = '';
  socket?: Socket;
  playerId = '';

  constructor(
    private readonly url: string,
    readonly nickname: string,
  ) {}

  async arrive(): Promise<this> {
    const response = await fetch(`${this.url}/api/identity/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: this.nickname }),
    });
    this.cookie = response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    this.playerId = ((await response.json()) as { playerId: string }).playerId;
    return this;
  }

  connect(): Promise<Socket> {
    const socket = io(this.url + SOCKET_NAMESPACE, {
      path: SOCKET_PATH,
      auth: { protocolVersion: PROTOCOL_VERSION },
      transports: ['websocket'],
      extraHeaders: { cookie: this.cookie },
      reconnection: false,
    });
    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  once<T>(event: string, ms = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout on ${event}`)), ms);
      this.socket!.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.url}/api${path}`, {
      method,
      headers: { cookie: this.cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

// Public games and moderation, against the Compose Postgres and Redis.
describe.runIf(process.env.CLOSEUP_TEST_INFRA === '1')('public games and moderation', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let adminCookie = '';
  const run = randomUUID().slice(0, 6);
  const email = `mod-${run}@test.local`;
  const phones: Phone[] = [];

  const newPhone = async (nickname: string): Promise<Phone> => {
    const phone = await new Phone(url, nickname).arrive();
    phones.push(phone);
    return phone;
  };
  const admin = (method: string, path: string, body?: unknown) =>
    fetch(`${url}/api${path}`, {
      method,
      headers: { cookie: adminCookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? '',
      QUEUE_PREFIX: `test-${randomUUID()}`,
      PUBLIC_MATCHES: 'on',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    url = await listen(app);
    prisma = app.get(PrismaService);

    await app.get(AuthService).upsertAdmin(email, PASSWORD);
    const login = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    adminCookie = login.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
  });

  afterAll(async () => {
    for (const phone of phones) phone.socket?.disconnect();
    await prisma.report.deleteMany({ where: { targetLabel: { contains: run } } });
    await prisma.player.deleteMany({ where: { nickname: { contains: run } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('turns away a nickname nobody should have to read', async () => {
    const phone = await newPhone(`Ok ${run}`);
    await phone.connect();
    const refused = await phone.socket!.emitWithAck('mm:join', {
      nickname: 'connard',
      language: 'fr',
    });
    expect(refused.error?.code).toBe('NICKNAME_REJECTED');

    const impostor = await phone.socket!.emitWithAck('mm:join', {
      nickname: 'Admin',
      language: 'fr',
    });
    expect(impostor.error?.code).toBe('NICKNAME_REJECTED');
  });

  it('matches three strangers of the same language into a room that starts by itself', async () => {
    const waiting = await Promise.all(
      ['Un', 'Deux', 'Trois'].map((name) => newPhone(`${name} ${run}`)),
    );
    for (const phone of waiting) await phone.connect();

    // Somebody waiting in the other language is not part of this.
    const english = await newPhone(`Four ${run}`);
    await english.connect();
    await english.socket!.emitWithAck('mm:join', { nickname: english.nickname, language: 'en' });

    const matched = waiting.map((phone) => phone.once<{ code: string }>('mm:matched', 20_000));
    const status = waiting[0]!.once<{ waiting: number }>('mm:status');
    for (const phone of waiting) {
      const ack = await phone.socket!.emitWithAck('mm:join', {
        nickname: phone.nickname,
        language: 'fr',
      });
      expect(ack.ok).toBe(true);
    }
    expect((await status).waiting).toBeGreaterThan(0);

    const codes = await Promise.all(matched);
    expect(new Set(codes.map((m) => m.code)).size).toBe(1);

    // They all land in the same public room, and it starts without anyone pressing start.
    const started = waiting.map((phone) => phone.once('game:started', 25_000));
    for (const phone of waiting) {
      const joined = await phone.socket!.emitWithAck('room:join', {
        code: codes[0]!.code,
        nickname: phone.nickname,
        role: 'player',
      });
      expect(joined.data?.mode).toBe('public');
    }
    const games = await Promise.all(started);
    expect(games).toHaveLength(3);

    // A stranger with the code cannot walk in, and the room is not listed by code either.
    const late = await newPhone(`Late ${run}`);
    await late.connect();
    const refused = await late.socket!.emitWithAck('room:join', {
      code: codes[0]!.code,
      nickname: late.nickname,
      role: 'player',
    });
    expect(refused.error?.code).toBe('BAD_PHASE');
    expect((await late.call('GET', `/rooms/${codes[0]!.code}`)).status).toBe(404);
    expect(MATCHMAKING.startAtPlayers).toBe(3);
  });

  it('leaves the queue when the socket goes, so nobody is matched with a ghost', async () => {
    const phone = await newPhone(`Parti ${run}`);
    await phone.connect();
    await phone.socket!.emitWithAck('mm:join', { nickname: phone.nickname, language: 'fr' });
    phone.socket!.disconnect();

    const watcher = await newPhone(`Reste ${run}`);
    await watcher.connect();
    const status = watcher.once<{ waiting: number }>('mm:status');
    await watcher.socket!.emitWithAck('mm:join', { nickname: watcher.nickname, language: 'fr' });
    expect((await status).waiting).toBe(1);
    await watcher.socket!.emitWithAck('mm:leave');
  });

  it('reports a player once, and shows the admin what is waiting', async () => {
    const [reporter, culprit] = [phones[1]!, phones[2]!];
    const report = {
      targetType: 'PLAYER',
      targetId: culprit.playerId,
      roomCode: 'AB2CD',
      reason: 'harassment',
      message: 'insultes pendant la partie',
    };
    expect((await reporter.call('POST', '/reports', report)).status).toBe(204);
    // The same complaint twice is one complaint.
    expect((await reporter.call('POST', '/reports', report)).status).toBe(204);
    const mine = await reporter.call('POST', '/reports', {
      ...report,
      targetId: reporter.playerId,
    });
    expect(mine.status).toBe(400);

    const reports = (await (await admin('GET', '/admin/reports')).json()) as AdminReport[];
    const open = reports.filter((row) => row.targetLabel.includes(run));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      reason: 'harassment',
      status: 'OPEN',
      banned: { user: false, devices: 0 },
    });
  });

  it('bans a player on their device and their account, and lets them back in later', async () => {
    const culprit = phones[2]!;
    const reports = (await (await admin('GET', '/admin/reports')).json()) as AdminReport[];
    const report = reports.find((row) => row.targetLabel.includes(run))!;

    const banned = await admin('POST', '/admin/bans', {
      playerId: culprit.playerId,
      reason: 'insultes',
      reportId: report.id,
    });
    expect(await banned.json()).toEqual({ user: false, devices: 1 });

    // Their device no longer counts as anybody: no room, no report, no queue.
    const room = await culprit.call('POST', '/rooms', {
      mode: 'solo',
      language: 'fr',
      settings: { rounds: 5, answerMode: 'mcq' },
    });
    expect(room.status).toBe(401);
    culprit.socket?.disconnect();
    await culprit.connect();
    const queue = await culprit.socket!.emitWithAck('mm:join', {
      nickname: culprit.nickname,
      language: 'fr',
    });
    expect(queue.error?.code).toBe('UNAUTHENTICATED');

    await admin('PUT', `/admin/reports/${report.id}`, { status: 'RESOLVED', note: 'banni' });
    const after = (await (await admin('GET', '/admin/reports')).json()) as AdminReport[];
    expect(after.some((row) => row.id === report.id)).toBe(false);

    const lifted = await admin('POST', '/admin/bans/lift', { playerId: culprit.playerId });
    expect(await lifted.json()).toEqual({ user: false, devices: 0 });
    culprit.socket?.disconnect();
    await culprit.connect();
    const again = await culprit.socket!.emitWithAck('mm:join', {
      nickname: culprit.nickname,
      language: 'fr',
    });
    expect(again.ok).toBe(true);
    await culprit.socket!.emitWithAck('mm:leave');
  });

  it('writes down every moderation move', async () => {
    const log = await prisma.auditLog.findMany({
      where: { targetType: 'moderation' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    expect(log.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['player.ban', 'player.unban', 'report.resolved']),
    );
  });
});
