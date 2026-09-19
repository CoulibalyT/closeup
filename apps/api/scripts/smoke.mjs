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

/** A whole solo game in multiple-choice mode: the only mode a script can win without knowing. */
async function playSolo() {
  const guest = await fetch(`${api}/api/identity/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: 'Smoke' }),
  });
  const cookie = guest.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  check(
    'a guest gets an httpOnly device cookie',
    /HttpOnly/i.test(guest.headers.get('set-cookie')),
  );

  const created = await fetch(`${api}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      mode: 'solo',
      language: 'fr',
      settings: { rounds: 1, answerMode: 'mcq' },
    }),
  });
  const { code } = await created.json();
  check('a solo room is created', created.status === 201 && Boolean(code), code);

  const socket = io(api + SOCKET_NAMESPACE, {
    path: SOCKET_PATH,
    auth: { protocolVersion: PROTOCOL_VERSION },
    transports: ['websocket'],
    extraHeaders: { cookie },
  });
  const once = (event) => new Promise((resolve) => socket.once(event, resolve));
  await once('connect');

  const joined = await socket.emitWithAck('room:join', { code, nickname: 'Smoke', role: 'player' });
  check('the player joins and gets a lobby snapshot', joined.data?.phase === 'lobby');

  const started = once('round:start');
  await socket.emitWithAck('game:start');
  const round = await started;
  const secretKeys = /"(answers?|aliases|cardId|zoomPointId|cropId|correctOptionId)"/;
  const leaked = secretKeys.test(JSON.stringify(round));
  check('round:start carries four options and no secret', round.options?.length === 4 && !leaked);

  const crop = await fetch(api + round.crop.url);
  check('the crop is served as WebP', crop.ok && crop.headers.get('content-type') === 'image/webp');
  const forged = await fetch(api + round.crop.url.slice(0, -4) + 'AAAA');
  check('a forged media URL is a plain 404', forged.status === 404);

  const ended = once('round:end');
  let points = 0;
  for (const option of round.options) {
    const ack = await socket.emitWithAck('round:pick', {
      roundId: round.roundId,
      optionId: option.id,
    });
    if (ack.data?.verdict === 'correct') {
      points = ack.data.points;
      break;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, ack.data.lockedUntil - Date.now()) + 50));
  }
  check('picking through the options eventually scores', points > 0, `${points} points`);

  const reveal = await ended;
  const image = await fetch(api + reveal.reveal.imageUrl);
  check(
    'the reveal names the answer, credits the image and serves it',
    Boolean(reveal.reveal.answer) && Boolean(reveal.reveal.credit.licence) && image.ok,
    `${reveal.reveal.answer}, ${reveal.reveal.credit.licence}`,
  );

  const over = once('game:end');
  await socket.emitWithAck('reveal:skip', { roundId: round.roundId });
  const end = await over;
  check('the game ends with a personal best', end.personalBest?.score >= points);
  socket.disconnect();
}

