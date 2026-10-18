import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  type Ack,
  bonusUseSchema,
  checkNickname,
  ClientEvent,
  fail,
  handshakeAuthSchema,
  localeSchema,
  matchmakingJoinSchema,
  matchmakingStatusSchema,
  matchmakingMatchedSchema,
  ok,
  PROTOCOL_VERSION,
  revealSkipSchema,
  roundSkipSchema,
  ROOM,
  roomJoinSchema,
  roomKickSchema,
  type RoomPlayerLeft,
  roomScreensSchema,
  roomSettingsSchema,
  type RoomStateView,
  roundGuessSchema,
  roundPickSchema,
  ServerEvent,
  SOCKET_NAMESPACE,
  type TimePong,
  timePingSchema,
} from '@closeup/shared';
import type { Namespace, Socket } from 'socket.io';
import type { z } from 'zod';
import { DEVICE_COOKIE, readCookie } from '../../identity/device-token.js';
import { type Identity, IdentityService } from '../../identity/identity.service.js';
import type { Command, Reply } from '../engine/types.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { RoomService } from '../rooms/room.service.js';

interface SocketData {
  identity?: Identity;
  roomCode?: string;
  /** Set on `room:join`. A shared screen watches; only a player may send game commands. */
  role?: 'player' | 'screen';
  /** The public queue this socket is waiting in, if any. */
  queue?: 'fr' | 'en';
}
type GameSocket = Socket<never, never, never, SocketData>;

/** Everyone in the room, phones and shared screens alike. */
const channel = (code: string) => `room:${code}`;
/** Everyone waiting in one language's public queue, or one waiting player. */
const queueChannel = (language: string, playerId?: string) =>
  playerId ? `mm:${language}:${playerId}` : `mm:${language}`;
const playersChannel = (code: string) => `room:${code}:players`;
const screensChannel = (code: string) => `room:${code}:screens`;
/** Every socket of one player in one room: where their private messages go (bonuses, hints). */
const privateChannel = (code: string, playerId: string) => `room:${code}:player:${playerId}`;

@WebSocketGateway({ namespace: SOCKET_NAMESPACE })
export class GameGateway implements OnGatewayInit, OnGatewayDisconnect {
  private namespace!: Namespace;

  constructor(
    private readonly rooms: RoomService,
    private readonly identities: IdentityService,
    private readonly matchmaking: MatchmakingService,
  ) {}

  afterInit(namespace: Namespace): void {
    // Refused in a middleware so a stale client never counts as connected: it gets a
    // `connect_error` carrying the code, and reloads.
    namespace.use((socket, next) => {
      const auth = handshakeAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success || auth.data.protocolVersion !== PROTOCOL_VERSION) {
        const error = new Error('PROTOCOL_MISMATCH') as Error & { data?: unknown };
        error.data = { code: 'PROTOCOL_MISMATCH', expected: PROTOCOL_VERSION };
        return next(error);
      }
      // The cookie for browsers, `auth.token` for clients without cookies. Anonymous sockets
      // are allowed (clock sync needs no identity); room events check for themselves.
      const token = auth.data.token ?? readCookie(socket.handshake.headers.cookie, DEVICE_COOKIE);
      this.identities
        .resolve(token)
        .then((identity) => {
          (socket as GameSocket).data.identity = identity ?? undefined;
          next();
        })
        .catch(() => next());
    });

    this.namespace = namespace;

    // The queue talks to the sockets waiting in it, never to a room.
    this.matchmaking.listen(
      (language, players, code) => {
        const payload = matchmakingMatchedSchema.parse({ code });
        for (const player of players) {
          namespace
            .to(queueChannel(language, player.playerId))
            .emit(ServerEvent.matchmakingMatched, payload);
        }
      },
      (language, status) => {
        namespace
          .to(queueChannel(language))
          .emit(ServerEvent.matchmakingStatus, matchmakingStatusSchema.parse(status));
      },
    );

