import { describe, expect, it } from 'vitest';
import { cropSidePx, zoomLevelAt } from './zoom.js';

describe('zoomLevelAt', () => {
  it('follows the automatic schedule: a 30-second round in quarters', () => {
    expect(zoomLevelAt(0)).toBe(0);
    expect(zoomLevelAt(7_499)).toBe(0);
    expect(zoomLevelAt(7_500)).toBe(1);
    expect(zoomLevelAt(15_000)).toBe(2);
    expect(zoomLevelAt(22_499)).toBe(2);
  });

  it('reaches the widest view, the whole face, at three quarters of the round', () => {
    expect(zoomLevelAt(22_500, 0)).toBe(3);
    expect(zoomLevelAt(30_000, 0)).toBe(3);
  });

  it('adds bonus levels and caps at the last level', () => {
    expect(zoomLevelAt(0, 1)).toBe(1);
    expect(zoomLevelAt(20_000, 1)).toBe(3);
    expect(zoomLevelAt(20_000, 4)).toBe(3);
  });

  it('treats a negative elapsed time as the first level', () => {
    expect(zoomLevelAt(-200)).toBe(0);
  });
});

describe('cropSidePx', () => {
  it('reproduces the prototype multipliers of the eye distance', () => {
    const eyeDistance = 100;
    const baseRadius = eyeDistance / 2;
    expect(cropSidePx(baseRadius, 0)).toBeCloseTo(75);
    expect(cropSidePx(baseRadius, 1)).toBeCloseTo(135);
    expect(cropSidePx(baseRadius, 2)).toBeCloseTo(240);
    expect(cropSidePx(baseRadius, 3)).toBeCloseTo(420);
  });

  it('rejects an unknown level', () => {
    expect(() => cropSidePx(50, 4)).toThrow(RangeError);
  });
});