async function guest(nickname) {
  const response = await fetch(`${api}/api/identity/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookie, playerId: (await response.json()).playerId };
}

function player(cookie) {
  const socket = io(api + SOCKET_NAMESPACE, {
    path: SOCKET_PATH,
    auth: { protocolVersion: PROTOCOL_VERSION },
    transports: ['websocket'],
    extraHeaders: { cookie },
  });
  const once = (event, ms = 15_000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  // Captured at once: a socket created early may connect before anyone awaits it.
  const ready = new Promise((resolve) => socket.once('connect', resolve));
  return { socket, once, ready };
}

/** Picks options until the right one, waiting out the lock after a wrong pick. */
async function answer(socket, round) {
  for (const option of round.options) {
    const ack = await socket.emitWithAck('round:pick', {
      roundId: round.roundId,
      optionId: option.id,
    });
    if (ack.data?.verdict === 'correct') return ack.data.points;
    await new Promise((r) => setTimeout(r, Math.max(0, ack.data.lockedUntil - Date.now()) + 50));
  }
  return 0;
}

/** Two players in a private room: lobby, settings, a round, a dropped connection, play again. */
async function playParty() {
  const awa = await guest('Awa');
  const moussa = await guest('Moussa');

  const created = await fetch(`${api}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: awa.cookie },
    body: JSON.stringify({
      mode: 'private',
      language: 'fr',
      nickname: 'Awa',
      settings: { rounds: 5, answerMode: 'text' },
    }),
  });
  const { code } = await created.json();
  const summary = await getJson(`${api}/api/rooms/${code}`);
  check(
    'a private room shows a summary to whoever has the code',
    summary.body.hostNickname === 'Awa',
  );

  const host = player(awa.cookie);
  await host.once('connect');
  await host.socket.emitWithAck('room:join', { code, nickname: 'Awa', role: 'player' });

  const alone = await host.socket.emitWithAck('game:start');
  check('a private game does not start alone', alone.error?.code === 'NOT_ENOUGH_PLAYERS');

  const arrival = host.once('room:player:joined');
  const friend = player(moussa.cookie);
  await friend.once('connect');
  const lobby = await friend.socket.emitWithAck('room:join', {
    code,
    nickname: 'Moussa',
    role: 'player',
  });
  check('a friend joins the lobby', lobby.data?.players.length === 2);
  check('the host sees them arrive', (await arrival).player.nickname === 'Moussa');

  const notHost = await friend.socket.emitWithAck('room:settings:update', {
    rounds: 1,
    answerMode: 'mcq',
  });
  const changed = friend.once('room:settings');
  await host.socket.emitWithAck('room:settings:update', { rounds: 1, answerMode: 'mcq' });
  check(
    'only the host changes the settings, and everyone is told',
    notHost.error?.code === 'NOT_HOST' && (await changed).answerMode === 'mcq',
  );

  const rounds = [host.once('round:start'), friend.once('round:start')];
  await host.socket.emitWithAck('game:start');
  const [round, sameRound] = await Promise.all(rounds);
  check('both players get the same round at the same time', round.startsAt === sameRound.startsAt);

  // The friend drops, comes back on a new socket, and finds the round where they left it.
  const offline = host.once('room:player:updated');
  friend.socket.disconnect();
  check('the host sees the friend go offline', (await offline).player.connected === false);
  const back = player(moussa.cookie);
  await back.once('connect');
  const resumed = await back.socket.emitWithAck('room:join', {
    code,
    nickname: 'Moussa',
    role: 'player',
  });
  check(
    'the friend reconnects into the same round',
    resumed.data?.phase === 'playing' && resumed.data.round?.roundId === round.roundId,
  );

  // Armed before the answers, which can take a while (wrong picks lock for 3 s each).
  const ended = host.once('round:end', 45_000);
  const hostPoints = await answer(host.socket, round);
  const stillOpen = await Promise.race([
    ended.then(() => false),
    new Promise((r) => setTimeout(() => r(true), 400)),
  ]);
  check(
    'the first correct answer does not end the round for the other',
    stillOpen && hostPoints > 0,
  );
  const startedAt = Date.now();
  await answer(back.socket, round);
  const reveal = await ended;
  check(
    'the round ends early once everyone has found',
    Date.now() - startedAt < 12_000 && reveal.ranking.length === 2,
    `${reveal.ranking.map((p) => `${p.nickname} ${p.score}`).join(', ')}`,
  );

  const over = back.once('game:end');
  await host.socket.emitWithAck('reveal:skip', { roundId: round.roundId });
  check('the game ends with a ranking for everyone', (await over).ranking.length === 2);

  const again = back.once('room:lobby');
  await host.socket.emitWithAck('game:playAgain');
  check(
    'the host brings everyone back to the lobby',
    (await again).players.every((p) => p.score === 0),
  );

  host.socket.disconnect();
  back.socket.disconnect();
}

