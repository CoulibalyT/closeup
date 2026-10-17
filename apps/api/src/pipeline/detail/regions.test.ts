import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  cellEnergies,
  detailZoomPoints,
  type GreyImage,
  objectRadius,
  pickDetailRegions,
} from './regions.js';

/** A grey picture `w` × `h`, flat at 128, with textured squares (a 2 px checkerboard) where asked. */
function grey(w: number, h: number, squares: { x: number; y: number; side: number }[]): GreyImage {
  const data = new Uint8Array(w * h).fill(128);
  for (const { x, y, side } of squares) {
    for (let j = y; j < y + side; j++) {
      for (let i = x; i < x + side; i++) {
        data[j * w + i] = ((i >> 1) + (j >> 1)) % 2 ? 230 : 30;
      }
    }
  }
  return { data, width: w, height: h };
}

describe('cellEnergies', () => {
  it('is zero on a flat picture and high where there is texture', () => {
    const flat = cellEnergies(grey(100, 100, []), 10);
    expect(Math.max(...flat.energy)).toBe(0);
    const spot = cellEnergies(grey(100, 100, [{ x: 40, y: 40, side: 20 }]), 10);
    const best = spot.energy.indexOf(Math.max(...spot.energy));
    // The textured square covers cells (4,4) to (5,5) of a 10 × 10 grid.
    expect([44, 45, 54, 55]).toContain(best);
    expect(Math.max(...spot.energy)).toBeGreaterThan(0.1);
  });
});

describe('pickDetailRegions', () => {
  const size = { width: 1000, height: 1000 };

  it('puts its points inside the textured square, never more than five', () => {
    const points = pickDetailRegions(grey(100, 100, [{ x: 30, y: 30, side: 40 }]), size, 60)!;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBeLessThanOrEqual(5);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(300);
      expect(p.x).toBeLessThanOrEqual(700);
      expect(p.y).toBeGreaterThanOrEqual(300);
      expect(p.y).toBeLessThanOrEqual(700);
    }
  });

  it('gives nothing for a flat picture', () => {
    expect(pickDetailRegions(grey(100, 100, []), size, 60)).toBeNull();
  });

  it('keeps two textured spots apart, one point each', () => {
    const points = pickDetailRegions(
      grey(100, 100, [
        { x: 10, y: 10, side: 10 },
        { x: 80, y: 80, side: 10 },
      ]),
      size,
      60,
    )!;
    expect(points).toHaveLength(2);
    const [a, b] = points;
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(2.5 * 60);
  });

  it('stays a radius away from the edges of a wide panorama', () => {
    const img = grey(200, 50, [
      { x: 0, y: 0, side: 50 },
      { x: 150, y: 0, side: 50 },
    ]);
    const points = pickDetailRegions(img, { width: 4000, height: 1000 }, 60) ?? [];
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(60);
      expect(p.x).toBeLessThanOrEqual(4000 - 60);
      expect(p.y).toBeGreaterThanOrEqual(60);
      expect(p.y).toBeLessThanOrEqual(1000 - 60);
    }
  });
});

describe('detailZoomPoints', () => {
  it('reads a real picture and returns house-scale points', async () => {
    // A 60 px checkerboard in the middle: still sharp edges once the picture is 96 px wide.
    const squares = Array.from({ length: 36 }, (_, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      return (col + row) % 2
        ? ''
        : `<rect x="${420 + col * 60}" y="${220 + row * 60}" width="60" height="60"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
      <rect width="1200" height="800" fill="#ddd"/><g fill="#222">${squares}</g></svg>`;
    const picture = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const points = (await detailZoomPoints(picture, { width: 1200, height: 800 }))!;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]).toMatchObject({
      baseRadius: objectRadius({ width: 1200, height: 800 }),
      weight: 1,
      origin: 'AUTO',
      labelFr: null,
    });
    expect(objectRadius({ width: 1200, height: 800 })).toBe(48);
  });

  it('returns null for a plain colour', async () => {
    const flat = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer();
    expect(await detailZoomPoints(flat, { width: 1200, height: 800 })).toBeNull();
  });
});

import { SEED_PACKS } from '../../seed/cards.js';
import { SIZE } from '../../seed/svg.js';

describe('on the hand-drawn seed cards', () => {
  it('lands at least one point near a hand-placed one on most of them', async () => {
    const cards = SEED_PACKS.flatMap((pack) => pack.cards);
    let near = 0;
    for (const card of cards) {
      const picture = await sharp(Buffer.from(card.draw())).resize(SIZE, SIZE).jpeg().toBuffer();
      const points = (await detailZoomPoints(picture, { width: SIZE, height: SIZE })) ?? [];
      const close = points.some((p) =>
        card.points.some((h) => Math.hypot(h.x - p.x, h.y - p.y) <= 1.5 * h.baseRadius),
      );
      if (close) near++;
    }
    // Measured on 2026-10-17: 15 of 22. A change to the heuristic shows here first.
    expect(near).toBeGreaterThanOrEqual(15);
  });
});
