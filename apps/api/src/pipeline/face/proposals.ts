import {
  eyeDistance,
  FACE,
  type FaceDetection,
  fromEyes,
  fromLandmarks,
  ZOOM_POINTS,
} from '@closeup/shared';
import type { DetectedFace } from './detector.js';

const area = (face: DetectedFace) => face.box.width * face.box.height;

/**
 * What the admin is told about the faces of an image, and the zoom points proposed for the
 * largest one. Nothing is refused here: no face, several faces or a small face are warnings, and
 * placing the points by hand always remains possible.
 */
export function assessFaces(faces: DetectedFace[]): FaceDetection {
  const main = [...faces].sort((a, b) => area(b) - area(a))[0];
  if (!main) return { verdict: 'none', faces: 0, eyeDistancePx: null, proposals: [] };

  const { leftEye, rightEye } = main.landmarks;
  const d = eyeDistance(leftEye, rightEye);
  // The 68 landmarks stop at the eyebrows: the forehead keeps the prototype's ratio.
  const forehead = fromEyes(leftEye, rightEye).find((p) => p.zone === 'brow');
  const proposals = fromLandmarks(main.landmarks).map((proposal) =>
    proposal.zone === 'brow' && forehead ? forehead : proposal,
  );

  const verdict = faces.length > 1 ? 'several' : d < FACE.minEyeDistancePx ? 'small' : 'ok';
  return { verdict, faces: faces.length, eyeDistancePx: Math.round(d), proposals };
}

/**
 * Of the six zones, the right eye goes (two eyes side by side would make the same round) and so
 * does the forehead: its first close-up is bare skin, which nobody can recognise.
 */
const AUTO_ZONES: readonly string[] = ['leftEye', 'nose', 'mouth', 'chin'];

/**
 * The zoom points of an imported person, when the detector is sure of one clear face; null when
 * the admin has to look (no face, several, a small one, no detector). An upload never comes
 * here: its admin places or accepts the points in the editor.
 */
export function autoZoomPoints(
  detection: FaceDetection | null,
  size: { width: number; height: number },
) {
  if (detection?.verdict !== 'ok') return null;
  const points = detection.proposals
    .filter((p) => AUTO_ZONES.includes(p.zone))
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height)
    .slice(0, ZOOM_POINTS.max)
    .map((p) => ({
      x: p.x,
      y: p.y,
      baseRadius: Math.max(4, p.baseRadius),
      labelFr: p.labelFr,
      labelEn: p.labelEn,
      weight: p.weight,
      origin: 'AUTO' as const,
    }));
  return points.length >= ZOOM_POINTS.min ? points : null;
}
