import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZOOM } from '@closeup/shared';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.module.js';
import { cropPlan } from './crop-geometry.js';
import { STORAGE, type StorageDriver, storageKeys } from './storage.js';

const REVEAL_MAX_PX = 1280;

// One image at a time, no pixel cache: the worker shares a small VPS with everything else.
sharp.cache(false);
sharp.concurrency(1);

/**
 * Turns a card's private original into everything a round needs: the reveal rendition and one
 * WebP per zoom point × level × size. Only the worker (and the seed) load this, so `sharp`
 * never sits in the API's memory.
 */
@Injectable()
export class CropService {
  private readonly logger = new Logger('CropService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async processCard(cardId: string): Promise<{ crops: number; status: string }> {
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id: cardId },
      include: { image: true, zoomPoints: true, answers: true },
    });
    if (!card.image) throw new Error(`Card ${cardId} has no image`);
    const { image } = card;
    const original = await this.storage.read(image.originalKey);

    const revealKey = storageKeys.reveal(image.id);
    await this.storage.put(
      revealKey,
      await sharp(original)
        .resize(REVEAL_MAX_PX, REVEAL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    );
    await this.prisma.imageAsset.update({ where: { id: image.id }, data: { revealKey } });

    let crops = 0;
    for (const point of card.zoomPoints) {
      for (const planned of cropPlan(image, point)) {
        // A size larger than its source would only store blur.
        const sizes = ZOOM.cropSizesPx.filter((px, i) => i === 0 || planned.side >= px);
        for (const sizePx of sizes) {
          const data = await sharp(original)
            .extract({
              left: planned.left,
              top: planned.top,
              width: planned.side,
              height: planned.side,
            })
            .resize(sizePx, sizePx)
            .webp({ quality: 82 })
            .toBuffer();
          const storageKey = storageKeys.crop(point.id, planned.level, sizePx);
          await this.storage.put(storageKey, data);

          const row = {
            storageKey,
            focusX: planned.focusX,
            focusY: planned.focusY,
            scaleFromPrev: planned.scaleFromPrev,
            bytes: data.length,
          };
          await this.prisma.crop.upsert({
            where: {
              zoomPointId_level_sizePx: { zoomPointId: point.id, level: planned.level, sizePx },
            },
            create: { zoomPointId: point.id, level: planned.level, sizePx, ...row },
            update: row,
          });
          crops++;
        }
      }
    }

    // A card goes live only when it can be played *and* credited.
    const credited = Boolean(card.creditAuthor && card.creditLicence);
    const status =
      card.zoomPoints.length < 2
        ? 'NEEDS_POINTS'
        : credited && card.answers.length
          ? 'LIVE'
          : 'READY';
    await this.prisma.card.update({ where: { id: cardId }, data: { status } });
    this.logger.log(`Card ${card.slug ?? cardId}: ${crops} crops, ${status}`);
    return { crops, status };
  }
}
