import {
  BONUS,
  type ErrorCode,
  FREE_TEXT,
  type Locale,
  MULTIPLE_CHOICE,
  ROOM,
  ROUND,
  roundValue,
  SELF_BONUSES,
  ZOOM,
} from '@closeup/shared';
import { attack, grant, grantCatchUp, isFrozen, selfBonus } from './bonuses.js';
import { matchAnswer } from './matching.js';
import type {
  Command,
  Context,
  Effect,
  EngineEvent,
  PlayerState,
  Reduced,
  Reply,
  RoomMode,
  RoomSettings,
  RoomState,
  RoundState,
} from './types.js';

/**
 * The whole game as a pure function: `(state, command, { now, newId }) → state, effects, reply`.
 * No timers, sockets or database here. The room layer owns one timer per room and dispatches
 * `tick` when `wakeAt` is reached; every command first catches up with the clock, so the result
 * never depends on when that timer actually fired.
 */

export function createRoom(init: {
  code: string;
  mode: RoomMode;
  /** Without a host the room was opened from a shared screen: the first to join becomes host. */
  host?: { id: string; nickname: string };
  language: Locale;
  settings: RoomSettings;
  lexicon: string[];
  /** Public rooms: how many the queue matched, and how long to wait for them. */
  expectedPlayers?: number;
  waitForPlayersMs?: number;
  now?: number;
}): RoomState {
  return {
    code: init.code,
    mode: init.mode,
    hostId: init.host?.id ?? null,
    ...(init.host ? {} : { openedByScreen: true as const, emptySince: init.now ?? 0 }),
    language: init.language,
    settings: init.settings,
    phase: 'lobby',
    players: init.host
      ? { [init.host.id]: newPlayer(init.host.id, init.host.nickname, init.now ?? 0) }
      : {},
    roundIndex: 0,
    totalRounds: init.settings.rounds,
    lexicon: init.lexicon,
    expectedPlayers: init.expectedPlayers,
    autoStartAt:
      init.expectedPlayers === undefined
        ? undefined
        : (init.now ?? 0) + (init.waitForPlayersMs ?? 0),
    awaitingCard: false,
    wakeAt: null,
  };
}

const newPlayer = (id: string, nickname: string, joinedAt: number): PlayerState => ({
  id,
  nickname,
  score: 0,
  streak: 0,
  bestStreak: 0,
  correctCount: 0,
  connected: true,
  joinedAt,
});

const hostOf = (state: RoomState): PlayerState | undefined =>
  state.hostId === null ? undefined : state.players[state.hostId];

const OK: Reply = { ok: true, data: {} };
const refuse = (code: ErrorCode, message: string): Reply => ({
  ok: false,
  error: { code, message },
});

export function reduce(previous: RoomState, command: Command, ctx: Context): Reduced {
  const state = structuredClone(previous);
  const effects: Effect[] = [];
  const emit = (event: EngineEvent) => effects.push({ type: 'emit', event });

  advance(state, ctx, effects);
  const reply = handle(state, command, ctx, effects, emit);
  // After the command, not before: the player who completes a public room is the one joining.
  autoStart(state, ctx.now, effects);
  state.wakeAt = nextWake(state);
  // A round that ended during this call, whichever way: the last of the ranking gets a hand.
  if (previous.phase !== 'reveal' && state.phase === 'reveal') grantCatchUp(state, ctx, effects);
  return { state, effects, reply };
}

