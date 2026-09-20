import type { FaceZone, Point } from '@closeup/shared';

/** One face, in pixels of the image that was handed in. */
export interface DetectedFace {
  score: number;
  box: { x: number; y: number; width: number; height: number };
  landmarks: Record<FaceZone, Point>;
}

/**
 * The seam the brief asks for: the pipeline only knows this. Today it is face-api on the tfjs
 * WASM backend (`face-api.detector.ts`); `@vladmandic/human` or a MediaPipe sidecar could take
 * its place without touching anything else. A detector that cannot run throws, and the card
 * falls back to zoom points placed by hand.
 */
export interface FaceLandmarkDetector {
  detect(image: Buffer): Promise<DetectedFace[]>;
}

export const FACE_DETECTOR = Symbol('FACE_DETECTOR');
