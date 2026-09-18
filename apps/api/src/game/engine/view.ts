import {
  type Crop,
  type GameEnd,
  gameEndSchema,
  gameStartedSchema,
  type Player,
  type RoomStateView,
  roomStateSchema,
  type RoundEnd,
  roundEndSchema,
  roundLevelSchema,
  roundPlayerAnsweredSchema,
  roundPrepareSchema,
  roundStartSchema,
  ServerEvent,
  ZOOM,
} from '@closeup/shared';
import type { EngineEvent, RoomState, RoundState } from './types.js';

/**
 * The only way room state reaches a client. Everything built here goes through a strict zod
 * schema before it leaves: a field that is not part of the contract makes `parse` throw, so an
 * answer or a card id cannot slip out by accident when the state grows.
 */

/** Turns a server-side id into an opaque, short-lived URL. */
export type Sign = (kind: 'crop' | 'image', id: string) => string;

export interface WireMessage {
  event: string;
  payload: unknown;
}

const ranking = (state: RoomState): Player[] =>
  Object.values(state.players)
    .map(({ id, nickname, score, connected }) => ({ id, nickname, score, connected }))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));

const levelTimes = (round: RoundState): number[] =>
  ZOOM.autoLevelAtMs.slice(1).map((ms) => round.startsAt + ms);

function cropAt(round: RoundState, level: number, sign: Sign): Crop {
  const info = round.card.crops[level];
  if (!info) throw new Error(`Card ${round.card.cardId} has no crop for level ${level}`);
  return {
    url: sign('crop', info.cropId),
    level,
    focus: info.focus,
    scaleFromPrev: info.scaleFromPrev,
  };
}

function roundEnd(state: RoomState, round: RoundState, sign: Sign): RoundEnd {
  const { reveal } = round.card;
  return roundEndSchema.parse({
    roundId: round.id,
    reveal: {
      imageUrl: sign('image', reveal.imageId),
      zone: reveal.zone,
      zoneLabel: reveal.zoneLabel,
      answer: reveal.answer,
      credit: reveal.credit,
    },
    results: Object.entries(round.perPlayer).map(([playerId, mine]) => ({
      playerId,
      points: mine.points ?? 0,
      elapsedMs: mine.answeredAt === undefined ? null : mine.answeredAt - round.startsAt,
    })),
    ranking: ranking(state),
    nextAt: state.revealUntil ?? null,
    isLast: state.roundIndex >= state.totalRounds,
  });
}

export function gameEnd(state: RoomState, personalBest?: GameEnd['personalBest']): GameEnd {
  return gameEndSchema.parse({ ranking: ranking(state), personalBest });
}

/** Room-wide message for an engine event. Returns `null` when the event has no round to show. */
export function eventToWire(state: RoomState, event: EngineEvent, sign: Sign): WireMessage | null {
  const round = state.round;

  switch (event.type) {
    case 'gameStarted':
      return {
        event: ServerEvent.gameStarted,
        payload: gameStartedSchema.parse({
          totalRounds: state.totalRounds,
          answerMode: state.settings.answerMode,
        }),
      };
    case 'gameEnd':
      return { event: ServerEvent.gameEnd, payload: gameEnd(state) };
  }

  if (!round) return null;
  switch (event.type) {
    case 'roundPrepare':
      return {
        event: ServerEvent.roundPrepare,
        payload: roundPrepareSchema.parse({
          roundId: round.id,
          index: round.index,
          total: state.totalRounds,
          startsAt: round.startsAt,
        }),
      };
    case 'roundStart':
      return {
        event: ServerEvent.roundStart,
        payload: roundStartSchema.parse({
          roundId: round.id,
          index: round.index,
          total: state.totalRounds,
          startsAt: round.startsAt,
          endsAt: round.endsAt,
          levelAt: levelTimes(round),
          answerMode: state.settings.answerMode,
          crop: cropAt(round, 0, sign),
          options: round.card.options,
        }),
      };
    case 'roundLevel':
      return {
        event: ServerEvent.roundLevel,
        payload: roundLevelSchema.parse({
          roundId: round.id,
          level: event.level,
          crop: cropAt(round, event.level, sign),
          at: round.startsAt + (ZOOM.autoLevelAtMs[event.level] ?? 0),
        }),
      };
    case 'playerAnswered':
      return {
        event: ServerEvent.roundPlayerAnswered,
        payload: roundPlayerAnsweredSchema.parse({
          roundId: round.id,
          playerId: event.playerId,
          points: event.points,
          order: event.order,
        }),
      };
    case 'roundEnd':
      return { event: ServerEvent.roundEnd, payload: roundEnd(state, round, sign) };
  }
}

/** What a client needs to draw the room from nothing: on join, and after a reconnection. */
export function toSnapshot(state: RoomState, viewerId: string, sign: Sign): RoomStateView {
  const round = state.round;
  const mine = round?.perPlayer[viewerId];
  const live = state.phase === 'playing';
  const showRound = round && (state.phase === 'countdown' || live);

  return roomStateSchema.parse({
    code: state.code,
    mode: state.mode,
    answerMode: state.settings.answerMode,
    phase: state.phase,
    hostId: state.hostId,
    you: viewerId,
    players: ranking(state),
    totalRounds: state.totalRounds,
    round: showRound
      ? {
          roundId: round.id,
          index: round.index,
          startsAt: round.startsAt,
          endsAt: round.endsAt,
          levelAt: levelTimes(round),
          // Nothing of the card before the countdown is over.
          crop: live ? cropAt(round, round.level, sign) : undefined,
          options: live ? round.card.options : undefined,
          answered: mine?.answeredAt !== undefined,
          points: mine?.points,
          penalty: mine?.penalty ?? 0,
          lockedUntil: mine?.lockedUntil,
        }
      : undefined,
    reveal: round && state.phase === 'reveal' ? roundEnd(state, round, sign) : undefined,
  });
}