/** Applies every transition that is due at `ctx.now`, in order. */
function advance(state: RoomState, ctx: Context, effects: Effect[]): void {
  const emit = (event: EngineEvent) => effects.push({ type: 'emit', event });

  expireGrace(state, ctx.now, effects, emit);
  expireEmptyRoom(state, ctx.now, effects);
  for (let guard = 0; guard < 16; guard++) {
    const round = state.round;

    if (state.phase === 'countdown' && round && ctx.now >= round.startsAt) {
      state.phase = 'playing';
      emit({ type: 'roundStart' });
    } else if (state.phase === 'playing' && round) {
      const nextLevelAt = ZOOM.autoLevelAtMs[round.level + 1];
      const endAt = Math.min(round.endsAt, round.endsEarlyAt ?? Infinity);
      const levelDue =
        nextLevelAt !== undefined && ctx.now >= round.startsAt + nextLevelAt
          ? round.startsAt + nextLevelAt
          : Infinity;

      if (levelDue < endAt) {
        round.level += 1;
        emit({ type: 'roundLevel', level: round.level });
        // Whoever zoomed out with a bonus stays that many levels ahead of the room.
        for (const [playerId, mine] of Object.entries(round.perPlayer)) {
          const ahead = mine.bonusLevels ?? 0;
          if (ahead > 0 && round.level - 1 + ahead < ZOOM.maxLevel) {
            const level = Math.min(ZOOM.maxLevel, round.level + ahead);
            effects.push({
              type: 'emit',
              event: { type: 'personalLevel', playerId, level },
              to: playerId,
            });
          }
        }
      } else if (ctx.now >= endAt) {
        endRound(state, ctx.now, emit);
      } else break;
    } else if (
      state.phase === 'reveal' &&
      typeof state.revealUntil === 'number' &&
      ctx.now >= state.revealUntil
    ) {
      afterReveal(state, effects, emit);
    } else break;
  }
  state.wakeAt = nextWake(state);
}

function nextWake(state: RoomState): number | null {
  const game = nextGameWake(state);
  const grace = Object.values(state.players)
    .filter((p) => p.disconnectedAt !== undefined && !p.gone)
    .map((p) => p.disconnectedAt! + ROOM.reconnectGraceMs);
  const empty = state.emptySince === undefined ? Infinity : state.emptySince + ROOM.emptyRoomTtlMs;
  const next = Math.min(game ?? Infinity, empty, state.autoStartAt ?? Infinity, ...grace);
  return Number.isFinite(next) ? next : null;
}

function nextGameWake(state: RoomState): number | null {
  const round = state.round;
  if (state.phase === 'countdown' && round) return round.startsAt;
  if (state.phase === 'playing' && round) {
    const nextLevelAt = ZOOM.autoLevelAtMs[round.level + 1];
    return Math.min(
      round.endsAt,
      round.endsEarlyAt ?? Infinity,
      nextLevelAt === undefined ? Infinity : round.startsAt + nextLevelAt,
    );
  }
  if (state.phase === 'reveal') return state.revealUntil ?? null;
  return null;
}

function handle(
  state: RoomState,
  command: Command,
  ctx: Context,
  effects: Effect[],
  emit: (event: EngineEvent) => void,
): Reply {
  const reply = dispatch(state, command, ctx, effects, emit);
  state.wakeAt = nextWake(state);
  return reply;
}

