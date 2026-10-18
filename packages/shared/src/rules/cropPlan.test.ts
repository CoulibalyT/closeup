import { describe, expect, it } from 'vitest';
import { cropPlan, faceOf, revealZone } from './cropPlan.js';

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
    // The focus is where the zoom-out grows from so that the previous square lines up: here the
    // previous one (240 px) sits at the bottom left corner of this one.
    expect(wide.focusX).toBeCloseTo(0);
    expect(wide.focusY).toBeCloseTo(1);
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

describe('cropPlan on a face', () => {
  // Eyes 100 px apart, the nose 62 px below their middle, the mouth 112 px below.
  const big = { width: 2000, height: 2000 };
  const face = {
    leftEye: { x: 950, y: 900 },
    rightEye: { x: 1050, y: 900 },
    nose: { x: 1000, y: 962 },
  };
  const eye = { x: 950, y: 900, baseRadius: 50 };
  const mouth = { x: 1000, y: 1012, baseRadius: 50 };
  const centre = (c: { left: number; top: number; side: number }) => ({
    x: c.left + c.side / 2,
    y: c.top + c.side / 2,
  });

  it('opens on the detail, then an eye and the nose, then both eyes, then the eyes and the nose', () => {
    const plan = cropPlan(big, eye, face);
    // Normal: 1, 1.3 and 1.7 eye distances after the opening detail.
    expect(plan.map((c) => c.side)).toEqual([75, 100, 130, 170]);
    expect(Math.abs(centre(plan[0]!).x - 950)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(plan[0]!).y - 900)).toBeLessThanOrEqual(1);
    // Each wider view moves towards its landmarks as far as keeping the last one whole allows.
    expect(centre(plan[1]!).x).toBeGreaterThan(950);
    expect(centre(plan[1]!).y).toBeGreaterThan(900);
    expect(centre(plan[2]!).x).toBeGreaterThan(centre(plan[1]!).x);
    expect(Math.abs(centre(plan[3]!).x - 1000)).toBeLessThanOrEqual(15);
    expect(Math.abs(centre(plan[3]!).y - 931)).toBeLessThanOrEqual(15);
  });

  it('frames easy wider and hard tighter, from the same opening detail', () => {
    const sides = (difficulty: 'easy' | 'normal' | 'hard') =>
      cropPlan(big, eye, face, difficulty).map((c) => c.side);
    expect(sides('easy')).toEqual([75, 115, 150, 200]);
    expect(sides('hard')).toEqual([75, 90, 115, 150]);
  });

  it('pairs the nose with an eye, and keeps every view inside the next one', () => {
    for (const start of [eye, mouth, { x: 1000, y: 962, baseRadius: 50 }]) {
      const plan = cropPlan(big, start, face);
      for (let level = 1; level < plan.length; level++) {
        const [a, b] = [plan[level - 1]!, plan[level]!];
        expect(a.left).toBeGreaterThanOrEqual(b.left);
        expect(a.top).toBeGreaterThanOrEqual(b.top);
        expect(a.left + a.side).toBeLessThanOrEqual(b.left + b.side);
        expect(a.top + a.side).toBeLessThanOrEqual(b.top + b.side);
      }
    }
  });

  it('grows each view from the point that lines it up with the previous one', () => {
    const plan = cropPlan(big, mouth, face);
    for (let level = 1; level < plan.length; level++) {
      const [a, b] = [plan[level - 1]!, plan[level]!];
      const s = b.scaleFromPrev!;
      // Scaled by s around the focus, the previous square fills the lens exactly.
      const at = (edge: number, origin: number) => origin + s * (edge - origin);
      expect(at((a.left - b.left) / b.side, b.focusX)).toBeCloseTo(0, 2);
      expect(at((a.left + a.side - b.left) / b.side, b.focusX)).toBeCloseTo(1, 2);
      expect(at((a.top - b.top) / b.side, b.focusY)).toBeCloseTo(0, 2);
    }
  });

  it('frames a point that is not on this face the usual way', () => {
    const elsewhere = { x: 300, y: 300, baseRadius: 50 };
    expect(cropPlan(big, elsewhere, face)).toEqual(cropPlan(big, elsewhere));
    expect(cropPlan(big, elsewhere, face, 'hard')).toEqual(cropPlan(big, elsewhere));
  });

  it('reads the eyes and the nose from a detection, and nothing from no detection', () => {
    const proposal = (zone: string, x: number, y: number) => ({
      zone,
      x,
      y,
      baseRadius: 50,
      labelFr: '',
      labelEn: '',
      weight: 1,
    });
    expect(
      faceOf({
        verdict: 'ok',
        faces: 1,
        eyeDistancePx: 100,
        proposals: [
          proposal('leftEye', 950, 900),
          proposal('rightEye', 1050, 900),
          proposal('nose', 1000, 962),
        ],
      } as never),
    ).toEqual(face);
    expect(faceOf(null)).toBeNull();
    expect(faceOf({ verdict: 'none', faces: 0, eyeDistancePx: null, proposals: [] })).toBeNull();
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
