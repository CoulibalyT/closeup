import { PROTOCOL_VERSION, SOCKET_NAMESPACE, SOCKET_PATH } from '@closeup/shared';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | undefined;

/** One connection per tab, created on first use. Client only. */
export function useGameSocket(): Socket {
  if (import.meta.server) throw new Error('useGameSocket() is client only');
  if (!socket) {
    const { apiBase } = useRuntimeConfig().public;
    socket = io(apiBase + SOCKET_NAMESPACE, {
      path: SOCKET_PATH,
      auth: { protocolVersion: PROTOCOL_VERSION },
      withCredentials: true,
    });
  }
  return socket;
}
