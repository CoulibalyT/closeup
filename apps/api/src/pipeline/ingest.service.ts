import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { checkDecodedImage, type FaceDetection, UPLOAD, type UploadError } from '@closeup/shared';
import sharp from 'sharp';
import type { Prisma } from '../generated/prisma/client.js';
import { CropService } from '../media/crop.service.js';
import { STORAGE, type StorageDriver, storageKeys } from '../media/storage.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { FACE_DETECTOR, type FaceLandmarkDetector } from './face/detector.js';
import { assessFaces } from './face/proposals.js';

/** A decompression bomb is a few kilobytes that decode to gigabytes: bound what sharp accepts. */
const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Second half of an upload, in the worker because it needs `sharp`: decode (the real proof that
 * the file is an image), strip every piece of metadata, resize, store the private original, and
 * for a person propose zoom points. The uploaded bytes themselves are never kept.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger('Ingest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crops: CropService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(FACE_DETECTOR) private readonly detector: FaceLandmarkDetector,
  ) {}

  async ingest(cardId: string, incomingKey: string): Promise<{ status: string }> {
    try {
      return await this.run(cardId, incomingKey);
    } finally {
      await this.storage.remove(incomingKey);
    }
  }

  private async run(cardId: string, incomingKey: string): Promise<{ status: string }> {
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id: cardId },
      include: { image: true, zoomPoints: { include: { crops: true } } },
    });
    const uploaded = await this.storage.read(incomingKey);

    const decoded = await this.normalise(uploaded);
    if ('error' in decoded) return this.refuse(cardId, card, decoded.error);
    const { data, width, height, extension } = decoded;

    // A new image makes the old zoom points meaningless: they and their crops go.
    for (const point of card.zoomPoints) {
      for (const crop of point.crops) await this.storage.remove(crop.storageKey);
    }
    if (card.image) await this.storage.remove(card.image.originalKey);

    const imageData = {
      width,
      height,
      mime: extension === 'png' ? 'image/png' : 'image/jpeg',
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
    const image = card.image
      ? await this.prisma.imageAsset.update({ where: { id: card.image.id }, data: imageData })
      : await this.prisma.imageAsset.create({ data: { ...imageData, originalKey: 'pending' } });
    const originalKey = storageKeys.original(image.id, extension);
    await this.storage.put(originalKey, data);
    await this.prisma.imageAsset.update({ where: { id: image.id }, data: { originalKey } });
    await this.crops.renderReveal(image.id, data);

    const detection = card.isPerson ? await this.detect(data) : null;
    await this.prisma.$transaction([
      this.prisma.zoomPoint.deleteMany({ where: { cardId } }),
      this.prisma.card.update({
        where: { id: cardId },
        data: {
          imageId: image.id,
          status: 'NEEDS_POINTS',
          processingError: null,
          detection: (detection ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    ]);
    this.logger.log(
      `Card ${cardId}: ${width}×${height} stored` +
        (detection ? `, faces: ${detection.verdict} (${detection.faces})` : ''),
    );
    return { status: 'NEEDS_POINTS' };
  }

  /**
   * Upright, without EXIF (sharp drops all metadata unless asked to keep it: no GPS position,
   * no camera serial number survives), and no larger than anything downstream needs.
   */
  private async normalise(
    uploaded: Buffer,
  ): Promise<
    | { data: Buffer; width: number; height: number; extension: 'png' | 'jpg' }
    | { error: UploadError }
  > {
    try {
      const source = () => sharp(uploaded, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const meta = await source().metadata();
      const problem = checkDecodedImage(meta);
      if (problem) return { error: problem };

      const upright = source()
        .rotate()
        .resize(UPLOAD.maxSidePx, UPLOAD.maxSidePx, { fit: 'inside', withoutEnlargement: true });
      // PNG stays PNG (drawings, transparency); everything else becomes a high-quality JPEG.
      const keepPng = meta.format === 'png';
      const { data, info } = await (
        keepPng ? upright.png({ compressionLevel: 9 }) : upright.jpeg({ quality: 92 })
      ).toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, extension: keepPng ? 'png' : 'jpg' };
    } catch (error) {
      this.logger.warn(`Upload could not be decoded: ${String(error)}`);
      return { error: 'UNREADABLE' };
    }
  }

  /** Detection is a convenience: whatever goes wrong, the card can still get points by hand. */
  private async detect(image: Buffer): Promise<FaceDetection> {
    try {
      return assessFaces(await this.detector.detect(image));
    } catch (error) {
      this.logger.warn(`Face detection unavailable: ${String(error)}`);
      return { verdict: 'unavailable', faces: 0, eyeDistancePx: null, proposals: [] };
    }
  }

  /** A job ran out of attempts (crash, missing file): release the card and say so. */
  async giveUp(cardId: string): Promise<void> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { zoomPoints: true },
    });
    // Crops may be half cut: never READY from here, cutting them again is one click away.
    if (card?.status === 'PROCESSING')
      await this.refuse(cardId, { ...card, zoomPoints: [] }, 'FAILED');
  }

  /** The previous image, if any, is untouched: the card goes back to where it stood. */
  private async refuse(
    cardId: string,
    card: { imageId: string | null; zoomPoints: unknown[] },
    error: UploadError,
  ): Promise<{ status: string }> {
    const status = !card.imageId ? 'DRAFT' : card.zoomPoints.length < 2 ? 'NEEDS_POINTS' : 'READY';
    await this.prisma.card.update({
      where: { id: cardId },
      data: { status, processingError: error },
    });
    this.logger.warn(`Card ${cardId}: upload refused (${error})`);
    return { status };
  }
}
