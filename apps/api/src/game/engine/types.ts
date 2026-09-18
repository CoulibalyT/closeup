import type { ErrorCode, Locale } from '@closeup/shared';
import type { CardAnswers, Verdict } from './matching.js';

/**
 * Server-side state of a room. It holds secrets (answers, card ids, the correct option) and must
 * never be serialised to a client: `view.ts` is the only way out.
 */

export type Phase = 'lobby' | 'countdown' | 'playing' | 'reveal' | 'ended';
export type RoomMode = 'solo' | 'private' | 'public';
export type Display = 'phones' | 'bigscreen';
export type AnswerMode = 'text' | 'mcq';

export interface RoomSettings {
  rounds: number;
  answerMode: AnswerMode;
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
}

export interface RoundPlayerState {
  /** Wrong multiple-choice picks (and, from phase 3, bonus costs) lower what the round is worth. */
  penalty: number;
  answeredAt?: number;
  points?: number;
  lockedUntil?: number;
  lastGuessAt?: number;
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
  display: Display;
  hostId: string;
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
  | { type: 'skipReveal'; playerId: string };

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
  | { type: 'gameEnd' };

export type Effect =
  | { type: 'emit'; event: EngineEvent }
  /** Ask the room layer for the next playable card; it answers with `cardReady` or `noCardLeft`. */
  | { type: 'needCard' }
  | { type: 'gameOver' }
  /** Nobody is left and nobody can come back: the room layer may forget the room. */
  | { type: 'abandoned' };

export type Reply =
  | { ok: true; data: GuessReply | PickReply | Record<string, never> }
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

export interface Context {
  now: number;
  /** Injected so that tests are deterministic. */
  newId: () => string;
}

export interface Reduced {
  state: RoomState;
  effects: Effect[];
  reply: Reply;
}
