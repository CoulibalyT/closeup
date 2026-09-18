import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

/** Starts the app on a free port and returns its base URL. */
export async function listen(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
