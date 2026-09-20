// A stand-in player, to try a game with friends on your own:
//   pnpm bot AB2CD            joins room AB2CD as "Bot"
//   pnpm bot AB2CD Moussa 3   three bots: Moussa, Moussa 2, Moussa 3
//   pnpm bot --queue Awa 2      two bots wait in the public queue (fr) instead of a room
//   pnpm bot AB2CD Awa 3 --host   for a room opened from a big screen, where the first to join
//                                 holds the room: the first bot picks multiple choice and starts
// In multiple-choice rooms it picks options after a few seconds (and is sometimes wrong). In
// typed-answer rooms it cannot know the answer: it sends a wrong guess and lets the clock run.
import { existsSync } from 'node:fs';
import { PROTOCOL_VERSION, SOCKET_NAMESPACE, SOCKET_PATH } from '@closeup/shared';
import { io } from 'socket.io-client';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const api = `http://localhost:${process.env.API_PORT ?? 3001}`;
const args = process.argv.slice(2);
const hosting = args.includes('--host');
const queueing = args.includes('--queue');
const plain = args.filter((arg) => !arg.startsWith('--'));
const [code, name = 'Bot', count = '1'] = queueing ? ['', ...plain] : plain;
if (!code && !queueing) {
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

  const joined = new Promise((resolve) => {
    socket.on('connect', async () => {
      // In the public queue a bot waits to be matched, then joins the room it is given.
      if (queueing) {
        const waiting = await socket.emitWithAck('mm:join', { nickname, language: 'fr' });
        log(waiting.ok ? 'waiting in the public queue' : `refused: ${waiting.error.code}`);
        socket.on('mm:matched', async ({ code: found }) => {
          const ack = await socket.emitWithAck('room:join', {
            code: found,
            nickname,
            role: 'player',
          });
          log(ack.ok ? `matched into ${found}` : `could not join ${found}`);
        });
        return resolve({});
      }
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
      resolve(ack.data);
    });
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
  return { socket, joined, log };
}

const bots = [];
for (let i = 1; i <= Number(count); i++) bots.push(await play(i === 1 ? name : `${name} ${i}`));
const rooms = await Promise.all(bots.map((bot) => bot.joined));
console.log('Bots are in. Ctrl+C to make them leave.');

// Whoever joins an empty room holds it (a room opened from a big screen). The bots connect side
// by side, so it is not always the first of the list.
const holder = rooms.findIndex((room) => room && room.hostId === room.you);
if (hosting && holder !== -1) {
  const { socket, log } = bots[holder];
  const { display } = rooms[holder];
  await socket.emitWithAck('room:settings:update', {
    rounds: 5,
    answerMode: 'mcq',
    scoring: 'decay',
    display,
  });
  const started = await socket.emitWithAck('game:start');
  log(started.ok ? 'I hold the room: game started' : `could not start: ${started.error.code}`);
} else if (hosting) console.log('--host ignored: somebody else holds this room.');
