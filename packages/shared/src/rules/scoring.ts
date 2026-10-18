import { ROUND, SCORING, type ScoringMode } from '../constants/game.js';

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
}): number {
  return input.scoring === 'fixed'
    ? fixedRoundValue(input.foundBefore, input.penalty)
    : roundValueAt(input.elapsedMs, input.penalty, input.decayMs);
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
