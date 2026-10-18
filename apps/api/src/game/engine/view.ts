import {
  type RoundHint,
  roundHintSchema,
  bonusGrantedSchema,
  type BonusUseReply,
  bonusUseReplySchema,
  type Crop,
  type GameEnd,
  gameEndSchema,
  gameStartedSchema,
  type Hints,
  hintsSchema,
  type Player,
  type RoomStateView,
  roomHostChangedSchema,
  roomLobbySchema,
  roomPlayerLeftSchema,
  roomPlayerSchema,
  roomSettingsEventSchema,
  roomStateSchema,
  roundBlockedSchema,
  roundEffectSchema,
  type RoundEnd,
  roundEndSchema,
  roundLevelSchema,
  roundPlayerAnsweredSchema,
  roundPrepareSchema,
  roundStartSchema,
  roundStealSchema,
  ServerEvent,
  roundTiming,
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

/** Phones and shared screens do not always hear the same thing. Without it: the whole room. */
export type Audience = 'players' | 'screens';

export interface WireMessage {
  event: string;
  payload: unknown;
  audience?: Audience;
}

const displayOf = (state: RoomState) => state.settings.display ?? 'phones';

/** Events that are only ever sent to one player carry their id themselves. */
export const recipientOf = (event: EngineEvent): string | undefined =>
  event.type === 'personalLevel' || event.type === 'bonusGranted' ? event.playerId : undefined;

// Only the *count* of bonuses is public. What they are is for their owner alone.
const ranking = (state: RoomState): Player[] =>
  Object.values(state.players)
    .map(({ id, nickname, score, connected, inventory }) => ({
      id,
      nickname,
      score,
      connected,
      bonusCount: inventory?.length ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));

/** "tour Eiffel" → "T··· E·····": first letters, and how long each word is. */
export const maskInitials = (answer: string): string =>
  answer
    .trim()
    .split(/\s+/)
    .map((word) => {
      const [first = '', ...rest] = [...word];
      return first.toUpperCase() + '·'.repeat(rest.length);
    })
    .join('  ');

/** Zoom level a player sees: the room's, plus what their bonuses unlocked. */
const levelOf = (round: RoundState, playerId: string): number =>
  Math.min(ZOOM.maxLevel, round.level + (round.perPlayer[playerId]?.bonusLevels ?? 0));

/**
 * The room's hint, the same for everyone: the card's written hint, or its category and the
 * masked initials of the answer. Only once it was shown.
 */
export function roundHintOf(round: RoundState): RoundHint | undefined {
  if (round.hintAt === undefined) return undefined;
  const text = round.card.hint?.text?.trim();
  return roundHintSchema.parse(
    text
      ? { text }
      : { category: round.card.category, initials: maskInitials(round.card.reveal.answer) },
  );
}

/** What a player's self bonuses revealed. Derived here, from secrets that stay on the server. */
function hintsOf(round: RoundState, playerId: string, sign: Sign): Hints {
  const mine = round.perPlayer[playerId];
  const { card } = round;
  return hintsSchema.parse({
    initials: mine?.revealed?.initials ? maskInitials(card.reveal.answer) : undefined,
    category: mine?.revealed?.category ? card.category : undefined,
    secondZone:
      mine?.revealed?.secondZone && card.secondZone
        ? {
            url: sign('crop', card.secondZone.cropId),
            level: 0,
            focus: card.secondZone.focus,
            scaleFromPrev: null,
          }
        : undefined,
    removedOptionIds: mine?.removedOptionIds ?? [],
  });
}

/** The ack of `bonus:use`: everything of the player's that the bonus may have changed. */
export function bonusReply(state: RoomState, playerId: string, sign: Sign): BonusUseReply | null {
  const player = state.players[playerId];
  const round = state.round;
  if (!player || !round) return null;
  return bonusUseReplySchema.parse({
    inventory: player.inventory ?? [],
    penalty: round.perPlayer[playerId]?.penalty ?? 0,
    shielded: player.shielded ?? false,
    hints: hintsOf(round, playerId, sign),
  });
}

const levelTimes = (state: RoomState, round: RoundState): number[] =>
  roundTiming(state.settings)
    .levelAtMs.slice(1)
    .map((ms) => round.startsAt + ms);
/** A room saved before the setting played 30-second rounds. */
const roundSecondsOf = (state: RoomState): number | null =>
  state.settings.roundSeconds === undefined ? 30 : state.settings.roundSeconds;

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
      // What the round brought them: their own answer, plus what they took from others.
      points: (mine.points ?? 0) + (mine.stolenGain ?? 0),
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

/**
 * One engine event as the messages that leave the server. In big-screen mode the image goes to
 * the shared screens only: phones get the same event built again without the crop, never a
 * payload that had its crop taken out afterwards.
 */
export function broadcast(state: RoomState, event: EngineEvent, sign: Sign): WireMessage[] {
  const shared = event.type === 'roundStart' || event.type === 'roundLevel';
  if (!shared || displayOf(state) === 'phones') {
    const message = eventToWire(state, event, sign);
    return message ? [message] : [];
  }
  const forScreens = eventToWire(state, event, sign);
  const forPhones = eventToWire(state, event, sign, false);
  return forScreens && forPhones
    ? [
        { ...forScreens, audience: 'screens' },
        { ...forPhones, audience: 'players' },
      ]
    : [];
}

/**
 * Message for an engine event. Returns `null` when the event has no round to show.
 * `withImage: false` leaves the crop out of the two events that carry the shared image.
 */
export function eventToWire(
  state: RoomState,
  event: EngineEvent,
  sign: Sign,
  withImage = true,
): WireMessage | null {
  const round = state.round;

  switch (event.type) {
    case 'playerJoined':
    case 'playerUpdated': {
      const player = ranking(state).find((p) => p.id === event.playerId);
      if (!player) return null;
      return {
        event:
          event.type === 'playerJoined'
            ? ServerEvent.roomPlayerJoined
            : ServerEvent.roomPlayerUpdated,
        payload: roomPlayerSchema.parse({ player }),
      };
    }
    case 'playerLeft':
      return {
        event: ServerEvent.roomPlayerLeft,
        payload: roomPlayerLeftSchema.parse({
          playerId: event.playerId,
          reason: event.reason,
          removed: !state.players[event.playerId],
        }),
      };
    case 'hostChanged':
      return {
        event: ServerEvent.roomHostChanged,
        payload: roomHostChangedSchema.parse({ hostId: state.hostId }),
      };
    case 'settingsChanged':
      return {
        event: ServerEvent.roomSettings,
        payload: roomSettingsEventSchema.parse({
          ...state.settings,
          scoring: state.settings.scoring ?? 'decay',
          display: displayOf(state),
          roundSeconds: roundSecondsOf(state),
          hints: state.settings.hints ?? true,
          packIds: state.settings.packIds ?? [],
        }),
      };
    case 'backToLobby':
      return {
        event: ServerEvent.roomLobby,
        payload: roomLobbySchema.parse({ players: ranking(state) }),
      };
    case 'gameStarted':
      return {
        event: ServerEvent.gameStarted,
        payload: gameStartedSchema.parse({
          totalRounds: state.totalRounds,
          answerMode: state.settings.answerMode,
          display: displayOf(state),
        }),
      };
    case 'gameEnd':
      return { event: ServerEvent.gameEnd, payload: gameEnd(state) };
    case 'bonusGranted':
      return {
        event: ServerEvent.bonusGranted,
        payload: bonusGrantedSchema.parse({ item: event.item, reason: event.reason }),
      };
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
          levelAt: levelTimes(state, round),
          answerMode: state.settings.answerMode,
          crop: withImage ? cropAt(round, 0, sign) : undefined,
          options: round.card.options,
        }),
      };
    case 'roundLevel':
      return {
        event: ServerEvent.roundLevel,
        payload: roundLevelSchema.parse({
          roundId: round.id,
          level: event.level,
          crop: withImage ? cropAt(round, event.level, sign) : undefined,
          at: round.startsAt + (roundTiming(state.settings).levelAtMs[event.level] ?? 0),
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
          partial: event.partial,
        }),
      };
    case 'roundHint':
      return { event: ServerEvent.roundHint, payload: roundHintOf(round) };
    case 'roundEnd':
      return { event: ServerEvent.roundEnd, payload: roundEnd(state, round, sign) };
    case 'personalLevel':
      return {
        event: ServerEvent.roundLevel,
        payload: roundLevelSchema.parse({
          roundId: round.id,
          level: event.level,
          crop: cropAt(round, event.level, sign),
          at: round.startsAt,
        }),
      };
    case 'malus':
      return {
        event: ServerEvent.roundEffect,
        payload: roundEffectSchema.parse({
          roundId: round.id,
          type: event.malus,
          from: event.from,
          to: event.to,
          until: event.until,
        }),
      };
    case 'steal':
      return {
        event: ServerEvent.roundSteal,
        payload: roundStealSchema.parse({
          roundId: round.id,
          kind: event.kind,
          from: event.from,
          to: event.to,
          bonusType: event.bonusType,
          amount: event.amount,
        }),
      };
    case 'blocked':
      return {
        event: ServerEvent.roundBlocked,
        payload: roundBlockedSchema.parse({
          roundId: round.id,
          from: event.from,
          to: event.to,
          what: event.what,
        }),
      };
  }
}

