import type {
  BonusItem,
  BonusType,
  DisplayMode,
  ErrorCode,
  Locale,
  Malus,
  ScoringMode,
} from '@closeup/shared';
import type { CardAnswers, Verdict } from './matching.js';

/**
 * Server-side state of a room. It holds secrets (answers, card ids, the correct option) and must
 * never be serialised to a client: `view.ts` is the only way out.
 */

export type Phase = 'lobby' | 'countdown' | 'playing' | 'reveal' | 'ended';
export type RoomMode = 'solo' | 'private' | 'public';
export type AnswerMode = 'text' | 'mcq';

export interface RoomSettings {
  rounds: number;
  answerMode: AnswerMode;
  /** `decay` (default): worth less as time passes. `fixed`: paid by order of arrival. */
  scoring?: ScoringMode;
  /**
   * Where the image is shown. The reducer never reads it: a shared screen is not a player, so
   * this only changes who receives which payload (`view.ts`).
   */
  display?: DisplayMode;
}

export interface McqOption {
  id: string;
  label: string;
}

/** A pre-generated crop. `cropId` is a server-side id: clients only ever see a signed URL. */
export interface CropInfo {
  cropId: string;
  focus: { x: number; y: number };
  scaleFromPrev: number | null;
}

/** What the reveal shows. Secret until the round ends. */
export interface RevealInfo {
  imageId: string;
  zone: { cx: number; cy: number; r: number };
  zoneLabel?: string;
  answer: string;
  credit: { author: string; licence: string; sourceUrl?: string };
}

/** Everything the engine needs about a card. It never learns what kind of thing the card shows. */
export interface EngineCard {
  cardId: string;
  zoomPointId: string;
  answers: CardAnswers;
  /** MCQ only. Ids are random per round so they cannot be learnt across games. */
  options?: McqOption[];
  correctOptionId?: string;
  /** One entry per zoom level. The reducer never reads these two; `view.ts` does. */
  crops: CropInfo[];
  reveal: RevealInfo;
  /** Content metadata passed through for the "category" bonus. The engine never branches on it. */
  category?: string;
  /** Closest crop of *another* zoom point of the same image, for the "second zone" bonus. */
  secondZone?: CropInfo;
}

export interface PlayerState {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  connected: boolean;
  /** Seniority decides who inherits the room when the host is gone. */
  joinedAt: number;
  /** Set on disconnection. After the grace period the player counts as gone. */
  disconnectedAt?: number;
  /** The grace period ran out. They keep their score and may still come back. */
  gone?: boolean;
  /** Earned by playing, never bought. Capped; kept from one round to the next. */
  inventory?: BonusItem[];
  /** An armed shield absorbs the next malus or steal, in this round or a later one. */
  shielded?: boolean;
}

export interface ActiveMalus {
  type: Malus;
  from: string;
  until: number;
}

export interface RoundPlayerState {
  /** Wrong multiple-choice picks and the cost of self bonuses lower what the round is worth. */
  penalty: number;
  answeredAt?: number;
  points?: number;
  lockedUntil?: number;
  lastGuessAt?: number;
  /** Zoom levels unlocked with a bonus, on top of the automatic schedule. */
  bonusLevels?: number;
  /** One malus per target at a time. */
  effect?: ActiveMalus;
  /** Who takes a share of what this player scores this round. */
  pointsThief?: string;
  /** Points taken from others this round, shown with the round's results. */
  stolenGain?: number;
  /** What their self bonuses revealed. The values are derived on the way out, in `view.ts`. */
  revealed?: { initials?: true; category?: true; secondZone?: true };
  removedOptionIds?: string[];
}

export interface RoundState {
  id: string;
  index: number;
  card: EngineCard;
  startsAt: number;
  endsAt: number;
  /** Highest automatic zoom level announced so far. */
  level: number;
  perPlayer: Record<string, RoundPlayerState>;
  /** Player ids in the order they found the answer. */
  answerOrder: string[];
  /** Set once every connected player has answered. */
  endsEarlyAt?: number;
}

