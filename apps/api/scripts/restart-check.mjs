// Does a game survive a restart of the API? Starts a solo round, restarts the `api` container
// mid-round, reconnects, and expects the room to have caught up with the clock on its own.
//   node scripts/restart-check.mjs        (stack up, run from apps/api; takes about a minute)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PROTOCOL_VERSION, SOCKET_NAMESPACE, SOCKET_PATH } from '@closeup/shared';
import { io } from 'socket.io-client';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const api = `http://localhost:${process.env.API_PORT ?? 3001}`;
const json = { 'content-type': 'application/json' };

const within = (ms, label, promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);

function connect(cookie) {
  const socket = io(api + SOCKET_NAMESPACE, {
    path: SOCKET_PATH,
    auth: { protocolVersion: PROTOCOL_VERSION },
    transports: ['websocket'],
    extraHeaders: { cookie },
  });
  return within(
    10_000,
    'connect',
    new Promise((resolve) => socket.once('connect', () => resolve(socket))),
  );
}

const join = async (socket, code) => {
  const ack = await within(
    5_000,
    'room:join',
    socket.emitWithAck('room:join', { code, nickname: 'Restart', role: 'player' }),
  );
  if (!ack.ok) throw new Error(`room:join refused: ${ack.error.code}`);
  return ack.data;
};

try {
  const guest = await fetch(`${api}/api/identity/guest`, {
    method: 'POST',
    headers: json,
    body: '{}',
  });
  const cookie = guest.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const room = await fetch(`${api}/api/rooms`, {
    method: 'POST',
    headers: { ...json, cookie },
    body: JSON.stringify({
      mode: 'solo',
      language: 'fr',
      settings: { rounds: 2, answerMode: 'text' },
    }),
  });
  const { code } = await room.json();

  const before = await connect(cookie);
  await join(before, code);
  const started = new Promise((resolve) => before.once('round:start', resolve));
  await before.emitWithAck('game:start');
  const round = await within(10_000, 'round:start', started);
  console.log(`room ${code}: round ${round.roundId} is live, restarting the api container...`);
  before.disconnect();

  const compose = (...args) =>
    execFileSync('docker', ['compose', ...args], { cwd: '../..', stdio: 'ignore' });
  compose('restart', 'api');
  compose('up', '-d', '--wait', '--wait-timeout', '240', 'api');

  const after = await connect(cookie);
  const snapshot = await join(after, code);
  const sameRound = (snapshot.round ?? snapshot.reveal)?.roundId === round.roundId;
  const late = Date.now() > round.endsAt;
  const expected = late ? 'reveal' : 'playing';
  console.log(
    `after the restart: phase=${snapshot.phase} (expected ${expected}), same round: ${sameRound}`,
  );
  after.disconnect();
  process.exit(snapshot.phase === expected && sameRound ? 0 : 1);
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
