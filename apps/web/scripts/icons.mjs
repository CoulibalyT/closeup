// Renders the PNG icons some platforms still insist on, from the one SVG that defines the mark.
//   pnpm --filter @closeup/web icons
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const svg = await readFile(join(publicDir, 'icon.svg'));

await mkdir(publicDir, { recursive: true });
for (const size of [192, 512]) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(publicDir, `icon-${size}.png`));
}
// iOS ignores the manifest for the home-screen icon and reads this one.
await sharp(svg, { density: 384 })
  .resize(180, 180)
  .png({ compressionLevel: 9 })
  .toFile(join(publicDir, 'apple-touch-icon.png'));

// A small PNG for tabs that still ask for a favicon; the SVG covers everything else.
await writeFile(
  join(publicDir, 'favicon.png'),
  await sharp(svg, { density: 384 }).resize(48, 48).png({ compressionLevel: 9 }).toBuffer(),
);
console.log('icons written to apps/web/public');