/** Three players: the fastest earns a bonus that only they hear about, then plays it. */
async function playBonuses() {
  const guests = [await guest('Awa'), await guest('Moussa'), await guest('Ines')];
  const created = await fetch(`${api}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: guests[0].cookie },
    body: JSON.stringify({
      mode: 'private',
      language: 'fr',
      nickname: 'Awa',
      settings: { rounds: 2, answerMode: 'mcq', scoring: 'fixed' },
    }),
  });
  const { code } = await created.json();
  const [host, fast, third] = guests.map((g) => player(g.cookie));
  for (const [i, p] of [host, fast, third].entries()) {
    await p.ready;
    const nickname = ['Awa', 'Moussa', 'Ines'][i];
    await p.socket.emitWithAck('room:join', { code, nickname, role: 'player' });
  }

  let overheard = false;
  host.socket.on('bonus:granted', () => (overheard = true));
  const granted = fast.once('bonus:granted');
  const counted = new Promise((resolve) =>
    host.socket.on('room:player:updated', ({ player: p }) => p.bonusCount === 1 && resolve(p)),
  );
  const firstRounds = [host, fast, third].map((p) => p.once('round:start'));
  await host.socket.emitWithAck('game:start');
  const [round] = await Promise.all(firstRounds);

  const points = await answer(fast.socket, round);
  const { item } = await granted;
  check(
    'fixed points pay the first finder the same whatever the clock',
    points >= 700,
    `${points}`,
  );
  check('the fastest of three earns a bonus', Boolean(item?.type), item?.type);
  check('the others only see the count go up', (await counted).nickname === 'Moussa' && !overheard);

  // Armed before the answers, which can take a while (wrong picks lock for 3 s each).
  const ended = host.once('round:end', 45_000);
  await answer(host.socket, round);
  await answer(third.socket, round);
  await ended;
  const secondRounds = [host, fast].map((p) => p.once('round:start', 20_000));
  await host.socket.emitWithAck('reveal:skip', { roundId: round.roundId });
  const [next] = await Promise.all(secondRounds);

  const self = ['zoomOut', 'secondZone', 'initials', 'category', 'removeTwo', 'shield'];
  const seen =
    item.type === 'zoomOut'
      ? fast.once('round:level', 4_000)
      : ['blur', 'flip', 'freeze'].includes(item.type)
        ? host.once('round:effect', 4_000)
        : item.type === 'stealPoints'
          ? host.once('round:steal', 4_000)
          : Promise.resolve(null);
  const ack = await fast.socket.emitWithAck('bonus:use', {
    roundId: next.roundId,
    itemId: item.id,
    targetPlayerId: self.includes(item.type) ? undefined : guests[0].playerId,
  });
  // Nobody holds a bonus yet, so "steal a bonus" is rightly refused and kept.
  const nothingToSteal = item.type === 'stealBonus' && ack.error?.code === 'TARGET_INVALID';
  check(
    `playing "${item.type}" works end to end`,
    nothingToSteal || (ack.ok && ack.data.inventory.length === 0 && (await seen) !== undefined),
    nothingToSteal ? 'refused: nothing to steal' : JSON.stringify(ack.data?.hints ?? ack.error),
  );
  for (const p of [host, fast, third]) p.socket.disconnect();
}

/**
 * Big screen + phones: the room is opened from the shared screen, the first phone to join holds
 * it, the image only goes to the screen and the game will not start without one.
 */
async function playBigScreen() {
  const tv = await guest();
  const created = await fetch(`${api}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: tv.cookie },
    body: JSON.stringify({
      mode: 'private',
      language: 'fr',
      openedBy: 'screen',
      settings: { rounds: 5, answerMode: 'mcq' },
    }),
  });
  const { code } = await created.json();
  const summary = await getJson(`${api}/api/rooms/${code}`);
  check(
    'a room opened from a screen is in big-screen mode and has no host yet',
    summary.body.display === 'bigscreen' && summary.body.hostNickname === '',
    code,
  );

  const [awa, moussa] = await Promise.all([guest('Awa'), guest('Moussa')]);
  const host = player(awa.cookie);
  const friend = player(moussa.cookie);
  const screen = player(tv.cookie);
  await Promise.all([host.ready, friend.ready, screen.ready]);

  const first = await host.socket.emitWithAck('room:join', {
    code,
    nickname: 'Awa',
    role: 'player',
  });
  check(
    'the first phone to join holds the room',
    first.data?.hostId === awa.playerId && first.data.display === 'bigscreen',
  );
  await friend.socket.emitWithAck('room:join', { code, nickname: 'Moussa', role: 'player' });
  await host.socket.emitWithAck('room:settings:update', {
    rounds: 1,
    answerMode: 'mcq',
    display: 'bigscreen',
  });

  const blind = await host.socket.emitWithAck('game:start');
  check('a big-screen game does not start without a screen', blind.error?.code === 'NO_SCREEN');

  const counted = host.once('room:screens');
  const watching = await screen.socket.emitWithAck('room:join', { code, role: 'screen' });
  check(
    'the shared screen joins as nobody and sees the lobby',
    watching.data?.role === 'screen' &&
      watching.data.you === null &&
      watching.data.players.length === 2 &&
      watching.data.inventory.length === 0,
  );
  check('the phones learn that a screen is there', (await counted).count === 1);

  const refused = await screen.socket.emitWithAck('game:start');
  check('a screen cannot send game commands', refused.ok === false);

  const onScreen = screen.once('round:start', 20_000);
  const onPhones = [host, friend].map((p) => p.once('round:start', 20_000));
  const started = await host.socket.emitWithAck('game:start');
  check(
    'the host starts from their phone',
    started.ok === true,
    JSON.stringify(started.error ?? ''),
  );

  const shown = await onScreen;
  const rounds = await Promise.all(onPhones);
  check('the screen gets the image', Boolean(shown.crop?.url));
  check(
    'the phones get the same round without the image',
    rounds.every(
      (r) => r.roundId === shown.roundId && r.crop === undefined && r.options.length === 4,
    ),
  );
  const crop = await fetch(api + shown.crop.url);
  check(
    'the screen can load its crop',
    crop.ok && crop.headers.get('content-type') === 'image/webp',
  );

  const revealed = [screen, host, friend].map((p) => p.once('round:end', 45_000));
  const over = screen.once('game:end', 60_000);
  const answeredOnScreen = screen.once('round:player:answered', 45_000);
  const points = await Promise.all([
    answer(host.socket, rounds[0]),
    answer(friend.socket, rounds[1]),
  ]);
  check(
    'both phones score from their controller',
    points.every((p) => p > 0),
    points.join(' / '),
  );
  check('the screen sees who found', Boolean((await answeredOnScreen).playerId));

  const reveals = await Promise.all(revealed);
  check(
    'the reveal reaches the screen and the phones alike',
    reveals.every((r) => r.reveal.answer === reveals[0].reveal.answer && r.ranking.length === 2),
  );
  await host.socket.emitWithAck('reveal:skip', { roundId: shown.roundId });
  check('the final ranking is shown on the screen', (await over).ranking.length === 2);

  const gone = host.once('room:screens');
  screen.socket.disconnect();
  check('the phones learn that the screen went away', (await gone).count === 0);
  for (const p of [host, friend]) p.socket.disconnect();
}

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

  await playSolo();
  await playParty();
  await playBonuses();
  await playBigScreen();
} catch (error) {
  check('stack reachable', false, error.message);
}

process.exit(failures ? 1 : 0);
