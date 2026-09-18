/**
 * Bumped on every breaking change of the socket contract. The client sends it in the handshake;
 * a stale cached PWA gets `PROTOCOL_MISMATCH` and reloads instead of failing on unknown payloads.
 */
export const PROTOCOL_VERSION = 1;

export const SOCKET_NAMESPACE = '/game';

/** Under `/api` so that a single reverse-proxy rule covers REST and realtime. */
export const SOCKET_PATH = '/api/socket.io';

export const API_PREFIX = 'api';
