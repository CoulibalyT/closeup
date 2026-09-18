// Renders every seed illustration into one contact sheet, to review the drawings and where the
// zoom points fall. Run after `pnpm --filter @closeup/api build`:
//   node scripts/seed-sheet.mjs [output.jpg]
import sharp from 'sharp';
import { SEED_PACKS } from '../dist/seed/cards.js';

const TILE = 300;
const COLUMNS = 6;
const cards = SEED_PACKS.flatMap((pack) => pack.cards);
const rows = Math.ceil(cards.length / COLUMNS);

const tiles = await Promise.all(
  cards.map(async (card, i) => {
    // First zoom level of each point, drawn as a ring on top of the illustration.
    const rings = card.points
      .map(
        (p) =>
          `<circle cx="${p.x}" cy="${p.y}" r="${p.baseRadius * 0.75}" fill="none" ` +
          `stroke="#fff" stroke-width="10"/><circle cx="${p.x}" cy="${p.y}" ` +
          `r="${p.baseRadius * 0.75}" fill="none" stroke="#2742f5" stroke-width="5"/>`,
      )
      .join('');
    const marked = card.draw().replace('</svg>', `${rings}</svg>`);
    return {
      input: await sharp(Buffer.from(marked)).resize(TILE, TILE).png().toBuffer(),
      left: (i % COLUMNS) * TILE,
      top: Math.floor(i / COLUMNS) * TILE,
    };
  }),
);

const output = process.argv[2] ?? 'seed-sheet.jpg';
await sharp({
  create: { width: COLUMNS * TILE, height: rows * TILE, channels: 3, background: '#ffffff' },
})
  .composite(tiles)
  .jpeg({ quality: 82 })
  .toFile(output);
console.log(`${cards.length} illustrations -> ${output}`);
