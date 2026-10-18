import { Inject, Injectable, Logger } from '@nestjs/common';
import { cropPlan, type FaceDetection, faceOf, publishBlockers, ZOOM } from '@closeup/shared';
import sharp from 'sharp';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.module.js';
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

  /**
   * Cuts again the crops of every card with a detected face, after a change in how its views are
   * framed. A card in play stays in play, one taken out stays out.
   */
  async recutFaces(onCard: (slug: string) => void): Promise<{ cards: number }> {
    const cards = await this.prisma.card.findMany({
      where: { detection: { not: Prisma.DbNull }, status: { in: ['LIVE', 'READY'] } },
      select: { id: true, slug: true, status: true, detection: true },
      orderBy: { slug: 'asc' },
    });
    let done = 0;
    for (const card of cards) {
      if (!faceOf(card.detection as FaceDetection | null)) continue;
      await this.processCard(card.id, card.status === 'LIVE');
      onCard(card.slug ?? card.id);
      done++;
    }
    return { cards: done };
  }

  /** The downscaled rendition shown on the reveal and in the admin. Never the original. */
  async renderReveal(imageId: string, original: Buffer): Promise<void> {
    const revealKey = storageKeys.reveal(imageId);
    await this.storage.put(
      revealKey,
      await sharp(original)
        .resize(REVEAL_MAX_PX, REVEAL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    );
    await this.prisma.imageAsset.update({ where: { id: imageId }, data: { revealKey } });
  }

  /**
   * `publish`: go live when nothing blocks it. The seed asks for it; the admin only when the
   * card was already live before its zoom points changed. Otherwise a finished card waits in
   * READY for someone to publish it.
   */
  async processCard(cardId: string, publish = false): Promise<{ crops: number; status: string }> {
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id: cardId },
      include: { image: true, zoomPoints: true, answers: true },
    });
    if (!card.image) throw new Error(`Card ${cardId} has no image`);
    const { image } = card;
    const original = await this.storage.read(image.originalKey);

    await this.renderReveal(image.id, original);

    // A face's wider views are framed on its eyes and nose, whatever point the round opens on.
    const face = faceOf(card.detection as FaceDetection | null);
    let crops = 0;
    for (const point of card.zoomPoints) {
      for (const planned of cropPlan(image, point, face)) {
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

    // One rule for every producer: a card goes live only when it can be played *and* credited.
    const answer = (locale: string) => card.answers.find((a) => a.locale === locale)?.text;
    const blockers = publishBlockers({
      hasImage: true,
      processing: false,
      rightsConfirmed: card.source !== 'UPLOAD' || card.rightsConfirmedAt !== null,
      credit: { author: card.creditAuthor, licence: card.creditLicence },
      answers: { fr: answer('fr'), en: answer('en') },
      points: card.zoomPoints.map(() => ({ cropsReady: true })),
    });
    const status =
      card.zoomPoints.length < 2 ? 'NEEDS_POINTS' : publish && !blockers.length ? 'LIVE' : 'READY';
    await this.prisma.card.update({ where: { id: cardId }, data: { status } });
    this.logger.log(`Card ${card.slug ?? cardId}: ${crops} crops, ${status}`);
    return { crops, status };
  }
}
