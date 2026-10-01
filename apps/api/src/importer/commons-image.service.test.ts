import { describe, expect, it, vi } from 'vitest';
import type { FaceDetection } from '@closeup/shared';
import type { CropService } from '../media/crop.service.js';
import type { StorageDriver } from '../media/storage.js';
import { assessFaces } from '../pipeline/face/proposals.js';
import type { IngestService } from '../pipeline/ingest.service.js';
import type { PrismaService } from '../prisma/prisma.module.js';
import { CommonsImageService } from './commons-image.service.js';
import type { CommonsFile, WikimediaApi } from './wikimedia.client.js';

const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Elephant.jpg';
const RENDITION =
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Elephant.jpg/2560px-Elephant.jpg';

type StoredCard = {
  isPerson: boolean;
  image: { width: number; height: number } | null;
  detection: FaceDetection | null;
};

function setUp(
  file: Partial<CommonsFile> | null,
  card: StoredCard = { isPerson: false, image: null, detection: null },
) {
  const wikimedia = {
    files: vi.fn(async () =>
      file
        ? new Map([
            [
              'Elephant.jpg',
              { url: ORIGINAL, thumbUrl: RENDITION, size: 1, ...file } as CommonsFile,
            ],
          ])
        : new Map(),
    ),
    download: vi.fn(async () => Buffer.from('bytes')),
  };
  const storage = { put: vi.fn(async () => undefined) };
  const ingest = { ingest: vi.fn(async () => ({ status: 'NEEDS_POINTS' })) };
  const prisma = {
    card: { findUniqueOrThrow: vi.fn(async () => card), update: vi.fn(async () => card) },
  };
  const crops = { processCard: vi.fn(async () => ({ crops: 25, status: 'READY' })) };
  const service = new CommonsImageService(
    wikimedia as unknown as WikimediaApi,
    storage as unknown as StorageDriver,
    ingest as unknown as IngestService,
    prisma as unknown as PrismaService,
    crops as unknown as CropService,
  );
  return { service, wikimedia, storage, ingest, prisma, crops };
}

describe('CommonsImageService', () => {
  it('downloads the original when it fits, then ingests it like an upload', async () => {
    const { service, wikimedia, storage, ingest } = setUp({ size: 4_000_000 });
    expect(await service.importImage('card-1', 'Elephant.jpg')).toEqual({ status: 'NEEDS_POINTS' });
    expect(wikimedia.download).toHaveBeenCalledWith(ORIGINAL);
    const [key] = storage.put.mock.calls[0] as unknown as [string];
    expect(ingest.ingest).toHaveBeenCalledWith('card-1', key);
  });

  it('takes the 2560 px rendition of an original over the size limit', async () => {
    const { service, wikimedia } = setUp({ size: 21_000_000 });
    await service.importImage('card-1', 'Elephant.jpg');
    expect(wikimedia.files).toHaveBeenCalledWith(['Elephant.jpg'], 2560);
    expect(wikimedia.download).toHaveBeenCalledWith(RENDITION);
  });

  it('downloads nothing from an address outside Commons, whatever the API said', async () => {
    const { service, wikimedia, ingest } = setUp({ url: 'https://10.0.0.1/internal', size: 1 });
    await expect(service.importImage('card-1', 'Elephant.jpg')).rejects.toThrow(
      'unexpected address',
    );
    expect(wikimedia.download).not.toHaveBeenCalled();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('fails the job when the file is gone, so that it is tried again and then given up', async () => {
    const { service } = setUp(null);
    await expect(service.importImage('card-1', 'Elephant.jpg')).rejects.toThrow('no longer');
  });

  it('gives an imported person with one clear face their points, and cuts the crops', async () => {
    const eyes = { leftEye: { x: 900, y: 800 }, rightEye: { x: 1100, y: 800 } };
    const detection = assessFaces([
      {
        score: 0.9,
        box: { x: 700, y: 500, width: 600, height: 600 },
        landmarks: {
          ...eyes,
          nose: { x: 1000, y: 920 },
          mouth: { x: 1000, y: 1020 },
          chin: { x: 1000, y: 1120 },
          brow: { x: 1000, y: 740 },
        },
      },
    ]);
    const { service, prisma, crops } = setUp(
      { size: 1 },
      { isPerson: true, image: { width: 2000, height: 1600 }, detection },
    );
    expect(await service.importImage('card-1', 'Elephant.jpg')).toEqual({
      crops: 25,
      status: 'READY',
    });
    const [update] = prisma.card.update.mock.calls[0] as unknown as [
      { data: { zoomPoints: { create: unknown[] } } },
    ];
    expect(update.data.zoomPoints.create).toHaveLength(5);
    expect(crops.processCard).toHaveBeenCalledWith('card-1', false);
  });

  it('leaves a person without a clear face, and anything else, to the editor', async () => {
    const person = setUp(
      { size: 1 },
      { isPerson: true, image: { width: 2000, height: 1600 }, detection: assessFaces([]) },
    );
    expect(await person.service.importImage('card-1', 'Elephant.jpg')).toEqual({
      status: 'NEEDS_POINTS',
    });
    expect(person.crops.processCard).not.toHaveBeenCalled();
    const object = setUp({ size: 1 });
    await object.service.importImage('card-1', 'Elephant.jpg');
    expect(object.crops.processCard).not.toHaveBeenCalled();
  });
});
