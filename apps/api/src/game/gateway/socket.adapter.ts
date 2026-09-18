import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { SOCKET_PATH } from '@closeup/shared';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.io server options are server-wide, so they are set here once instead of on a gateway
 * decorator (where the first gateway to register would silently win).
 */
export class SocketAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      path: SOCKET_PATH,
      cors: this.corsOrigins.length ? { origin: this.corsOrigins, credentials: true } : undefined,
    } as ServerOptions);
  }
}
