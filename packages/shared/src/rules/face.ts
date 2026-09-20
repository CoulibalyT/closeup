/**
 * Zoom points for a face, from the prototype's validated geometry. Everything is measured in eye
 * distances `d`, along the perpendicular to the eye axis, so a tilted head still works.
 *
 * Shared on purpose: the worker uses it when it only trusts the eyes of a detection, and the
 * admin uses it as the manual fallback ("click both eyes") when detection fails.
 */

export interface Point {
  x: number;
  y: number;
}

export const FACE_ZONES = ['leftEye', 'rightEye', 'nose', 'mouth', 'chin', 'brow'] as const;
export type FaceZone = (typeof FACE_ZONES)[number];

export const FACE = {
  /**
   * Below this eye distance (pixels of the stored original) the closest crop is about 50 px
   * wide: blown up to a phone screen it is a blur, not a riddle.
   */
  minEyeDistancePx: 70,
  /** Distance from the middle of the eyes, in eye distances. Negative is towards the hair. */
  offsets: { nose: 0.62, mouth: 1.12, chin: 1.6, brow: -0.7 },
  /** Odds of being drawn for a round. Eyes are what people recognise: 4 chances out of 9. */
  weights: { leftEye: 2, rightEye: 2, nose: 1, mouth: 2, chin: 1, brow: 1 },
  /** No left or right in the wording: the viewer's left is the subject's right. */
  labels: {
    leftEye: { fr: 'un œil', en: 'an eye' },
    rightEye: { fr: 'un œil', en: 'an eye' },
    nose: { fr: 'le nez', en: 'the nose' },
    mouth: { fr: 'la bouche', en: 'the mouth' },
    chin: { fr: 'le menton', en: 'the chin' },
    brow: { fr: 'le front', en: 'the forehead' },
  },
} as const;

/** A zoom point nobody has accepted yet. Same units as `ZoomPoint`: pixels of the original. */
export interface ZoomPointProposal {
  zone: FaceZone;
  x: number;
  y: number;
  baseRadius: number;
  labelFr: string;
  labelEn: string;
  weight: number;
}

export const eyeDistance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

function proposal(zone: FaceZone, at: Point, baseRadius: number): ZoomPointProposal {
  return {
    zone,
    x: at.x,
    y: at.y,
    baseRadius,
    labelFr: FACE.labels[zone].fr,
    labelEn: FACE.labels[zone].en,
    weight: FACE.weights[zone],
  };
}

/**
 * Six proposals from the two eye centres, in whichever order they were clicked. `baseRadius` is
 * half the eye distance for every zone, which is what makes all faces zoom alike.
 */
export function fromEyes(first: Point, second: Point): ZoomPointProposal[] {
  // The one on the left of the picture first: the "down" direction depends on it.
  const [left, right] = first.x <= second.x ? [first, second] : [second, first];
  const d = eyeDistance(left, right);
  if (d === 0) return [];

  const middle = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  // Unit vector pointing from the eyes to the chin: the eye axis turned a quarter clockwise.
  const down = { x: -(right.y - left.y) / d, y: (right.x - left.x) / d };
  const along = (k: number): Point => ({
    x: middle.x + down.x * k * d,
    y: middle.y + down.y * k * d,
  });

  const radius = d / 2;
  return [
    proposal('leftEye', left, radius),
    proposal('rightEye', right, radius),
    proposal('nose', along(FACE.offsets.nose), radius),
    proposal('mouth', along(FACE.offsets.mouth), radius),
    proposal('chin', along(FACE.offsets.chin), radius),
    proposal('brow', along(FACE.offsets.brow), radius),
  ];
}

/**
 * The same six zones when a detector gave real landmarks: measured positions instead of the
 * prototype's ratios, the radius still tied to the eye distance.
 */
export function fromLandmarks(landmarks: Record<FaceZone, Point>): ZoomPointProposal[] {
  const radius = eyeDistance(landmarks.leftEye, landmarks.rightEye) / 2;
  if (radius === 0) return [];
  return FACE_ZONES.map((zone) => proposal(zone, landmarks[zone], radius));
}
