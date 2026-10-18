import { ROUND, ROUND_SECONDS, UNTIMED } from '../constants/game.js';

/** When things happen in a round of this room: its end, its zoom levels, its hint, its value. */
export interface RoundTiming {
  /** Null: no clock, the round ends when everyone answered or the host skips. */
  durationMs: number | null;
  /** Elapsed time at which each automatic zoom level starts. */
  levelAtMs: number[];
  hintAtMs: number;
  /** Over how long the value goes from its start to its end value. */
  decayMs: number;
  /** Without a clock, a round still ends after this, so that a room never stays stuck. */
  safetyMs: number | null;
}

/** Share of the round at which the automatic hint is due. */
const HINT_AT_RATIO = 0.6;

/**
 * The one place that turns a room's `roundSeconds` into times. A room saved before the setting
 * existed had 30-second rounds: that is what it keeps.
 */
export function roundTiming(settings: { roundSeconds?: number | null }): RoundTiming {
  if (settings.roundSeconds === null) {
    return {
      durationMs: null,
      levelAtMs: [...UNTIMED.levelAtMs],
      hintAtMs: UNTIMED.hintAtMs,
      decayMs: UNTIMED.decayMs,
      safetyMs: UNTIMED.safetyMs,
    };
  }
  const seconds = (ROUND_SECONDS as readonly number[]).includes(settings.roundSeconds ?? 0)
    ? settings.roundSeconds!
    : ROUND.durationMs / 1000;
  const durationMs = seconds * 1000;
  return {
    durationMs,
    levelAtMs: [0, durationMs / 3, (2 * durationMs) / 3].map(Math.round),
    hintAtMs: Math.round(durationMs * HINT_AT_RATIO),
    decayMs: durationMs,
    safetyMs: null,
  };
}
