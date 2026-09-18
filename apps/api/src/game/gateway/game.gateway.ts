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
  ClientEvent,
  fail,
  handshakeAuthSchema,
  ok,
  PROTOCOL_VERSION,
  revealSkipSchema,
  roomJoinSchema,
  roomKickSchema,
  type RoomPlayerLeft,
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
import { RoomService } from '../rooms/room.service.js';

interface SocketData {
  identity?: Identity;
  roomCode?: string;
}
type GameSocket = Socket<never, never, never, SocketData>;

const channel = (code: string) => `room:${code}`;

@WebSocketGateway({ namespace: SOCKET_NAMESPACE })
export class GameGateway implements OnGatewayInit, OnGatewayDisconnect {
  private namespace!: Namespace;

  constructor(
    private readonly rooms: RoomService,
    private readonly identities: IdentityService,
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
    this.rooms.onMessage((code, message) => {
      namespace.to(channel(code)).emit(message.event, message.payload);
      // Whoever left or was removed hears it (above), then stops receiving the room's events.
      if (message.event === ServerEvent.roomPlayerLeft) {
        const { playerId, removed } = message.payload as RoomPlayerLeft;
        if (removed) void this.detach(code, playerId);
      }
    });
  }

  private async socketsOf(code: string, playerId: string) {
    const sockets = await this.namespace.in(channel(code)).fetchSockets();
    return sockets.filter((s) => (s.data as SocketData).identity?.playerId === playerId);
  }

  private async detach(code: string, playerId: string): Promise<void> {
    for (const socket of await this.socketsOf(code, playerId)) {
      socket.leave(channel(code));
      (socket.data as SocketData).roomCode = undefined;
    }
  }

  /** A player is offline when their *last* socket in the room closes (think of two tabs). */
  async handleDisconnect(socket: GameSocket): Promise<void> {
    const { identity, roomCode } = socket.data;
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
    const { identity } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    const join = roomJoinSchema.safeParse(body);
    if (!join.success) return fail('INVALID_PAYLOAD', 'room:join expects { code, nickname, role }');

    const { code, nickname } = join.data;

    // The nickname typed here becomes the player's, so it is prefilled next time.
    if (nickname !== identity.nickname) {
      await this.identities.rename(identity.playerId, nickname);
      identity.nickname = nickname;
    }

    // Join the channel first: the reply to `join` is broadcast and they must hear it too.
    if (socket.data.roomCode && socket.data.roomCode !== code) {
      await socket.leave(channel(socket.data.roomCode));
    }
    await socket.join(channel(code));
    const reply = await this.rooms.dispatch(code, {
      type: 'join',
      playerId: identity.playerId,
      nickname,
    });
    const snapshot = reply.ok ? this.rooms.snapshot(code, identity.playerId) : null;
    if (!reply.ok || !snapshot) {
      await socket.leave(channel(code));
      return reply.ok ? fail('ROOM_NOT_FOUND', 'This room does not exist') : reply;
    }
    socket.data.roomCode = code;
    return ok(snapshot);
  }

  @SubscribeMessage(ClientEvent.roomLeave)
  async onRoomLeave(@ConnectedSocket() socket: GameSocket): Promise<Reply> {
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
    const { identity, roomCode } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    if (!roomCode) return fail('ROOM_NOT_FOUND', 'Join a room first');
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
    const { identity, roomCode } = socket.data;
    if (!identity) return fail('UNAUTHENTICATED', 'Unknown device');
    if (!roomCode) return fail('ROOM_NOT_FOUND', 'Join a room first');

    let payload = undefined as z.infer<S>;
    if (validate) {
      const parsed = validate[0].safeParse(validate[1]);
      if (!parsed.success) return fail('INVALID_PAYLOAD', 'Malformed payload');
      payload = parsed.data;
    }
    return this.rooms.dispatch(roomCode, toCommand(identity.playerId, payload));
  }
}