    this.rooms.onMessage((code, message, to) => {
      const audience = to
        ? privateChannel(code, to)
        : message.audience === 'screens'
          ? screensChannel(code)
          : message.audience === 'players'
            ? playersChannel(code)
            : channel(code);
      namespace.to(audience).emit(message.event, message.payload);
      if (message.event === ServerEvent.roomClosed) {
        namespace.in(channel(code)).socketsLeave([channel(code), screensChannel(code)]);
      }
      // Whoever left or was removed hears it (above), then stops receiving the room's events.
      if (message.event === ServerEvent.roomPlayerLeft) {
        const { playerId, removed } = message.payload as RoomPlayerLeft;
        if (removed) void this.detach(code, playerId);
      }
    });
  }

  // The players' channel, not the room's: a shared screen opened in the host's own browser
  // carries the host's identity, and must not count as the host being online.
  private async socketsOf(code: string, playerId: string) {
    const sockets = await this.namespace.in(playersChannel(code)).fetchSockets();
    return sockets.filter((s) => (s.data as SocketData).identity?.playerId === playerId);
  }

  /** Tells the room how many shared screens it has. `leaving` is a socket on its way out. */
  private async announceScreens(code: string, leaving?: string): Promise<number> {
    const sockets = await this.namespace.in(screensChannel(code)).fetchSockets();
    const count = sockets.filter((s) => s.id !== leaving).length;
    this.namespace
      .to(channel(code))
      .emit(ServerEvent.roomScreens, roomScreensSchema.parse({ count }));
    return count;
  }

  private async detach(code: string, playerId: string): Promise<void> {
    for (const socket of await this.socketsOf(code, playerId)) {
      socket.leave(channel(code));
      socket.leave(playersChannel(code));
      socket.leave(privateChannel(code, playerId));
      (socket.data as SocketData).roomCode = undefined;
    }
  }

  /** A player is offline when their *last* socket in the room closes (think of two tabs). */
  async handleDisconnect(socket: GameSocket): Promise<void> {
    const { identity, roomCode, role } = socket.data;
    // Waiting for a public game is waiting with this socket: closing it gives up the place.
    if (socket.data.queue && identity) {
      await this.matchmaking.leave(socket.data.queue, identity.playerId);
    }
    if (roomCode && role === 'screen') {
      await this.announceScreens(roomCode, socket.id);
      return;
    }
    if (!identity || !roomCode) return;
    const others = await this.socketsOf(roomCode, identity.playerId);
    if (others.some((s) => s.id !== socket.id)) return;
    await this.rooms.dispatch(roomCode, { type: 'disconnect', playerId: identity.playerId });
  }

  /** Returned value is the ack. `t1` is the only clock the clients agree on. */
  @SubscribeMessage(ClientEvent.timePing)
  onTimePing(@MessageBody() body: unknown): Ack<TimePong> {
    const ping = timePingSchema.safeParse(body);
    if (!ping.success) return fail('INVALID_PAYLOAD', 'time:ping expects { t0: number }');
    return ok({ t0: ping.data.t0, t1: Date.now() });
  }

  @SubscribeMessage(ClientEvent.roomJoin)
  async onRoomJoin(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<RoomStateView>> {
    const join = roomJoinSchema.safeParse(body);
    if (!join.success) return fail('INVALID_PAYLOAD', 'room:join expects { code, nickname, role }');
    if (join.data.role === 'screen') return this.joinAsScreen(socket, join.data.code);

    const { identity } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    const { code, nickname } = join.data;

    // The nickname typed here becomes the player's, so it is prefilled next time.
    if (nickname !== identity.nickname) {
      await this.identities.rename(identity.playerId, nickname);
      identity.nickname = nickname;
    }

    // Join the channel first: the reply to `join` is broadcast and they must hear it too.
    if (socket.data.roomCode && socket.data.roomCode !== code) {
      await socket.leave(channel(socket.data.roomCode));
      await socket.leave(playersChannel(socket.data.roomCode));
    }
    const mine = [channel(code), playersChannel(code), privateChannel(code, identity.playerId)];
    await socket.join(mine);
    const reply = await this.rooms.dispatch(code, {
      type: 'join',
      playerId: identity.playerId,
      nickname,
    });
    const screens = await this.namespace.in(screensChannel(code)).fetchSockets();
    const snapshot = reply.ok ? this.rooms.snapshot(code, identity.playerId, screens.length) : null;
    if (!reply.ok || !snapshot) {
      for (const left of mine) await socket.leave(left);
      return reply.ok ? fail('ROOM_NOT_FOUND', 'This room does not exist') : reply;
    }
    socket.data.roomCode = code;
    socket.data.role = 'player';
    return ok(snapshot);
  }

  /**
   * A shared screen never reaches the engine: it is not a player. It needs no identity either,
   * a TV browser only watches. Solo rooms have no summary, so they cannot be watched.
   */
  private async joinAsScreen(socket: GameSocket, code: string): Promise<Ack<RoomStateView>> {
    if (!this.rooms.summary(code)) return fail('ROOM_NOT_FOUND', 'This room does not exist');
    const already = await this.namespace.in(screensChannel(code)).fetchSockets();
    const others = already.filter((s) => s.id !== socket.id);
    if (others.length >= ROOM.maxScreens) return fail('ROOM_FULL', 'Too many screens on this room');

    await socket.join([channel(code), screensChannel(code)]);
    socket.data.roomCode = code;
    socket.data.role = 'screen';
    const count = await this.announceScreens(code);
    const snapshot = this.rooms.snapshot(code, null, count);
    return snapshot ? ok(snapshot) : fail('ROOM_NOT_FOUND', 'This room does not exist');
  }

  @SubscribeMessage(ClientEvent.roomLeave)
  async onRoomLeave(@ConnectedSocket() socket: GameSocket): Promise<Reply> {
    if (socket.data.role === 'screen' && socket.data.roomCode) {
      const code = socket.data.roomCode;
      await socket.leave(channel(code));
      await socket.leave(screensChannel(code));
      socket.data.roomCode = undefined;
      await this.announceScreens(code);
      return { ok: true, data: {} };
    }
    const reply = await this.inRoom(socket, (playerId) => ({ type: 'leave', playerId }));
    const { identity, roomCode } = socket.data;
    if (identity && roomCode) await this.detach(roomCode, identity.playerId);
    return reply;
  }

  @SubscribeMessage(ClientEvent.roomSettingsUpdate)
  onSettings(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Reply> {
    return this.inRoom(
      socket,
      (playerId, settings) => ({ type: 'updateSettings', playerId, settings }),
      [roomSettingsSchema, body],
    );
  }

  @SubscribeMessage(ClientEvent.roomKick)
  onKick(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Reply> {
    return this.inRoom(
      socket,
      (playerId, kick) => ({ type: 'kick', playerId, targetId: kick.playerId }),
      [roomKickSchema, body],
    );
  }

  @SubscribeMessage(ClientEvent.gameStart)
  async onGameStart(@ConnectedSocket() socket: GameSocket): Promise<Reply> {
    const { identity, roomCode, role } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    if (!roomCode || role !== 'player') return fail('ROOM_NOT_FOUND', 'Join a room first');
    // Phones show no image in big-screen mode: without a screen nobody would see the round.
    if (this.rooms.needsScreen(roomCode)) {
      const screens = await this.namespace.in(screensChannel(roomCode)).fetchSockets();
      if (!screens.length) return fail('NO_SCREEN', 'Open the shared screen first');
    }
    return this.rooms.start(roomCode, identity.playerId);
  }

  @SubscribeMessage(ClientEvent.gamePlayAgain)
  onPlayAgain(@ConnectedSocket() socket: GameSocket): Promise<Reply> {
    return this.inRoom(socket, (playerId) => ({ type: 'playAgain', playerId }));
  }

  @SubscribeMessage(ClientEvent.roundGuess)
  onGuess(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Reply> {
    return this.inRoom(
      socket,
      (playerId, guess) => ({ type: 'guess', playerId, roundId: guess.roundId, text: guess.text }),
      [roundGuessSchema, body],
    );
  }

  @SubscribeMessage(ClientEvent.roundPick)
  onPick(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Reply> {
    return this.inRoom(
      socket,
      (playerId, pick) => ({
        type: 'pick',
        playerId,
        roundId: pick.roundId,
        optionId: pick.optionId,
      }),
      [roundPickSchema, body],
    );
  }

  @SubscribeMessage(ClientEvent.bonusUse)
  async onBonusUse(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    const { identity, roomCode, role } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    if (!roomCode || role !== 'player') return fail('ROOM_NOT_FOUND', 'Join a room first');
    const use = bonusUseSchema.safeParse(body);
    if (!use.success) return fail('INVALID_PAYLOAD', 'bonus:use expects { roundId, itemId }');
    return this.rooms.useBonus(roomCode, {
      type: 'useBonus',
      playerId: identity.playerId,
      roundId: use.data.roundId,
      itemId: use.data.itemId,
      targetId: use.data.targetPlayerId,
    });
  }

  /**
   * The public queue. The nickname is filtered here and nowhere else: private rooms are people
   * who know each other, public games put a name in front of strangers.
   */
  @SubscribeMessage(ClientEvent.matchmakingJoin)
  async onMatchmakingJoin(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ): Promise<Reply> {
    const { identity } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    const request = matchmakingJoinSchema.safeParse(body);
    if (!request.success) return fail('INVALID_PAYLOAD', 'mm:join expects { nickname, language }');

    const verdict = checkNickname(request.data.nickname);
    if (verdict !== 'ok') return fail('NICKNAME_REJECTED', verdict);

    const language = localeSchema.parse(request.data.language);
    if (request.data.nickname !== identity.nickname) {
      await this.identities.rename(identity.playerId, request.data.nickname);
      identity.nickname = request.data.nickname;
    }

    await socket.join([queueChannel(language), queueChannel(language, identity.playerId)]);
    socket.data.queue = language;
    await this.matchmaking.join(language, {
      playerId: identity.playerId,
      nickname: request.data.nickname,
    });
    return ok({});
  }

  @SubscribeMessage(ClientEvent.matchmakingLeave)
  async onMatchmakingLeave(@ConnectedSocket() socket: GameSocket): Promise<Reply> {
    const { identity, queue } = socket.data;
    if (identity && queue) {
      await this.matchmaking.leave(queue, identity.playerId);
      await socket.leave(queueChannel(queue));
      await socket.leave(queueChannel(queue, identity.playerId));
      socket.data.queue = undefined;
    }
    return { ok: true, data: {} };
  }

  @SubscribeMessage(ClientEvent.roundSkip)
  onRoundSkip(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Reply> {
    return this.inRoom(socket, (playerId) => ({ type: 'skipRound', playerId }), [
      roundSkipSchema,
      body,
    ]);
  }

  @SubscribeMessage(ClientEvent.revealSkip)
  onRevealSkip(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ): Promise<Reply> {
    return this.inRoom(socket, (playerId) => ({ type: 'skipReveal', playerId }), [
      revealSkipSchema,
      body,
    ]);
  }

  /** Common guard of room events: a known device, inside a room, with a valid payload. */
  private async inRoom<S extends z.ZodType>(
    socket: GameSocket,
    toCommand: (playerId: string, body: z.infer<S>) => Command,
    validate?: [schema: S, body: unknown],
  ): Promise<Reply> {
    const { identity, roomCode, role } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    if (!roomCode || role !== 'player') return fail('ROOM_NOT_FOUND', 'Join a room first');

    let payload = undefined as z.infer<S>;
    if (validate) {
      const parsed = validate[0].safeParse(validate[1]);
      if (!parsed.success) return fail('INVALID_PAYLOAD', 'Malformed payload');
      payload = parsed.data;
    }
    return this.rooms.dispatch(roomCode, toCommand(identity.playerId, payload));
  }
}
