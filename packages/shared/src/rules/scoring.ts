import { HINT, PARTIAL, ROUND, SCORING, type ScoringMode } from '../constants/game.js';

/** In a "fixed points" room: what the next player to find gets, given how many found before. */
export function fixedRoundValue(foundBefore: number, penalty = 0): number {
  const ranks = SCORING.fixedByRank;
  const base = ranks[Math.min(Math.max(0, foundBefore), ranks.length - 1)] ?? SCORING.floorValue;
  return Math.max(SCORING.floorValue, base - Math.max(0, penalty));
}

/** What a correct answer is worth right now, in either scoring mode. */
export function roundValue(input: {
  scoring: ScoringMode;
  elapsedMs: number;
  foundBefore: number;
  penalty?: number;
  /** The room's decay length (`roundTiming(settings).decayMs`). */
  decayMs: number;
  /** The room's hint is showing: the answer is worth `HINT.cost` less. */
  afterHint?: boolean;
}): number {
  const penalty = Math.max(0, input.penalty ?? 0) + (input.afterHint ? HINT.cost : 0);
  return input.scoring === 'fixed'
    ? fixedRoundValue(input.foundBefore, penalty)
    : roundValueAt(input.elapsedMs, penalty, input.decayMs);
}

/** What a partial answer earns, given what the full answer would be worth at that moment. */
export function partialValue(full: number): number {
  const { step, floorValue } = SCORING;
  return Math.max(floorValue, Math.round((full * PARTIAL.share) / step) * step);
}

/**
 * What a correct answer is worth `elapsedMs` into the round, for a player who accumulated
 * `penalty` (bonus costs, wrong multiple-choice picks). The API calls this with the time it
 * received the answer; the web app calls it only to display the live value.
 */
export function roundValueAt(
  elapsedMs: number,
  penalty = 0,
  decayMs: number = ROUND.durationMs,
): number {
  const { startValue, endValue, step, floorValue } = SCORING;
  const progress = Math.min(1, Math.max(0, elapsedMs / decayMs));
  const raw = startValue - (startValue - endValue) * progress - Math.max(0, penalty);
  return Math.max(floorValue, Math.round(raw / step) * step);
}
