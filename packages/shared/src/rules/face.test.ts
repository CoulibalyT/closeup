import { describe, expect, it } from 'vitest';
import { FACE, fromEyes, fromLandmarks } from './face.js';

const byZone = (proposals: ReturnType<typeof fromEyes>) =>
  Object.fromEntries(proposals.map((p) => [p.zone, p]));

describe('fromEyes', () => {
  it('places the six zones of a level face in eye distances, as the prototype did', () => {
    const zones = byZone(fromEyes({ x: 400, y: 300 }, { x: 500, y: 300 }));

    expect(zones.leftEye).toMatchObject({ x: 400, y: 300 });
    expect(zones.rightEye).toMatchObject({ x: 500, y: 300 });
    expect(zones.nose).toMatchObject({ x: 450, y: 362 });
    expect(zones.mouth).toMatchObject({ x: 450, y: 412 });
    expect(zones.chin).toMatchObject({ x: 450, y: 460 });
    // The forehead is on the other side of the eyes.
    expect(zones.brow).toMatchObject({ x: 450, y: 230 });
  });

  it('gives every zone half the eye distance as its base radius', () => {
    const proposals = fromEyes({ x: 400, y: 300 }, { x: 500, y: 300 });
    expect(proposals.map((p) => p.baseRadius)).toEqual(Array(6).fill(50));
  });

  it('does not care in which order the eyes were clicked', () => {
    const a = fromEyes({ x: 400, y: 300 }, { x: 500, y: 300 });
    const b = fromEyes({ x: 500, y: 300 }, { x: 400, y: 300 });
    expect(b).toEqual(a);
  });

  it('follows a tilted head: the chin is below the eyes along their perpendicular', () => {
    // Eye axis at 45°, going down to the right: "down the face" goes down to the left.
    const d = Math.hypot(100, 100);
    const zones = byZone(fromEyes({ x: 400, y: 300 }, { x: 500, y: 400 }));
    expect(zones.chin!.x).toBeCloseTo(450 - (100 / d) * 1.6 * d);
    expect(zones.chin!.y).toBeCloseTo(350 + (100 / d) * 1.6 * d);
  });

  it('makes the eyes 4 chances out of 9, and words zones without left or right', () => {
    const proposals = fromEyes({ x: 400, y: 300 }, { x: 500, y: 300 });
    const total = proposals.reduce((sum, p) => sum + p.weight, 0);
    const eyes = proposals.filter((p) => p.zone.endsWith('Eye'));
    expect(total).toBe(9);
    expect(eyes.reduce((sum, p) => sum + p.weight, 0)).toBe(4);
    expect(eyes.map((p) => p.labelFr)).toEqual(['un œil', 'un œil']);
  });

  it('proposes nothing when both clicks land on the same spot', () => {
    expect(fromEyes({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual([]);
  });
});

describe('fromLandmarks', () => {
  it('keeps the measured positions and ties the radius to the eye distance', () => {
    const proposals = fromLandmarks({
      leftEye: { x: 100, y: 100 },
      rightEye: { x: 180, y: 100 },
      nose: { x: 141, y: 150 },
      mouth: { x: 140, y: 190 },
      chin: { x: 139, y: 235 },
      brow: { x: 140, y: 60 },
    });
    expect(byZone(proposals).nose).toMatchObject({ x: 141, y: 150, baseRadius: 40 });
    expect(proposals).toHaveLength(6);
  });

  it('shares its threshold with everyone who warns about small faces', () => {
    expect(FACE.minEyeDistancePx).toBe(70);
  });
});
