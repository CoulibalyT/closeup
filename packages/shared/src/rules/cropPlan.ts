import { ZOOM } from '../constants/game.js';
import type { FaceDetection } from '../schemas/admin.js';
import type { Point } from './face.js';
import { cropSidePx } from './zoom.js';

export interface ImageSize {
  width: number;
  height: number;
}

export interface ZoomPointGeometry {
  x: number;
  y: number;
  baseRadius: number;
}

export interface PlannedCrop {
  level: number;
  left: number;
  top: number;
  side: number;
  /**
   * Where the zoom-out grows from (0..1 of this crop): scaled up around it, the previous level
   * fills the lens exactly. On the zoom point while the views stay centred on it.
   */
  focusX: number;
  focusY: number;
  /** How much wider this crop is than the previous level: drives the zoom-out animation. */
  scaleFromPrev: number | null;
}

/** The landmarks the views of a face are framed on, in pixels of the original. */
export interface FaceLandmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
}

/**
 * Views of a face, in eye distances, after the opening detail: an eye (or the detail) with the
 * nose, then both eyes, then the eyes and the nose. Each view shows something the last did not.
 */
const FACE_SIDES = [1.6, 2.1, 2.7];
/** A view at least this much wider than the previous one, or it would not read as a zoom-out. */
const MIN_GROWTH = 1.15;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The eyes and the nose of a detected face, or null when nothing usable was found. */
export function faceOf(detection: FaceDetection | null | undefined): FaceLandmarks | null {
  const at = (zone: string) => detection?.proposals.find((p) => p.zone === zone);
  const [leftEye, rightEye, nose] = [at('leftEye'), at('rightEye'), at('nose')];
  if (!leftEye || !rightEye || !nose) return null;
  const point = (p: Point): Point => ({ x: p.x, y: p.y });
  return { leftEye: point(leftEye), rightEye: point(rightEye), nose: point(nose) };
}

/** Centre and side of each view: on a face, its landmarks; anywhere else, the point. */
function views(
  point: ZoomPointGeometry,
  face: FaceLandmarks | null,
): { at: Point; side: number }[] {
  const first = { at: point, side: cropSidePx(point.baseRadius, 0) };
  const d = face ? distance(face.leftEye, face.rightEye) : 0;
  // A point away from this face (another person in the picture) keeps the usual framing.
  if (!face || d === 0 || distance(point, face.nose) > 1.5 * d) {
    return [
      first,
      ...[1, 2, 3].map((level) => ({ at: point, side: cropSidePx(point.baseRadius, level) })),
    ];
  }
  const eyes = mid(face.leftEye, face.rightEye);
  // The nose goes with the closer eye; anything else goes with the nose.
  const onNose =
    distance(point, face.nose) <
    Math.min(distance(point, face.leftEye), distance(point, face.rightEye));
  const closerEye =
    distance(point, face.leftEye) <= distance(point, face.rightEye) ? face.leftEye : face.rightEye;
  const partner = onNose ? closerEye : face.nose;
  const centres = [mid(point, partner), eyes, mid(eyes, face.nose)];
  const out: { at: Point; side: number }[] = [first];
  for (const [i, at] of centres.entries()) {
    out.push({ at, side: Math.max(FACE_SIDES[i]! * d, out[i]!.side * MIN_GROWTH) });
  }
  return out;
}

/**
 * Shared on purpose: the worker cuts the real crops with it, and the admin draws its live preview
 * of the four levels with it. One function, so what is previewed is what gets played.
 *
 * One square per zoom level, as in the prototype: never larger than the image, and shifted
 * rather than shrunk when the point is near an edge.
 */
export function cropPlan(
  image: ImageSize,
  point: ZoomPointGeometry,
  face: FaceLandmarks | null = null,
): PlannedCrop[] {
  const plan: PlannedCrop[] = [];
  for (const [level, view] of views(point, face)
    .slice(0, ZOOM.maxLevel + 1)
    .entries()) {
    const side = Math.round(Math.min(view.side, image.width, image.height));
    const previous = plan[level - 1];
    let left = view.at.x - side / 2;
    let top = view.at.y - side / 2;
    if (previous) {
      // Never lose what was already shown: the previous view stays inside this one.
      left = clamp(left, previous.left + previous.side - side, previous.left);
      top = clamp(top, previous.top + previous.side - side, previous.top);
    }
    left = Math.round(clamp(left, 0, image.width - side));
    top = Math.round(clamp(top, 0, image.height - side));
    const scale = previous ? side / previous.side : null;
    // Scaled by `scale` around the focus, the previous view must fill the lens: the focus is
    // s·p / (s − 1), p being where the previous view starts inside this one.
    const origin = (start: number, prevStart: number, at: number) =>
      scale && scale > 1
        ? clamp(((prevStart - start) / side) * (scale / (scale - 1)), 0, 1)
        : clamp((at - start) / side, 0, 1);
    plan.push({
      level,
      left,
      top,
      side,
      focusX: origin(left, previous?.left ?? 0, point.x),
      focusY: origin(top, previous?.top ?? 0, point.y),
      scaleFromPrev: scale,
    });
  }
  return plan;
}

/** The area shown first, as the circle drawn on the reveal. Fractions of the image width/height. */
export function revealZone(image: ImageSize, point: ZoomPointGeometry) {
  return {
    cx: point.x / image.width,
    cy: point.y / image.height,
    r: cropSidePx(point.baseRadius, 0) / 2 / image.width,
  };
}
