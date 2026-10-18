import { type Difficulty, ZOOM } from '@closeup/shared';

/**
 * The views of a zoom point a room is dealt: those framed for its difficulty (a face is cut once
 * per difficulty), else the `normal` ones (anything else is cut once). `null` while the point
 * does not yet have all its levels.
 */
export function viewsFor<T extends { level: number; variant: string }>(
  crops: T[],
  difficulty: Difficulty,
): T[] | null {
  for (const variant of [difficulty, 'normal']) {
    const views = crops
      .filter((crop) => crop.variant === variant)
      .sort((a, b) => a.level - b.level);
    if (new Set(views.map((crop) => crop.level)).size > ZOOM.maxLevel) return views;
  }
  return null;
}
