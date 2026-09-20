// Runs the face landmark detector on one image and prints what the admin would be told:
//   pnpm --filter @closeup/api face:check path/to/portrait.jpg
// A development tool. It needs a build (`pnpm --filter @closeup/api build`), and the image stays
// where it is: never commit a photo of a real person to this repository.
import { readFile } from 'node:fs/promises';
import { FaceApiDetector } from '../dist/pipeline/face/face-api.detector.js';
import { assessFaces } from '../dist/pipeline/face/proposals.js';

const [path] = process.argv.slice(2);
if (!path) {
  console.error('usage: face:check <image>');
  process.exit(1);
}

const started = Date.now();
const detector = new FaceApiDetector();
const faces = await detector.detect(await readFile(path));
console.log(`${faces.length} face(s) in ${Date.now() - started} ms (models included)`);
console.log(JSON.stringify(assessFaces(faces), null, 2));
