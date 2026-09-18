import './config/load-env.js';
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import { ConfigModule } from './config/app-config.js';
import { MediaModule } from './media/media.module.js';
import { STORAGE, type StorageDriver, storageKeys } from './media/storage.js';
import { bullRoot, MEDIA_QUEUE, MediaJob, mediaQueue } from './pipeline/media-queue.js';
import { PrismaModule, PrismaService } from './prisma/prisma.module.js';
import { SEED_CREDIT, SEED_PACKS, type SeedCard, type SeedCategory } from './seed/cards.js';
import { SIZE } from './seed/svg.js';

/**
 * Seeds the safe placeholder content. It is only the first *producer* of cards: like the admin
 * upload and the Wikimedia importer later, it stores an original, describes the card, and hands
 * it to the `card.process` job. Idempotent: an unchanged card is left alone.
 */

const RENDER_PX = 3200;
const SCALE = RENDER_PX / SIZE;

@Module({ imports: [ConfigModule, PrismaModule, MediaModule, bullRoot(), mediaQueue()] })
class SeedModule {}

const logger = new Logger('Seed');
const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);
const storage = app.get<StorageDriver>(STORAGE);
const queue = app.get<Queue>(getQueueToken(MEDIA_QUEUE));

async function seedCard(packId: string, category: SeedCategory, def: SeedCard): Promise<boolean> {
  const drawing = def.draw();
  // Image, zoom points and answers together: any change to the definition re-seeds the card.
  const sha256 = createHash('sha256')
    .update(drawing)
    .update(JSON.stringify([def.points, def.fr, def.en, def.difficulty, RENDER_PX]))
    .digest('hex');

  const existing = await prisma.card.findUnique({
    where: { packId_slug: { packId, slug: def.slug } },
    include: { image: true },
  });
  if (existing?.image?.sha256 === sha256 && existing.status === 'LIVE') return false;

  const png = await sharp(Buffer.from(drawing), { density: 72 * SCALE })
    .resize(RENDER_PX, RENDER_PX)
    .png({ compressionLevel: 9 })
    .toBuffer();

  const card = await prisma.card.upsert({
    where: { packId_slug: { packId, slug: def.slug } },
    create: { packId, slug: def.slug, category, source: 'SEED' },
    update: {},
  });
  const imageData = {
    width: RENDER_PX,
    height: RENDER_PX,
    mime: 'image/png',
    bytes: png.length,
    sha256,
  };
  const image = existing?.image
    ? await prisma.imageAsset.update({ where: { id: existing.image.id }, data: imageData })
    : await prisma.imageAsset.create({
        data: { ...imageData, originalKey: 'pending' },
      });
  const originalKey = storageKeys.original(image.id, 'png');
  await storage.put(originalKey, png);

  await prisma.$transaction([
    prisma.imageAsset.update({ where: { id: image.id }, data: { originalKey } }),
    prisma.zoomPoint.deleteMany({ where: { cardId: card.id } }),
    prisma.cardAnswer.deleteMany({ where: { cardId: card.id } }),
    prisma.card.update({
      where: { id: card.id },
      data: {
        imageId: image.id,
        difficulty: def.difficulty,
        status: 'PROCESSING',
        creditAuthor: SEED_CREDIT.author,
        creditLicence: SEED_CREDIT.licence,
        creditSourceUrl: SEED_CREDIT.sourceUrl,
        answers: {
          create: (['fr', 'en'] as const).map((locale) => ({
            locale,
            text: def[locale].text,
            aliases: def[locale].aliases ?? [],
          })),
        },
        zoomPoints: {
          create: def.points.map((point) => ({
            x: point.x * SCALE,
            y: point.y * SCALE,
            baseRadius: point.baseRadius * SCALE,
            labelFr: point.fr,
            labelEn: point.en,
            weight: point.weight ?? 1,
          })),
        },
      },
    }),
  ]);

  await queue.add(MediaJob.processCard, { cardId: card.id }, { attempts: 3, backoff: 2_000 });
  return true;
}

let queued = 0;
for (const pack of SEED_PACKS) {
  const data = {
    titleFr: pack.titleFr,
    titleEn: pack.titleEn,
    descriptionFr: pack.descriptionFr,
    descriptionEn: pack.descriptionEn,
    category: pack.category,
    visibility: 'PUBLIC' as const,
    publicMatchSafe: true,
  };
  const row = await prisma.pack.upsert({
    where: { slug: pack.slug },
    create: { slug: pack.slug, ...data },
    update: data,
  });
  for (const card of pack.cards) {
    if (await seedCard(row.id, pack.category, card)) queued++;
  }
}

const total = SEED_PACKS.reduce((n, pack) => n + pack.cards.length, 0);
logger.warn(`${total} seed cards checked, ${queued} sent to the image worker`);
await app.close();