export interface RoomState {
  code: string;
  mode: RoomMode;
  /** `null` while a room opened from a shared screen waits for its first player. */
  hostId: string | null;
  /** The room belongs to a shared screen: it survives being empty, for a while. */
  openedByScreen?: true;
  /** Since when nobody is in. Past `ROOM.emptyRoomTtlMs` the room is abandoned. */
  emptySince?: number;
  language: Locale;
  settings: RoomSettings;
  phase: Phase;
  players: Record<string, PlayerState>;
  /** Rounds started so far. */
  roundIndex: number;
  totalRounds: number;
  /** Normalised answers of every card in the deck, so one card's answer is not a typo of another. */
  lexicon: string[];
  round?: RoundState;
  /** When the reveal ends by itself. `null` waits for the player (solo). */
  revealUntil?: number | null;
  /** True while the room layer is fetching the next card. */
  awaitingCard: boolean;
  /** The single timer of the room: when `tick` must be dispatched next. */
  wakeAt: number | null;
}

export type Command =
  /** Joining again is how a player reconnects: same id, score and place kept. */
  | { type: 'join'; playerId: string; nickname: string }
  | { type: 'leave'; playerId: string }
  | { type: 'disconnect'; playerId: string }
  | { type: 'kick'; playerId: string; targetId: string }
  | { type: 'updateSettings'; playerId: string; settings: RoomSettings }
  /** The room layer builds the deck first and tells how many cards it found. */
  | { type: 'start'; playerId: string; lexicon?: string[]; availableRounds?: number }
  | { type: 'playAgain'; playerId: string }
  | { type: 'cardReady'; card: EngineCard }
  | { type: 'noCardLeft' }
  | { type: 'tick' }
  | { type: 'guess'; playerId: string; roundId: string; text: string }
  | { type: 'pick'; playerId: string; roundId: string; optionId: string }
  | { type: 'skipReveal'; playerId: string }
  | { type: 'useBonus'; playerId: string; roundId: string; itemId: string; targetId?: string };

/** Internal events: they reference crops, the presenter turns those into signed URLs. */
export type EngineEvent =
  | { type: 'playerJoined'; playerId: string }
  | { type: 'playerUpdated'; playerId: string }
  | { type: 'playerLeft'; playerId: string; reason: 'left' | 'kicked' | 'timeout' }
  | { type: 'hostChanged' }
  | { type: 'settingsChanged' }
  | { type: 'backToLobby' }
  | { type: 'gameStarted' }
  | { type: 'roundPrepare' }
  | { type: 'roundStart' }
  | { type: 'roundLevel'; level: number }
  | { type: 'playerAnswered'; playerId: string; points: number; order: number }
  | { type: 'roundEnd' }
  | { type: 'gameEnd' }
  /** Sent to one player: their zoom level moved without the rest of the room (zoom-out bonus). */
  | { type: 'personalLevel'; playerId: string; level: number }
  | {
      type: 'bonusGranted';
      playerId: string;
      item: BonusItem;
      reason: 'streak' | 'fastest' | 'catchup' | 'stolen';
    }
  | { type: 'malus'; malus: Malus; from: string; to: string; until: number }
  | {
      type: 'steal';
      kind: 'bonus' | 'points';
      from: string;
      to: string;
      bonusType?: BonusType;
      amount?: number;
    }
  | { type: 'blocked'; from: string; to: string; what: BonusType };

export type Effect =
  /** `to` narrows the message to one player; without it the whole room hears it. */
  | { type: 'emit'; event: EngineEvent; to?: string }
  /** Ask the room layer for the next playable card; it answers with `cardReady` or `noCardLeft`. */
  | { type: 'needCard' }
  | { type: 'gameOver' }
  /** Nobody is left and nobody can come back: the room layer may forget the room. */
  | { type: 'abandoned' };

export type Reply =
  | { ok: true; data: GuessReply | PickReply | BonusUsed | Record<string, never> }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface GuessReply {
  verdict: Exclude<Verdict, 'empty'> | 'rate_limited';
  points?: number;
}

export interface PickReply {
  verdict: 'correct' | 'wrong';
  points?: number;
  lockedUntil?: number;
  penalty?: number;
}

/** The engine's half of the `bonus:use` ack; `view.ts` adds what the bonus revealed. */
export interface BonusUsed {
  used: BonusType;
}

export interface Context {
  now: number;
  /** Injected so that tests are deterministic. */
  newId: () => string;
  /** Bonus draws, random steals, removed options. Defaults to Math.random. */
  random?: () => number;
}

export interface Reduced {
  state: RoomState;
  effects: Effect[];
  reply: Reply;
}
