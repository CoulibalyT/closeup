import type { Point } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import type { DetectedFace } from './detector.js';
import { zonesFrom68 } from './face-api.detector.js';
import { assessFaces } from './proposals.js';

/** A level face whose eyes are `d` pixels apart, around (cx, cy). */
function face(d: number, cx = 1000, cy = 800, size = d * 3): DetectedFace {
  return {
    score: 0.9,
    box: { x: cx - size / 2, y: cy - size / 2, width: size, height: size },
    landmarks: {
      leftEye: { x: cx - d / 2, y: cy },
      rightEye: { x: cx + d / 2, y: cy },
      nose: { x: cx, y: cy + 0.6 * d },
      mouth: { x: cx, y: cy + 1.1 * d },
      chin: { x: cx, y: cy + 1.6 * d },
      brow: { x: cx, y: cy - 0.3 * d },
    },
  };
}

describe('assessFaces', () => {
  it('proposes six zoom points for one face that is large enough', () => {
    const result = assessFaces([face(200)]);
    expect(result).toMatchObject({ verdict: 'ok', faces: 1, eyeDistancePx: 200 });
    expect(result.proposals.map((p) => p.zone)).toEqual([
      'leftEye',
      'rightEye',
      'nose',
      'mouth',
      'chin',
      'brow',
    ]);
    // Every zone zooms alike: half the eye distance.
    expect(new Set(result.proposals.map((p) => p.baseRadius))).toEqual(new Set([100]));
  });

  it('puts the forehead above the eyebrows, where the landmarks stop', () => {
    const forehead = assessFaces([face(200)]).proposals.find((p) => p.zone === 'brow')!;
    // The detector's eyebrow is 0.3 d above the eyes; the forehead is 0.7 d above.
    expect(forehead.y).toBeCloseTo(800 - 0.7 * 200);
  });

  it('warns when there is no face, and proposes nothing', () => {
    expect(assessFaces([])).toEqual({
      verdict: 'none',
      faces: 0,
      eyeDistancePx: null,
      proposals: [],
    });
  });

  it('warns about several faces and proposes points for the largest one', () => {
    const result = assessFaces([face(80, 300, 300), face(240, 1500, 900), face(120, 800, 400)]);
    expect(result).toMatchObject({ verdict: 'several', faces: 3, eyeDistancePx: 240 });
    expect(result.proposals[0]).toMatchObject({ zone: 'leftEye', x: 1500 - 120, y: 900 });
  });

  it('warns when the eyes are less than 70 px apart: the closest crop would be a blur', () => {
    expect(assessFaces([face(69)]).verdict).toBe('small');
    expect(assessFaces([face(70)]).verdict).toBe('ok');
    // Still proposed: the admin decides.
    expect(assessFaces([face(69)]).proposals).toHaveLength(6);
  });
});

describe('zonesFrom68', () => {
  it('reads the zones from the standard 68-point layout', () => {
    const points: Point[] = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
    for (let i = 36; i < 42; i++) points[i] = { x: 100, y: 200 };
    for (let i = 42; i < 48; i++) points[i] = { x: 180, y: 200 };
    points[30] = { x: 140, y: 250 };
    for (let i = 48; i < 68; i++) points[i] = { x: 140, y: 290 };
    points[8] = { x: 140, y: 350 };
    points[19] = { x: 100, y: 170 };
    points[24] = { x: 180, y: 170 };

    expect(zonesFrom68(points)).toEqual({
      leftEye: { x: 100, y: 200 },
      rightEye: { x: 180, y: 200 },
      nose: { x: 140, y: 250 },
      mouth: { x: 140, y: 290 },
      // A quarter of the way from the jaw line back to the mouth.
      chin: { x: 140, y: 335 },
      brow: { x: 140, y: 170 },
    });
  });
});
