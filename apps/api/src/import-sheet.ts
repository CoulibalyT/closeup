import './config/load-env.js';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { ConfigModule } from './config/app-config.js';
import { MediaModule } from './media/media.module.js';
import { STORAGE, type StorageDriver } from './media/storage.js';
import { PrismaModule, PrismaService } from './prisma/prisma.module.js';

/**
 * Every card of a pack on one sheet, its zoom points drawn as rings: how the owner judges a
 * batch of automatic points before trusting them at scale.
 *   PACK_ID=… pnpm --filter @closeup/api import:sheet   → sheet-<pack slug or id>.jpg
 */
@Module({ imports: [ConfigModule, PrismaModule, MediaModule] })
class SheetModule {}

const TILE = 300;
const COLUMNS = 8;
const packId = process.env.PACK_ID ?? '';
if (!packId) {
  console.error('Set PACK_ID.');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(SheetModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);
const storage = app.get<StorageDriver>(STORAGE);
const pack = await prisma.pack.findUniqueOrThrow({ where: { id: packId } });
const cards = await prisma.card.findMany({
  where: { packId, imageId: { not: null } },
  include: { image: true, zoomPoints: true, answers: true },
  orderBy: { createdAt: 'asc' },
});
const tiles = await Promise.all(
  cards.map(async (card, i) => {
    const image = card.image!;
    // The picture sits centred in its tile; the rings follow it.
    const scale = TILE / Math.max(image.width, image.height);
    const dx = (TILE - image.width * scale) / 2;
    const dy = (TILE - image.height * scale) / 2;
    const rings = card.zoomPoints
      .map((p) => {
        const at = `cx="${p.x * scale + dx}" cy="${p.y * scale + dy}" r="${p.baseRadius * 0.75 * scale}"`;
        return (
          `<circle ${at} fill="none" stroke="#fff" stroke-width="4"/>` +
          `<circle ${at} fill="none" stroke="#2742f5" stroke-width="2"/>`
        );
      })
      .join('');
    const label = (card.answers.find((a) => a.locale === 'fr')?.text ?? '').replace(/[<&]/g, '');
    const overlay =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}">${rings}` +
      `<rect y="${TILE - 22}" width="${TILE}" height="22" fill="#000a"/>` +
      `<text x="6" y="${TILE - 7}" font-family="sans-serif" font-size="13" fill="#fff">${label} · ${card.status}</text></svg>`;
    const picture = await sharp(await storage.read(image.originalKey))
      .resize(TILE, TILE, { fit: 'contain', background: '#222' })
      .composite([{ input: Buffer.from(overlay) }])
      .png()
      .toBuffer();
    return { input: picture, left: (i % COLUMNS) * TILE, top: Math.floor(i / COLUMNS) * TILE };
  }),
);
const rows = Math.ceil(cards.length / COLUMNS) || 1;
const output = `sheet-${pack.slug ?? pack.id}.jpg`;
await sharp({
  create: { width: COLUMNS * TILE, height: rows * TILE, channels: 3, background: '#222' },
})
  .composite(tiles)
  .jpeg({ quality: 82 })
  .toFile(output);
console.log(`${cards.length} cards -> ${output}`);
await app.close();
