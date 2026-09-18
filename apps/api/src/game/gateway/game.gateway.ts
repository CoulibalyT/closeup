import {
  ConnectedSocket,
  MessageBody,
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
  type RoomStateView,
  roundGuessSchema,
  roundPickSchema,
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
export class GameGateway implements OnGatewayInit {
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

    this.rooms.onMessage((code, message) => {
      namespace.to(channel(code)).emit(message.event, message.payload);
    });
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

    const snapshot = this.rooms.snapshot(join.data.code, identity.playerId);
    if (!snapshot) return fail('ROOM_NOT_FOUND', 'This room does not exist, or you are not in it');

    if (socket.data.roomCode) await socket.leave(channel(socket.data.roomCode));
    socket.data.roomCode = join.data.code;
    await socket.join(channel(join.data.code));
    return ok(snapshot);
  }

  @SubscribeMessage(ClientEvent.gameStart)
  onGameStart(@ConnectedSocket() socket: GameSocket): Promise<Reply> {
    return this.inRoom(socket, (playerId) => ({ type: 'start', playerId }));
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