/**
 * What a client needs to draw the room from nothing: on join, and after a reconnection.
 * `viewerId: null` is a shared screen: it sees the room's image and owns nothing.
 */
export function toSnapshot(
  state: RoomState,
  viewerId: string | null,
  sign: Sign,
  now: number = Date.now(),
  screens = 0,
): RoomStateView {
  const round = state.round;
  const mine = viewerId === null ? undefined : round?.perPlayer[viewerId];
  const live = state.phase === 'playing';
  const showRound = round && (state.phase === 'countdown' || live);
  const me = viewerId === null ? undefined : state.players[viewerId];

  // In big-screen mode a phone only ever gets an image of its own: the zoom-out bonus, shown in
  // a small private lens while the shared screen keeps the room's level.
  const seesImage =
    viewerId === null || displayOf(state) === 'phones' || (mine?.bonusLevels ?? 0) > 0;

  return roomStateSchema.parse({
    code: state.code,
    mode: state.mode,
    answerMode: state.settings.answerMode,
    phase: state.phase,
    hostId: state.hostId,
    role: viewerId === null ? 'screen' : 'player',
    you: viewerId,
    screens,
    players: ranking(state),
    totalRounds: state.totalRounds,
    scoring: state.settings.scoring ?? 'decay',
    display: displayOf(state),
    roundSeconds: roundSecondsOf(state),
    hints: state.settings.hints ?? true,
    inventory: me?.inventory ?? [],
    shielded: me?.shielded ?? false,
    round: showRound
      ? {
          roundId: round.id,
          index: round.index,
          startsAt: round.startsAt,
          endsAt: round.endsAt,
          levelAt: levelTimes(state, round),
          // Nothing of the card before the countdown is over.
          crop: live && seesImage ? cropAt(round, levelOf(round, viewerId ?? ''), sign) : undefined,
          hints: hintsOf(round, viewerId ?? '', sign),
          foundIds: round.answerOrder,
          effect: mine?.effect && mine.effect.until > now ? mine.effect : undefined,
          options: live ? round.card.options : undefined,
          // Someone who joined mid-round watches it and plays from the next one.
          seated: mine !== undefined,
          answered: mine?.answeredAt !== undefined,
          points: mine?.points,
          hint: roundHintOf(round),
          partial: mine?.partial,
          penalty: mine?.penalty ?? 0,
          lockedUntil: mine?.lockedUntil,
        }
      : undefined,
    reveal: round && state.phase === 'reveal' ? roundEnd(state, round, sign) : undefined,
  });
}
