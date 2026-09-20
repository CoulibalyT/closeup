import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { Point } from '@closeup/shared';
import sharp from 'sharp';
import type { DetectedFace, FaceLandmarkDetector } from './detector.js';

/**
 * face-api (the prototype's models, so the same feel) on the tfjs **WASM** backend. Why not
 * tfjs-node: no prebuilt binary for Node 22 and a broken build on Apple Silicon. Why not
 * MediaPipe: no Node support, it would mean a Python container and its memory. WASM has no
 * native binding at all; the models and the `.wasm` files come from the npm packages, nothing
 * is fetched from a CDN. Known limit: the face-api repository is archived (frozen since 2025).
 */

// Both packages are CommonJS bundles without usable ESM entry points for Node.
const require = createRequire(import.meta.url);

interface Tensor {
  dispose(): void;
}
interface Tf {
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
  tensor3d(values: Uint8Array, shape: [number, number, number], dtype: 'int32'): Tensor;
}
interface RawFace {
  detection: { score: number; box: { x: number; y: number; width: number; height: number } };
  landmarks: { positions: Point[] };
}
interface FaceApi {
  nets: Record<
    'tinyFaceDetector' | 'faceLandmark68TinyNet',
    { loadFromDisk(dir: string): Promise<void> }
  >;
  TinyFaceDetectorOptions: new (options: { inputSize: number; scoreThreshold: number }) => object;
  detectAllFaces(
    input: Tensor,
    options: object,
  ): { withFaceLandmarks(tiny: boolean): Promise<RawFace[]> };
}

/** Detection runs on a copy this large at most; coordinates are scaled back afterwards. */
const DETECTION_MAX_PX = 1280;
// The prototype's settings.
const INPUT_SIZE = 512;
const SCORE_THRESHOLD = 0.35;

const mean = (points: Point[]): Point => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

/** The standard 68-point layout: jaw 0-16, brows 17-26, nose 27-35, eyes 36-47, mouth 48-67. */
export function zonesFrom68(points: Point[]): DetectedFace['landmarks'] {
  const mouth = mean(points.slice(48, 68));
  const jaw = points[8]!;
  return {
    leftEye: mean(points.slice(36, 42)),
    rightEye: mean(points.slice(42, 48)),
    nose: points[30]!,
    mouth,
    // The jaw point sits on the outline: a crop centred there is half background.
    chin: { x: jaw.x + (mouth.x - jaw.x) * 0.25, y: jaw.y + (mouth.y - jaw.y) * 0.25 },
    brow: mean([points[19]!, points[24]!]),
  };
}

@Injectable()
export class FaceApiDetector implements FaceLandmarkDetector {
  private readonly logger = new Logger('FaceDetector');
  private loading?: Promise<{ tf: Tf; faceapi: FaceApi }>;

  /** Loaded on first use: most cards are not people, and the models cost memory. */
  private load(): Promise<{ tf: Tf; faceapi: FaceApi }> {
    this.loading ??= (async () => {
      const started = Date.now();
      const tf = require('@tensorflow/tfjs') as Tf;
      const wasm = require('@tensorflow/tfjs-backend-wasm') as {
        setWasmPaths(dir: string): void;
      };
      const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as FaceApi;

      const wasmFile = require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm');
      wasm.setWasmPaths(`${dirname(wasmFile)}/`);
      await tf.setBackend('wasm');
      await tf.ready();

      const models = join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      await faceapi.nets.tinyFaceDetector.loadFromDisk(models);
      await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(models);
      this.logger.log(`Models ready in ${Date.now() - started} ms`);
      return { tf, faceapi };
    })();
    // A failed load is not cached: the next card tries again.
    this.loading.catch(() => (this.loading = undefined));
    return this.loading;
  }

  async detect(image: Buffer): Promise<DetectedFace[]> {
    const { tf, faceapi } = await this.load();
    const { data, info } = await sharp(image)
      .rotate()
      .resize(DETECTION_MAX_PX, DETECTION_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    // `rotate()` applied the EXIF orientation: orientations 5 to 8 swap width and height.
    const meta = await sharp(image).metadata();
    const uprightWidth = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
    const scale = (uprightWidth ?? info.width) / info.width;

    const input = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
    try {
      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: INPUT_SIZE,
        scoreThreshold: SCORE_THRESHOLD,
      });
      const found = await faceapi.detectAllFaces(input, options).withFaceLandmarks(true);
      const up = (p: Point): Point => ({ x: p.x * scale, y: p.y * scale });
      return found.map(({ detection, landmarks }) => {
        const zones = zonesFrom68(landmarks.positions);
        return {
          score: detection.score,
          box: {
            x: detection.box.x * scale,
            y: detection.box.y * scale,
            width: detection.box.width * scale,
            height: detection.box.height * scale,
          },
          landmarks: Object.fromEntries(
            Object.entries(zones).map(([zone, point]) => [zone, up(point)]),
          ) as DetectedFace['landmarks'],
        };
      });
    } finally {
      input.dispose();
    }
  }
}
