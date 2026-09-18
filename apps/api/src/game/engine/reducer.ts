import {
  type ErrorCode,
  FREE_TEXT,
  type Locale,
  MULTIPLE_CHOICE,
  ROUND,
  roundValueAt,
  ZOOM,
} from '@closeup/shared';
import { matchAnswer } from './matching.js';
import type {
  Command,
  Context,
  Display,
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
  display: Display;
  hostId: string;
  nickname: string;
  language: Locale;
  settings: RoomSettings;
  lexicon: string[];
}): RoomState {
  return {
    code: init.code,
    mode: init.mode,
    display: init.display,
    hostId: init.hostId,
    language: init.language,
    settings: init.settings,
    phase: 'lobby',
    players: { [init.hostId]: newPlayer(init.hostId, init.nickname) },
    roundIndex: 0,
    totalRounds: init.settings.rounds,
    lexicon: init.lexicon,
    awaitingCard: false,
    wakeAt: null,
  };
}

const newPlayer = (id: string, nickname: string): PlayerState => ({
  id,
  nickname,
  score: 0,
  streak: 0,
  bestStreak: 0,
  correctCount: 0,
  connected: true,
});

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
  return { state, effects, reply };
}

/** Applies every transition that is due at `ctx.now`, in order. */
function advance(state: RoomState, ctx: Context, effects: Effect[]): void {
  const emit = (event: EngineEvent) => effects.push({ type: 'emit', event });

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
      if (state.phase !== 'lobby') return refuse('BAD_PHASE', 'The game has already started');
      state.players[command.playerId] ??= newPlayer(command.playerId, command.nickname);
      return OK;
    }

    case 'start': {
      if (command.playerId !== state.hostId) return refuse('NOT_HOST', 'Only the host can start');
      if (state.phase !== 'lobby' || state.awaitingCard) {
        return refuse('BAD_PHASE', 'The game has already started');
      }
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

    case 'guess': {
      const live = liveRound(state, command.playerId, command.roundId, 'text');
      if ('error' in live) return live.error;
      const { round, mine } = live;

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
      const points = score(state, round, command.playerId, ctx.now, emit);
      return { ok: true, data: { verdict: 'correct', points } };
    }

    case 'pick': {
      const live = liveRound(state, command.playerId, command.roundId, 'mcq');
      if ('error' in live) return live.error;
      const { round, mine } = live;

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
      const points = score(state, round, command.playerId, ctx.now, emit);
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
  now: number,
  emit: (event: EngineEvent) => void,
): number {
  const mine = round.perPlayer[playerId]!;
  const player = state.players[playerId]!;
  const points = roundValueAt(now - round.startsAt, mine.penalty);

  mine.answeredAt = now;
  mine.points = points;
  round.answerOrder.push(playerId);
  player.score += points;
  player.correctCount += 1;
  player.streak += 1;
  player.bestStreak = Math.max(player.bestStreak, player.streak);
  emit({ type: 'playerAnswered', playerId, points, order: round.answerOrder.length });

  const everyoneFound = Object.values(state.players)
    .filter((p) => p.connected)
    .every((p) => round.perPlayer[p.id]?.answeredAt !== undefined);
  if (everyoneFound) {
    if (state.mode === 'solo') endRound(state, now, emit);
    else round.endsEarlyAt = now + ROUND.earlyEndGraceMs;
  }
  return points;
}

function endRound(state: RoomState, now: number, emit: (event: EngineEvent) => void): void {
  const round = state.round!;
  for (const player of Object.values(state.players)) {
    if (round.perPlayer[player.id]?.answeredAt === undefined) player.streak = 0;
  }
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
