import { DIFFICULTY_STARTS, type Difficulty, type StartZone } from '../constants/game.js';
import type { FaceLandmarks } from './cropPlan.js';
import type { Point } from './face.js';

const LABELS: Record<string, StartZone> = {
  'an eye': 'eye',
  'the nose': 'nose',
  'the mouth': 'mouth',
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * What part of a face a zoom point opens on: its label when the detector placed it, else the
 * closest landmark. `null` for a point that is not on a face (a character's detail, an object).
 */
export function startZoneOf(
  point: Point & { labelEn?: string | null },
  face: FaceLandmarks | null,
): StartZone | null {
  const labelled = point.labelEn ? LABELS[point.labelEn] : undefined;
  if (labelled) return labelled;
  if (!face) return null;
  const d = distance(face.leftEye, face.rightEye);
  if (d === 0 || distance(point, face.nose) > 1.5 * d) return null;
  // The mouth sits about 1.1 eye distances below the eyes, the nose 0.6.
  const eyes = {
    x: (face.leftEye.x + face.rightEye.x) / 2,
    y: (face.leftEye.y + face.rightEye.y) / 2,
  };
  const down = (point.y - eyes.y) / d;
  if (down > 0.85) return 'mouth';
  return Math.min(distance(point, face.leftEye), distance(point, face.rightEye)) <
    distance(point, face.nose)
    ? 'eye'
    : 'nose';
}

/**
 * The points a round may open on at this difficulty: easy, an eye; normal, an eye or the nose;
 * hard, anything. A point off any face always may; a card is never left without one.
 */
export function startPoints<T extends Point & { labelEn?: string | null }>(
  points: T[],
  difficulty: Difficulty,
  face: FaceLandmarks | null,
): T[] {
  const allowed = DIFFICULTY_STARTS[difficulty];
  const kept = points.filter((point) => {
    const zone = startZoneOf(point, face);
    return zone === null || allowed.includes(zone);
  });
  return kept.length ? kept : points;
}