function dispatch(
  state: RoomState,
  command: Command,
  ctx: Context,
  effects: Effect[],
  emit: (event: EngineEvent) => void,
): Reply {
  switch (command.type) {
    case 'tick':
      return OK;

    case 'join': {
      const known = state.players[command.playerId];
      if (known) {
        // Coming back: same seat, same score. Only the connection flag changes.
        known.connected = true;
        known.disconnectedAt = undefined;
        known.gone = undefined;
        if (!hostOf(state)?.connected) migrateHost(state, emit);
        emit({ type: 'playerUpdated', playerId: known.id });
        return OK;
      }
      if (state.phase === 'ended') return refuse('BAD_PHASE', 'This game is over');
      if (state.mode === 'solo') return refuse('ROOM_FULL', 'Solo training is for one player');
      // Strangers do not walk into a game that started: the queue gives them their own. Coming
      // back after a lost connection is the branch above, and still works. `awaitingCard` counts
      // as started: the phase is still 'lobby' while the first card is being fetched.
      if (state.mode === 'public' && (state.phase !== 'lobby' || state.awaitingCard)) {
        return refuse('BAD_PHASE', 'This game has already started');
      }
      if (Object.keys(state.players).length >= ROOM.maxPlayers) {
        return refuse('ROOM_FULL', 'This room is full');
      }
      // Mid-game newcomers sit out the current round: they are not in its `perPlayer`.
      state.players[command.playerId] = newPlayer(
        command.playerId,
        uniqueNickname(state, command.nickname),
        ctx.now,
      );
      state.emptySince = undefined;
      emit({ type: 'playerJoined', playerId: command.playerId });
      // Nobody holds the room (it was opened from a shared screen, or its host is gone for good).
      if (!hostOf(state)) migrateHost(state, emit);
      return OK;
    }

    case 'leave': {
      if (!state.players[command.playerId]) return OK;
      removePlayer(state, command.playerId, 'left', ctx.now, effects, emit);
      return OK;
    }

    case 'disconnect': {
      const player = state.players[command.playerId];
      if (!player?.connected) return OK;
      player.connected = false;
      player.disconnectedAt = ctx.now;
      emit({ type: 'playerUpdated', playerId: player.id });
      if (state.phase === 'playing' && state.round)
        checkEarlyEnd(state, state.round, ctx.now, emit);
      return OK;
    }

    case 'kick': {
      if (command.playerId !== state.hostId) return refuse('NOT_HOST', 'Only the host can do that');
      if (state.phase !== 'lobby') return refuse('BAD_PHASE', 'Only before the game starts');
      if (command.targetId === state.hostId || !state.players[command.targetId]) {
        return refuse('TARGET_INVALID', 'Pick another player');
      }
      removePlayer(state, command.targetId, 'kicked', ctx.now, effects, emit);
      return OK;
    }

    case 'updateSettings': {
      if (command.playerId !== state.hostId) return refuse('NOT_HOST', 'Only the host can do that');
      if (state.phase !== 'lobby') return refuse('BAD_PHASE', 'Only before the game starts');
      state.settings = command.settings;
      state.totalRounds = command.settings.rounds;
      emit({ type: 'settingsChanged' });
      return OK;
    }

    case 'playAgain': {
      if (command.playerId !== state.hostId) return refuse('NOT_HOST', 'Only the host can do that');
      if (state.phase !== 'ended') return refuse('BAD_PHASE', 'The game is not over');
      for (const player of Object.values(state.players)) {
        if (player.gone) delete state.players[player.id];
        else {
          Object.assign(player, { score: 0, streak: 0, bestStreak: 0, correctCount: 0 });
          Object.assign(player, { roundsSeated: 0, answerMsTotal: 0 });
        }
      }
      state.phase = 'lobby';
      state.round = undefined;
      state.roundIndex = 0;
      state.totalRounds = state.settings.rounds;
      emit({ type: 'backToLobby' });
      return OK;
    }

    case 'start': {
      if (command.playerId !== state.hostId) return refuse('NOT_HOST', 'Only the host can start');
      if (state.phase !== 'lobby' || state.awaitingCard) {
        return refuse('BAD_PHASE', 'The game has already started');
      }
      const present = Object.values(state.players).filter((p) => p.connected).length;
      if (state.mode !== 'solo' && present < ROOM.minPlayers) {
        return refuse('NOT_ENOUGH_PLAYERS', `At least ${ROOM.minPlayers} players are needed`);
      }
      if (command.lexicon) state.lexicon = command.lexicon;
      state.totalRounds = Math.max(
        1,
        Math.min(state.settings.rounds, command.availableRounds ?? state.settings.rounds),
      );
      state.startedAt = ctx.now;
      state.history = [];
      emit({ type: 'gameStarted' });
      requestCard(state, effects);
      return OK;
    }

    case 'cardReady': {
      if (!state.awaitingCard) return refuse('BAD_PHASE', 'No card was requested');
      state.awaitingCard = false;
      const startsAt = ctx.now + ROUND.countdownMs;
      state.round = {
        id: ctx.newId(),
        index: state.roundIndex,
        card: command.card,
        startsAt,
        endsAt: startsAt + ROUND.durationMs,
        level: 0,
        perPlayer: Object.fromEntries(Object.keys(state.players).map((id) => [id, { penalty: 0 }])),
        answerOrder: [],
      };
      for (const id of Object.keys(state.round.perPlayer)) {
        const seated = state.players[id]!;
        seated.roundsSeated = (seated.roundsSeated ?? 0) + 1;
      }
      state.roundIndex += 1;
      state.phase = 'countdown';
      emit({ type: 'roundPrepare' });
      return OK;
    }

    case 'noCardLeft': {
      state.awaitingCard = false;
      endGame(state, effects, emit);
      return OK;
    }

    case 'skipReveal': {
      if (command.playerId !== state.hostId) return refuse('NOT_HOST', 'Only the host can skip');
      if (state.phase !== 'reveal') return refuse('BAD_PHASE', 'Nothing to skip');
      afterReveal(state, effects, emit);
      return OK;
    }

    case 'useBonus': {
      const round = state.round;
      const player = state.players[command.playerId];
      const mine = round?.perPlayer[command.playerId];
      if (state.phase !== 'playing' || !round || round.id !== command.roundId || !player || !mine) {
        return refuse('BAD_PHASE', 'Bonuses are played during a round');
      }
      const item = player.inventory?.find((owned) => owned.id === command.itemId);
      if (!item) return refuse('BONUS_NOT_OWNED', 'You do not hold this bonus');

      // Check first, spend second, apply last: a refused bonus stays in the inventory, and a
      // stolen one needs the room that spending the steal just made.
      const play = (SELF_BONUSES as readonly string[]).includes(item.type)
        ? selfBonus(state, round, command.playerId, item.type, ctx, effects)
        : attack(state, round, command.playerId, item.type, command.targetId, ctx, effects);
      if (typeof play !== 'function') return play;

      player.inventory = (player.inventory ?? []).filter((owned) => owned.id !== item.id);
      play();
      emit({ type: 'playerUpdated', playerId: player.id });
      return { ok: true, data: { used: item.type } };
    }

    case 'guess': {
      const live = liveRound(state, command.playerId, command.roundId, 'text');
      if ('error' in live) return live.error;
      const { round, mine } = live;
      if (isFrozen(mine, ctx.now)) return refuse('FROZEN', 'Your input is frozen for a moment');

      if (
        mine.lastGuessAt !== undefined &&
        ctx.now - mine.lastGuessAt < FREE_TEXT.minGuessIntervalMs
      ) {
        return { ok: true, data: { verdict: 'rate_limited' } };
      }
      mine.lastGuessAt = ctx.now;

      const verdict = matchAnswer(command.text, round.card.answers, new Set(state.lexicon));
      if (verdict !== 'correct') {
        return { ok: true, data: { verdict: verdict === 'close' ? 'close' : 'wrong' } };
      }
      const points = score(state, round, command.playerId, ctx, effects, emit);
      return { ok: true, data: { verdict: 'correct', points } };
    }

    case 'pick': {
      const live = liveRound(state, command.playerId, command.roundId, 'mcq');
      if ('error' in live) return live.error;
      const { round, mine } = live;
      if (isFrozen(mine, ctx.now)) return refuse('FROZEN', 'Your input is frozen for a moment');

      if (mine.lockedUntil !== undefined && ctx.now < mine.lockedUntil) {
        return refuse('LOCKED', 'Wait before picking again');
      }
      if (!round.card.options?.some((option) => option.id === command.optionId)) {
        return refuse('INVALID_PAYLOAD', 'Unknown option');
      }
      if (command.optionId !== round.card.correctOptionId) {
        mine.penalty += MULTIPLE_CHOICE.wrongPickPenalty;
        mine.lockedUntil = ctx.now + MULTIPLE_CHOICE.lockMs;
        return {
          ok: true,
          data: { verdict: 'wrong', lockedUntil: mine.lockedUntil, penalty: mine.penalty },
        };
      }
      const points = score(state, round, command.playerId, ctx, effects, emit);
      return { ok: true, data: { verdict: 'correct', points } };
    }
  }
}

