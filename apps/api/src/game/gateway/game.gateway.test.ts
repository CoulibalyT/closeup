import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ackSchema,
  ClientEvent,
  PROTOCOL_VERSION,
  SOCKET_NAMESPACE,
  SOCKET_PATH,
  timePongSchema,
} from '@closeup/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IdentityService } from '../../identity/identity.service.js';
import { listen } from '../../testing/listen.js';
import { ModerationService } from '../../moderation/moderation.service.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { RoomService } from '../rooms/room.service.js';
import { GameGateway } from './game.gateway.js';
import { SocketAdapter } from './socket.adapter.js';

describe('GameGateway', () => {
  let app: INestApplication;
  let url: string;
  let socket: Socket | undefined;

  beforeAll(async () => {
    // The gateway alone: anonymous sockets, no database and no rooms behind it.
    const moduleRef = await Test.createTestingModule({
      providers: [
        GameGateway,
        { provide: RoomService, useValue: { onMessage: () => undefined } },
        { provide: IdentityService, useValue: { resolve: async () => null } },
        { provide: MatchmakingService, useValue: { listen: () => undefined } },
        { provide: ModerationService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new SocketAdapter(app, []));
    url = await listen(app);
  });

  afterEach(() => socket?.disconnect());
  afterAll(() => app.close());

  const connect = (auth: Record<string, unknown>) => {
    socket = io(url + SOCKET_NAMESPACE, {
      path: SOCKET_PATH,
      auth,
      transports: ['websocket'],
      reconnection: false,
    });
    return socket;
  };

  const connected = (client: Socket) =>
    new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });

  it('answers time:ping with the server clock', async () => {
    const client = connect({ protocolVersion: PROTOCOL_VERSION });
    await connected(client);

    const before = Date.now();
    const ack = ackSchema(timePongSchema).parse(
      await client.timeout(2_000).emitWithAck(ClientEvent.timePing, { t0: 1234 }),
    );
    const after = Date.now();

    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.data.t0).toBe(1234);
    expect(ack.data.t1).toBeGreaterThanOrEqual(before);
    expect(ack.data.t1).toBeLessThanOrEqual(after);
  });

  it('acks a malformed ping with INVALID_PAYLOAD instead of throwing', async () => {
    const client = connect({ protocolVersion: PROTOCOL_VERSION });
    await connected(client);

    const ack = await client.timeout(2_000).emitWithAck(ClientEvent.timePing, { t0: 'soon' });

    expect(ack).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });

  it.each([
    ['an outdated client', { protocolVersion: PROTOCOL_VERSION - 1 }],
    ['a client that sends no version', {}],
  ])('refuses %s with PROTOCOL_MISMATCH', async (_label, auth) => {
    const client = connect(auth);

    await expect(connected(client)).rejects.toMatchObject({
      message: 'PROTOCOL_MISMATCH',
      data: { code: 'PROTOCOL_MISMATCH', expected: PROTOCOL_VERSION },
    });
    expect(client.connected).toBe(false);
  });
});
