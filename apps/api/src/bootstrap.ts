import type { INestApplication } from '@nestjs/common';
import { API_PREFIX } from '@closeup/shared';
import { AppConfig } from './config/app-config.js';
import { SocketAdapter } from './game/gateway/socket.adapter.js';

/** Everything that must be identical between the real server and the end-to-end tests. */
export function configureApp(app: INestApplication): void {
  const { CORS_ORIGINS } = app.get(AppConfig).env;
  app.setGlobalPrefix(API_PREFIX);
  // Dev only: in production the web app and the API share an origin behind Caddy.
  if (CORS_ORIGINS.length) app.enableCors({ origin: CORS_ORIGINS, credentials: true });
  app.useWebSocketAdapter(new SocketAdapter(app, CORS_ORIGINS));
  app.enableShutdownHooks();
}
