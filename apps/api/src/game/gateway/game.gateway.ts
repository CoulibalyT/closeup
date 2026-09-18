import {
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
  SOCKET_NAMESPACE,
  type TimePong,
  timePingSchema,
} from '@closeup/shared';
import type { Namespace } from 'socket.io';

@WebSocketGateway({ namespace: SOCKET_NAMESPACE })
export class GameGateway implements OnGatewayInit {
  afterInit(namespace: Namespace): void {
    // Refused in a middleware so a stale client never counts as connected: it gets a
    // `connect_error` carrying the code, and reloads.
    namespace.use((socket, next) => {
      const auth = handshakeAuthSchema.safeParse(socket.handshake.auth);
      if (auth.success && auth.data.protocolVersion === PROTOCOL_VERSION) return next();
      const error = new Error('PROTOCOL_MISMATCH') as Error & { data?: unknown };
      error.data = { code: 'PROTOCOL_MISMATCH', expected: PROTOCOL_VERSION };
      next(error);
    });
  }

  /** Returned value is the ack. `t1` is the only clock the clients agree on. */
  @SubscribeMessage(ClientEvent.timePing)
  onTimePing(@MessageBody() body: unknown): Ack<TimePong> {
    const ping = timePingSchema.safeParse(body);
    if (!ping.success) return fail('INVALID_PAYLOAD', 'time:ping expects { t0: number }');
    return ok({ t0: ping.data.t0, t1: Date.now() });
  }
}
