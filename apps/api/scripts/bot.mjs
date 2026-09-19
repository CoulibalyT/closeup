// A stand-in player, to try a game with friends on your own:
//   pnpm bot AB2CD            joins room AB2CD as "Bot"
//   pnpm bot AB2CD Moussa 3   three bots: Moussa, Moussa 2, Moussa 3
// In multiple-choice rooms it picks options after a few seconds (and is sometimes wrong). In
// typed-answer rooms it cannot know the answer: it sends a wrong guess and lets the clock run.
import { existsSync } from 'node:fs';
import { PROTOCOL_VERSION, SOCKET_NAMESPACE, SOCKET_PATH } from '@closeup/shared';
import { io } from 'socket.io-client';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const api = `http://localhost:${process.env.API_PORT ?? 3001}`;
const [code, name = 'Bot', count = '1'] = process.argv.slice(2);
if (!code) {
  console.error('usage: pnpm bot <ROOM_CODE> [nickname] [how many]');
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.random() * (max - min);

async function play(nickname) {
  const guest = await fetch(`${api}/api/identity/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const cookie = guest.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  const socket = io(api + SOCKET_NAMESPACE, {
    path: SOCKET_PATH,
    auth: { protocolVersion: PROTOCOL_VERSION },
    transports: ['websocket'],
    extraHeaders: { cookie },
  });
  const log = (text) => console.log(`[${nickname}] ${text}`);

  socket.on('connect', async () => {
    const ack = await socket.emitWithAck('room:join', {
      code: code.toUpperCase(),
      nickname,
      role: 'player',
    });
    if (ack.ok) log(`in room ${ack.data.code} (${ack.data.phase})`);
    else {
      log(`could not join: ${ack.error.code}`);
      socket.disconnect();
    }
  });

  socket.on('round:start', async (round) => {
    await wait(between(2_000, 9_000));
    if (!round.options) {
      await socket.emitWithAck('round:guess', { roundId: round.roundId, text: 'aucune idée' });
      return log('typed answers: I cannot know, I pass');
    }
    for (const option of [...round.options].sort(() => Math.random() - 0.5)) {
      const ack = await socket.emitWithAck('round:pick', {
        roundId: round.roundId,
        optionId: option.id,
      });
      if (!ack.ok) return;
      if (ack.data.verdict === 'correct') return log(`found "${option.label}" +${ack.data.points}`);
      log(`wrong: "${option.label}"`);
      await wait(Math.max(0, ack.data.lockedUntil - Date.now()) + between(300, 1_500));
    }
  });

  socket.on('game:end', (end) => {
    const rank = end.ranking.findIndex((p) => p.nickname === nickname) + 1;
    log(`game over, rank ${rank} of ${end.ranking.length}`);
  });
  socket.on('room:player:left', (left) => {
    if (left.reason === 'kicked') log('someone was removed by the host');
  });
  socket.on('disconnect', (reason) => log(`disconnected (${reason})`));
}

for (let i = 1; i <= Number(count); i++) await play(i === 1 ? name : `${name} ${i}`);
console.log('Bots are in. Ctrl+C to make them leave.');
