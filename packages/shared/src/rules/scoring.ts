import { ROUND, SCORING } from '../constants/game.js';

/**
 * What a correct answer is worth `elapsedMs` into the round, for a player who accumulated
 * `penalty` (bonus costs, wrong multiple-choice picks). The API calls this with the time it
 * received the answer; the web app calls it only to display the live value.
 */
export function roundValueAt(elapsedMs: number, penalty = 0): number {
  const { startValue, endValue, step, floorValue } = SCORING;
  const progress = Math.min(1, Math.max(0, elapsedMs / ROUND.durationMs));
  const raw = startValue - (startValue - endValue) * progress - Math.max(0, penalty);
  return Math.max(floorValue, Math.round(raw / step) * step);
}
