import { eyeDistance, FACE, type FaceDetection, fromEyes, fromLandmarks } from '@closeup/shared';
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
