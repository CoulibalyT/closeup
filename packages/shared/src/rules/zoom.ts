import { ZOOM } from '../constants/game.js';

/** Zoom level a player sees: the automatic schedule plus the levels they unlocked with bonuses. */
export function zoomLevelAt(
  elapsedMs: number,
  bonusLevels = 0,
  levelAtMs: readonly number[] = ZOOM.autoLevelAtMs,
): number {
  let auto = 0;
  levelAtMs.forEach((startsAt, level) => {
    if (elapsedMs >= startsAt) auto = level;
  });
  return Math.min(ZOOM.maxLevel, auto + Math.max(0, bonusLevels));
}

/** Side of the square crop, in pixels of the original image. */
export function cropSidePx(baseRadius: number, level: number): number {
  const multiplier = ZOOM.levelMultipliers[level];
  if (multiplier === undefined) throw new RangeError(`Unknown zoom level: ${level}`);
  return 2 * baseRadius * multiplier;
}
