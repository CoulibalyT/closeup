import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type FaceDetection, UPLOAD } from '@closeup/shared';
import { CropService } from '../media/crop.service.js';
import { STORAGE, type StorageDriver, storageKeys } from '../media/storage.js';
import { autoZoomPoints } from '../pipeline/face/proposals.js';
import { IngestService } from '../pipeline/ingest.service.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { isCommonsMediaUrl } from './commons-download.js';
import { WIKIMEDIA, type WikimediaApi } from './wikimedia.client.js';

/**
 * Commons' largest standard rendition. Asking for 3840 px was seen to return this same file:
 * Wikimedia rounds to its own steps.
 */
const RENDITION_WIDTH = 2560;

/**
 * The worker's half of an import: the picture of one card, from Commons to the same ingestion
 * as an upload (decode, strip metadata, resize, store). The job carries a file name, never an
 * address: the address is asked of Commons here, and checked before anything is downloaded. An
 * imported person whose picture shows one clear face comes out ready, its points placed.
 */
@Injectable()
export class CommonsImageService {
  constructor(
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly ingest: IngestService,
    private readonly prisma: PrismaService,
    private readonly crops: CropService,
  ) {}

  async importImage(cardId: string, file: string): Promise<{ status: string }> {
    const info = (await this.wikimedia.files([file], RENDITION_WIDTH)).get(file);
    if (!info) throw new Error(`Commons no longer describes ${file}`);
    // The original when it fits; a picture of 20 MB comes as its 2560 px rendition instead.
    const url = info.size <= UPLOAD.maxBytes ? info.url : info.thumbUrl;
    if (!url) throw new Error(`No rendition of ${file} small enough`);
    if (!isCommonsMediaUrl(url)) throw new Error(`Commons gave an unexpected address for ${file}`);

    const incomingKey = storageKeys.incoming(randomUUID());
    await this.storage.put(incomingKey, await this.wikimedia.download(url));
    const ingested = await this.ingest.ingest(cardId, incomingKey);
    if (ingested.status !== 'NEEDS_POINTS') return ingested;

    // The detector's points, the crops cut here, in the same job: ready without a click.
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id: cardId },
      include: { image: true },
    });
    const points =
      card.isPerson && card.image
        ? autoZoomPoints(card.detection as FaceDetection | null, card.image)
        : null;
    if (!points) return ingested;
    await this.prisma.card.update({
      where: { id: cardId },
      data: { status: 'PROCESSING', zoomPoints: { create: points } },
    });
    return this.crops.processCard(cardId, false);
  }
}