function liveRound(
  state: RoomState,
  playerId: string,
  roundId: string,
  mode: RoomSettings['answerMode'],
): { round: RoundState; mine: RoundState['perPlayer'][string] } | { error: Reply } {
  const round = state.round;
  const mine = round?.perPlayer[playerId];
  if (state.phase !== 'playing' || !round || round.id !== roundId || !mine) {
    return { error: refuse('BAD_PHASE', 'This round is not open') };
  }
  if (state.settings.answerMode !== mode) {
    return { error: refuse('BAD_PHASE', 'Wrong answer mode for this room') };
  }
  if (mine.answeredAt !== undefined) {
    return { error: refuse('BAD_PHASE', 'Already answered') };
  }
  return { round, mine };
}

function score(
  state: RoomState,
  round: RoundState,
  playerId: string,
  ctx: Context,
  effects: Effect[],
  emit: (event: EngineEvent) => void,
): number {
  const { now } = ctx;
  const mine = round.perPlayer[playerId]!;
  const player = state.players[playerId]!;
  const earned = roundValue({
    scoring: state.settings.scoring ?? 'decay',
    elapsedMs: now - round.startsAt,
    foundBefore: round.answerOrder.length,
    penalty: mine.penalty,
  });

  // A thief set up earlier in the round takes their share of what was just earned.
  const thief = mine.pointsThief ? state.players[mine.pointsThief] : undefined;
  const stolen = thief ? Math.round((earned * BONUS.stealPointsShare) / 10) * 10 : 0;
  const points = earned - stolen;
  if (thief && stolen > 0) {
    thief.score += stolen;
    const theirs = round.perPlayer[thief.id];
    if (theirs) theirs.stolenGain = (theirs.stolenGain ?? 0) + stolen;
    emit({ type: 'steal', kind: 'points', from: thief.id, to: playerId, amount: stolen });
  }

  mine.answeredAt = now;
  mine.points = points;
  round.answerOrder.push(playerId);
  player.score += points;
  player.correctCount += 1;
  player.answerMsTotal = (player.answerMsTotal ?? 0) + (now - round.startsAt);
  player.streak += 1;
  player.bestStreak = Math.max(player.bestStreak, player.streak);
  emit({ type: 'playerAnswered', playerId, points, order: round.answerOrder.length });
  // The ranking is live (it is what a shared screen shows): totals follow at once, the thief's too.
  emit({ type: 'playerUpdated', playerId });
  if (thief && stolen > 0) emit({ type: 'playerUpdated', playerId: thief.id });

  // Bonuses are earned by playing: a streak, or being the fastest of a big enough round.
  if (player.streak % BONUS.streakLength === 0) grant(state, playerId, 'streak', ctx, effects);
  const seated = Object.keys(round.perPlayer).length;
  if (round.answerOrder.length === 1 && seated >= BONUS.minPlayersForFastest) {
    grant(state, playerId, 'fastest', ctx, effects);
  }

  checkEarlyEnd(state, round, now, emit);
  return points;
}

