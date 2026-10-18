import { describe, expect, it } from 'vitest';
import { cutVariants, startPoints, startZoneOf } from './startPoint.js';

const face = {
  leftEye: { x: 950, y: 900 },
  rightEye: { x: 1050, y: 900 },
  nose: { x: 1000, y: 962 },
};
const eye = { id: 'eye', x: 950, y: 900, labelEn: 'an eye' };
const nose = { id: 'nose', x: 1000, y: 962, labelEn: 'the nose' };
const mouth = { id: 'mouth', x: 1000, y: 1012, labelEn: 'the mouth' };
const ids = (points: { id: string }[]) => points.map((p) => p.id);

describe('startZoneOf', () => {
  it('reads the zone from the label, or from the closest landmark of the face', () => {
    expect(startZoneOf(eye, face)).toBe('eye');
    expect(startZoneOf({ x: 1048, y: 905, labelEn: null }, face)).toBe('eye');
    expect(startZoneOf({ x: 1003, y: 958, labelEn: '' }, face)).toBe('nose');
    expect(startZoneOf({ x: 998, y: 1015, labelEn: null }, face)).toBe('mouth');
  });

  it('knows nothing of a point away from the face or without one', () => {
    expect(startZoneOf({ x: 200, y: 200, labelEn: null }, face)).toBeNull();
    expect(startZoneOf({ x: 200, y: 200, labelEn: null }, null)).toBeNull();
  });
});

describe('startPoints', () => {
  const points = [eye, nose, mouth];

  it('opens on an eye when easy, an eye or the nose when normal, anything when hard', () => {
    expect(ids(startPoints(points, 'easy', face))).toEqual(['eye']);
    expect(ids(startPoints(points, 'normal', face))).toEqual(['eye', 'nose']);
    expect(ids(startPoints(points, 'hard', face))).toEqual(['eye', 'nose', 'mouth']);
  });

  it('keeps every point of a picture that is not a face', () => {
    const detail = { id: 'hat', x: 10, y: 10, labelEn: null };
    expect(ids(startPoints([detail, { ...detail, id: 'boot' }], 'easy', null))).toEqual([
      'hat',
      'boot',
    ]);
  });

  it('falls back to every point rather than leave a card unplayable', () => {
    expect(ids(startPoints([mouth], 'easy', face))).toEqual(['mouth']);
  });
});

describe('cutVariants', () => {
  it('cuts a view set only for the difficulties that may open on the point', () => {
    expect(cutVariants(eye, face)).toEqual(['easy', 'normal', 'hard']);
    expect(cutVariants(nose, face)).toEqual(['normal', 'hard']);
    expect(cutVariants(mouth, face)).toEqual(['normal', 'hard']);
  });

  it('cuts one normal set for a point off any face', () => {
    expect(cutVariants({ x: 10, y: 10, labelEn: null }, null)).toEqual(['normal']);
  });
});
