import { MATCHMAKING } from '../constants/game.js';
import type { Locale } from '../schemas/common.js';

/** Somebody waiting in the public queue of one language. */
export interface Waiting {
  playerId: string;
  nickname: string;
  /** Server time they joined the queue. The queue is served oldest first. */
  since: number;
}

export interface QueueStatus {
  waiting: number;
  /** When the room will start by itself, if the wait alone is enough. `null`: not yet. */
  startsAt: number | null;
}

/**
 * Who leaves the queue together, or `null` to keep waiting. Pure: the service around it owns
 * Redis and the sockets, and the rules stay testable on a clock of their own.
 *
 * A room starts as soon as `startAtPlayers` are waiting, or after `timeoutMs` with at least
 * `minPlayers`, so two people are never left staring at each other for ever.
 */
export function formRoom(queue: Waiting[], now: number): Waiting[] | null {
  const oldestFirst = [...queue].sort(
    (a, b) => a.since - b.since || a.playerId.localeCompare(b.playerId),
  );
  const enough = oldestFirst.length >= MATCHMAKING.startAtPlayers;
  const waitedLongEnough =
    oldestFirst.length >= MATCHMAKING.minPlayers &&
    now - oldestFirst[0]!.since >= MATCHMAKING.timeoutMs;
  if (!enough && !waitedLongEnough) return null;
  return oldestFirst.slice(0, MATCHMAKING.maxPlayers);
}

/** What a waiting player is told: how many are there, and when the wait alone would be enough. */
export function queueStatus(queue: Waiting[]): QueueStatus {
  const oldest = queue.reduce<number | null>(
    (since, entry) => (since === null || entry.since < since ? entry.since : since),
    null,
  );
  const waitIsEnough = oldest !== null && queue.length >= MATCHMAKING.minPlayers;
  return { waiting: queue.length, startsAt: waitIsEnough ? oldest + MATCHMAKING.timeoutMs : null };
}

/** Public games are the same for everyone: nobody negotiates settings with strangers. */
export const PUBLIC_SETTINGS = {
  rounds: 5,
  answerMode: 'text',
  scoring: 'decay',
  display: 'phones',
  // Strangers play the short classic round.
  roundSeconds: 30,
} as const;

export const queueKey = (language: Locale): string => `closeup:mm:${language}`;