/** The round ends early once every connected player *of this round* has found. */
function checkEarlyEnd(
  state: RoomState,
  round: RoundState,
  now: number,
  emit: (event: EngineEvent) => void,
): void {
  if (round.endsEarlyAt !== undefined) return;
  const waitingFor = Object.values(state.players).filter(
    (p) => p.connected && round.perPlayer[p.id] && round.perPlayer[p.id]!.answeredAt === undefined,
  );
  const someoneFound = round.answerOrder.length > 0;
  if (waitingFor.length > 0 || !someoneFound) return;
  if (state.mode === 'solo') endRound(state, now, emit);
  else round.endsEarlyAt = now + ROUND.earlyEndGraceMs;
}

/** "Awa", "Awa 2", "Awa 3": two players must never read the same in a ranking. */
function uniqueNickname(state: RoomState, wanted: string): string {
  const taken = new Set(Object.values(state.players).map((p) => p.nickname.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  // The first free suffix, not "how many look alike + 1": that count can land on a taken name.
  const stem = wanted.replace(/ \d+$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function migrateHost(state: RoomState, emit: (event: EngineEvent) => void): void {
  const heir = Object.values(state.players)
    .filter((p) => p.connected && p.id !== state.hostId)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!heir) return;
  state.hostId = heir.id;
  emit({ type: 'hostChanged' });
}

function removePlayer(
  state: RoomState,
  playerId: string,
  reason: 'left' | 'kicked' | 'timeout',
  now: number,
  effects: Effect[],
  emit: (event: EngineEvent) => void,
): void {
  const player = state.players[playerId];
  if (!player) return;
  if (state.phase === 'lobby') delete state.players[playerId];
  else Object.assign(player, { connected: false, gone: true, disconnectedAt: undefined });
  emit({ type: 'playerLeft', playerId, reason });

  if (state.hostId === playerId) migrateHost(state, emit);
  if (state.phase === 'playing' && state.round) checkEarlyEnd(state, state.round, now, emit);
  if (Object.values(state.players).some((p) => !p.gone)) return;
  // A shared screen still shows the code: its lobby waits for the next players, for a while.
  if (state.openedByScreen && state.phase === 'lobby') {
    state.hostId = null;
    state.emptySince = now;
    // They may have left right after "start": the card still loading has nobody to be shown to.
    state.awaitingCard = false;
  } else effects.push({ type: 'abandoned' });
}

/**
 * A public room starts by itself: as soon as everyone the queue matched is there, or when the
 * wait runs out with enough of them. Alone at the deadline, the room is dropped rather than
 * leaving somebody in an empty lobby.
 */
function autoStart(state: RoomState, now: number, effects: Effect[]): void {
  if (state.phase !== 'lobby' || state.autoStartAt === undefined || state.awaitingCard) return;
  const present = Object.values(state.players).filter((p) => p.connected).length;
  const everyone = present >= (state.expectedPlayers ?? Infinity);
  if (!everyone && now < state.autoStartAt) return;

  state.autoStartAt = undefined;
  if (present >= ROOM.minPlayers) effects.push({ type: 'needStart' });
  else effects.push({ type: 'abandoned' });
}

function expireEmptyRoom(state: RoomState, now: number, effects: Effect[]): void {
  if (state.emptySince === undefined || now < state.emptySince + ROOM.emptyRoomTtlMs) return;
  state.emptySince = undefined;
  effects.push({ type: 'abandoned' });
}

/** Players whose 60 seconds ran out: the lobby frees their seat, a game keeps their score. */
function expireGrace(
  state: RoomState,
  now: number,
  effects: Effect[],
  emit: (event: EngineEvent) => void,
): void {
  for (const player of Object.values(state.players)) {
    const { disconnectedAt } = player;
    if (disconnectedAt === undefined || player.gone) continue;
    if (now >= disconnectedAt + ROOM.reconnectGraceMs) {
      removePlayer(state, player.id, 'timeout', now, effects, emit);
    }
  }
}

function endRound(state: RoomState, now: number, emit: (event: EngineEvent) => void): void {
  const round = state.round!;
  for (const player of Object.values(state.players)) {
    if (round.perPlayer[player.id]?.answeredAt === undefined) player.streak = 0;
  }
  const found = Object.values(round.perPlayer).flatMap((mine) =>
    mine.answeredAt === undefined ? [] : [mine.answeredAt - round.startsAt],
  );
  (state.history ??= []).push({
    cardId: round.card.cardId,
    seated: Object.keys(round.perPlayer).length,
    found: found.length,
    foundMsTotal: found.reduce((sum, ms) => sum + ms, 0),
  });
  state.phase = 'reveal';
  state.revealUntil = state.mode === 'solo' ? null : now + ROUND.revealMs;
  emit({ type: 'roundEnd' });
}

function afterReveal(
  state: RoomState,
  effects: Effect[],
  emit: (event: EngineEvent) => void,
): void {
  state.revealUntil = undefined;
  if (state.roundIndex >= state.totalRounds) endGame(state, effects, emit);
  else requestCard(state, effects);
}

function requestCard(state: RoomState, effects: Effect[]): void {
  state.awaitingCard = true;
  effects.push({ type: 'needCard' });
}

function endGame(state: RoomState, effects: Effect[], emit: (event: EngineEvent) => void): void {
  state.phase = 'ended';
  state.revealUntil = undefined;
  emit({ type: 'gameEnd' });
  effects.push({ type: 'gameOver' });
}
