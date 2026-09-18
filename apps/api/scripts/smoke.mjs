// End-to-end smoke test of a running stack (`docker compose up`): REST, web, PWA manifest and
// the realtime channel. Run with `pnpm smoke`. Exits 1 on the first broken expectation.
import { existsSync } from 'node:fs';
import {
  estimateClockOffset,
  PROTOCOL_VERSION,
  sampleFromPing,
  SOCKET_NAMESPACE,
  SOCKET_PATH,
  TIME_SYNC,
} from '@closeup/shared';
import { io } from 'socket.io-client';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const api = `http://localhost:${process.env.API_PORT ?? 3001}`;
const web = `http://localhost:${process.env.WEB_PORT ?? 3000}`;
let failures = 0;

function check(label, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function getJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

const connect = (protocolVersion) =>
  new Promise((resolve) => {
    const socket = io(api + SOCKET_NAMESPACE, {
      path: SOCKET_PATH,
      auth: { protocolVersion },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.once('connect', () => resolve({ socket }));
    socket.once('connect_error', (error) => resolve({ socket, error }));
  });

try {
  const live = await getJson(`${api}/api/health`);
  check('API is alive', live.status === 200);

  const ready = await getJson(`${api}/api/health/ready`);
  const { postgres, redis } = ready.body.details ?? {};
  check('Postgres is up', postgres?.status === 'up');
  check('Redis is up', redis?.status === 'up');

  const worker = await getJson(`${api}/api/health/worker`);
  check('worker consumes the queue', worker.body.status === 'up', `${worker.body.latencyMs} ms`);

  // The web app is client rendered: language detection happens in the browser and cannot be
  // checked from here. This only proves the shell is served on both locale routes.
  for (const path of ['/', '/en']) {
    const page = await fetch(web + path);
    check(`web serves the app shell on ${path}`, page.ok && /id="__nuxt"/.test(await page.text()));
  }

  const manifest = await getJson(`${web}/manifest.webmanifest`);
  check('manifest carries the display name', Boolean(manifest.body.name), manifest.body.name);

  const { socket, error } = await connect(PROTOCOL_VERSION);
  check('socket connects over WebSocket', !error, error?.message);
  if (!error) {
    const samples = [];
    for (let i = 0; i < TIME_SYNC.samples; i++) {
      const t0 = Date.now();
      const ack = await socket.timeout(2_000).emitWithAck('time:ping', { t0 });
      if (ack.ok) samples.push(sampleFromPing({ t0, t1: ack.data.t1, t2: Date.now() }));
    }
    const clock = estimateClockOffset(samples);
    check(
      'time:ping measures a clock offset',
      samples.length === TIME_SYNC.samples,
      `offset ${clock?.offsetMs} ms, round trip ${clock?.rttMs} ms`,
    );
  }
  socket.disconnect();

  const stale = await connect(PROTOCOL_VERSION - 1);
  check('a stale client is refused', stale.error?.message === 'PROTOCOL_MISMATCH');
  stale.socket.disconnect();
} catch (error) {
  check('stack reachable', false, error.message);
}

process.exit(failures ? 1 : 0);
