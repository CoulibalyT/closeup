import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FaceDetection } from '@closeup/shared';
import { CropService } from '../media/crop.service.js';
import { STORAGE, type StorageDriver } from '../media/storage.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { detailZoomPoints } from './detail/regions.js';
import { autoZoomPoints } from './face/proposals.js';

/**
 * Zoom points nobody placed: a person's come from the face detector, anything else's from the
 * places of the picture with the most detail. Used for imported cards and dropped folders, never
 * for an upload made in the editor, where the admin decides. When nothing is found the card
 * keeps its picture, loses nothing, and says why in the admin.
 */
@Injectable()
export class AutoPointsService {
  private readonly logger = new Logger('AutoPoints');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly crops: CropService,
  ) {}

  async apply(
    cardId: string,
    options: { publish: boolean },
  ): Promise<{ status: string; reason?: 'NO_FACE' | 'NO_DETAIL' }> {
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id: cardId },
      include: { image: true },
    });
    if (!card.image) return { status: 'DRAFT' };

    const points = card.isPerson
      ? autoZoomPoints(card.detection as FaceDetection | null, card.image)
      : await detailZoomPoints(await this.storage.read(card.image.originalKey), card.image);
    if (!points) {
      const reason = card.isPerson ? 'NO_FACE' : 'NO_DETAIL';
      await this.prisma.card.update({ where: { id: cardId }, data: { processingError: reason } });
      this.logger.log(`Card ${cardId}: no automatic points (${reason})`);
      return { status: 'NEEDS_POINTS', reason };
    }
    await this.prisma.card.update({
      where: { id: cardId },
      data: { status: 'PROCESSING', processingError: null, zoomPoints: { create: points } },
    });
    const done = await this.crops.processCard(cardId, options.publish);
    return { status: done.status };
  }
}
