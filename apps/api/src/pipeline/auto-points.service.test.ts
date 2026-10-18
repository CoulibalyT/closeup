import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { CropService } from '../media/crop.service.js';
import type { StorageDriver } from '../media/storage.js';
import type { PrismaService } from '../prisma/prisma.module.js';
import { AutoPointsService } from './auto-points.service.js';
import { assessFaces } from './face/proposals.js';

const face = {
  score: 0.9,
  box: { x: 700, y: 500, width: 600, height: 600 },
  landmarks: {
    leftEye: { x: 900, y: 800 },
    rightEye: { x: 1100, y: 800 },
    nose: { x: 1000, y: 920 },
    mouth: { x: 1000, y: 1020 },
    chin: { x: 1000, y: 1120 },
    brow: { x: 1000, y: 740 },
  },
};

function setUp(card: object, picture = Buffer.alloc(0)) {
  const prisma = {
    card: { findUniqueOrThrow: vi.fn(async () => card), update: vi.fn(async () => card) },
  };
  const storage = { read: vi.fn(async () => picture) };
  const crops = {
    processCard: vi.fn(async (_id: string, publish: boolean) => ({
      crops: 20,
      status: publish ? 'LIVE' : 'READY',
    })),
  };
  const service = new AutoPointsService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageDriver,
    crops as unknown as CropService,
  );
  return { service, prisma, storage, crops };
}

describe('AutoPointsService', () => {
  it('gives a person with one clear face their four points and publishes when asked', async () => {
    const { service, prisma, crops } = setUp({
      isPerson: true,
      image: { width: 2000, height: 1600, originalKey: 'o' },
      detection: assessFaces([face]),
    });
    expect(await service.apply('c1', { publish: true })).toEqual({ status: 'LIVE' });
    const [{ data }] = prisma.card.update.mock.calls[0] as unknown as [
      { data: { zoomPoints: { create: unknown[] } } },
    ];
    expect(data.zoomPoints.create).toHaveLength(4);
    expect(crops.processCard).toHaveBeenCalledWith('c1', true);
  });

  it('says NO_FACE for a person without one, and leaves the card to the editor', async () => {
    const { service, prisma, crops } = setUp({
      isPerson: true,
      image: { width: 2000, height: 1600, originalKey: 'o' },
      detection: assessFaces([]),
    });
    expect(await service.apply('c1', { publish: true })).toEqual({
      status: 'NEEDS_POINTS',
      reason: 'NO_FACE',
    });
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { processingError: 'NO_FACE' },
    });
    expect(crops.processCard).not.toHaveBeenCalled();
  });

  it('measures an object picture, and says NO_DETAIL for a plain one', async () => {
    const flat = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer();
    const { service } = setUp(
      { isPerson: false, image: { width: 1200, height: 800, originalKey: 'o' }, detection: null },
      flat,
    );
    expect(await service.apply('c1', { publish: false })).toEqual({
      status: 'NEEDS_POINTS',
      reason: 'NO_DETAIL',
    });
  });
});
