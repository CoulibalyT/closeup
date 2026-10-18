import { describe, expect, it, vi } from 'vitest';
import { CropService } from './crop.service.js';

describe('CropService.recutFaces', () => {
  it('cuts again every card with a detected face, keeping it live or off as it was', async () => {
    const eyes = (x: number) => ({ zone: 'leftEye', x, y: 100, baseRadius: 50 });
    const face = {
      verdict: 'ok',
      proposals: [eyes(100), { ...eyes(200), zone: 'rightEye' }, { ...eyes(150), zone: 'nose' }],
    };
    const findMany = vi.fn().mockResolvedValue([
      { id: 'live', slug: 'ds-a', status: 'LIVE', detection: face },
      { id: 'off', slug: 'ds-b', status: 'READY', detection: face },
      // Detection ran and found nothing: its points were placed by hand, nothing changes.
      { id: 'none', slug: 'ds-c', status: 'LIVE', detection: { verdict: 'none', proposals: [] } },
    ]);
    const service = new CropService({ card: { findMany } } as never, {} as never);
    const processCard = vi
      .spyOn(service, 'processCard')
      .mockResolvedValue({ crops: 12, status: 'LIVE' });
    const lines: string[] = [];

    const result = await service.recutFaces((slug) => lines.push(slug));

    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      detection: { not: expect.anything() },
      status: { in: ['LIVE', 'READY'] },
    });
    expect(processCard.mock.calls).toEqual([
      ['live', true],
      ['off', false],
    ]);
    expect(result).toEqual({ cards: 2 });
    expect(lines).toEqual(['ds-a', 'ds-b']);
  });
});
