import { describe, expect, it } from 'vitest';
import { cropSidePx, zoomLevelAt } from './zoom.js';

describe('zoomLevelAt', () => {
  it('follows the automatic schedule: 0 s, 10 s, 20 s', () => {
    expect(zoomLevelAt(0)).toBe(0);
    expect(zoomLevelAt(9_999)).toBe(0);
    expect(zoomLevelAt(10_000)).toBe(1);
    expect(zoomLevelAt(19_999)).toBe(1);
    expect(zoomLevelAt(20_000)).toBe(2);
    expect(zoomLevelAt(30_000)).toBe(2);
  });

  it('never reaches the last level without a bonus', () => {
    expect(zoomLevelAt(29_999, 0)).toBe(2);
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
