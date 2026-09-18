import { cropSidePx, ZOOM } from '@closeup/shared';

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
  /** Where the zoom point sits inside the crop (0..1). Off-centre once the crop was shifted. */
  focusX: number;
  focusY: number;
  /** How much wider this crop is than the previous level: drives the zoom-out animation. */
  scaleFromPrev: number | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * One square per zoom level, as in the prototype: never larger than the image, and shifted
 * rather than shrunk when the point is near an edge.
 */
export function cropPlan(image: ImageSize, point: ZoomPointGeometry): PlannedCrop[] {
  const plan: PlannedCrop[] = [];
  for (let level = 0; level <= ZOOM.maxLevel; level++) {
    const side = Math.round(
      Math.min(cropSidePx(point.baseRadius, level), image.width, image.height),
    );
    const left = Math.round(clamp(point.x - side / 2, 0, image.width - side));
    const top = Math.round(clamp(point.y - side / 2, 0, image.height - side));
    const previous = plan[level - 1];
    plan.push({
      level,
      left,
      top,
      side,
      focusX: clamp((point.x - left) / side, 0, 1),
      focusY: clamp((point.y - top) / side, 0, 1),
      scaleFromPrev: previous ? side / previous.side : null,
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
