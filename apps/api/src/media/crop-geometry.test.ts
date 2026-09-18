import { describe, expect, it } from 'vitest';
import { cropPlan, revealZone } from './crop-geometry.js';

const image = { width: 1000, height: 800 };

describe('cropPlan', () => {
  it('cuts one square per zoom level, centred on the point when there is room', () => {
    const plan = cropPlan(image, { x: 500, y: 400, baseRadius: 40 });
    expect(plan.map((c) => c.side)).toEqual([60, 108, 192, 336]);
    expect(plan[0]).toMatchObject({ left: 470, top: 370, focusX: 0.5, focusY: 0.5 });
  });

  it('says how much wider each level is than the previous one', () => {
    const plan = cropPlan(image, { x: 500, y: 400, baseRadius: 40 });
    expect(plan[0]!.scaleFromPrev).toBeNull();
    expect(plan[1]!.scaleFromPrev).toBeCloseTo(1.8);
    expect(plan[2]!.scaleFromPrev).toBeCloseTo(192 / 108);
    expect(plan[3]!.scaleFromPrev).toBeCloseTo(1.75);
  });

  it('shifts a crop that would leave the image, and moves the focus accordingly', () => {
    const plan = cropPlan(image, { x: 40, y: 780, baseRadius: 50 });
    const wide = plan[3]!;
    expect(wide).toMatchObject({ left: 0, top: 380, side: 420 });
    expect(wide.focusX).toBeCloseTo(40 / 420);
    expect(wide.focusY).toBeCloseTo((780 - 380) / 420);
  });

  it('never cuts a square larger than the image', () => {
    const plan = cropPlan({ width: 300, height: 200 }, { x: 150, y: 100, baseRadius: 60 });
    expect(plan[3]).toMatchObject({ left: 50, top: 0, side: 200 });
    // level 2 already hit the limit, so level 3 shows nothing more
    expect(plan[3]!.scaleFromPrev).toBeCloseTo(200 / 200);
  });

  it('works in whole pixels', () => {
    const plan = cropPlan(image, { x: 333.3, y: 222.7, baseRadius: 41.5 });
    for (const crop of plan) {
      expect(Number.isInteger(crop.left)).toBe(true);
      expect(Number.isInteger(crop.top)).toBe(true);
      expect(Number.isInteger(crop.side)).toBe(true);
      expect(crop.left + crop.side).toBeLessThanOrEqual(image.width);
      expect(crop.top + crop.side).toBeLessThanOrEqual(image.height);
    }
  });
});

describe('revealZone', () => {
  it('describes the first level as a circle, in fractions of the image', () => {
    // first level side = 75 px, so the circle radius is 37.5 px
    expect(revealZone(image, { x: 500, y: 400, baseRadius: 50 })).toEqual({
      cx: 0.5,
      cy: 0.5,
      r: 37.5 / 1000,
    });
  });
});
