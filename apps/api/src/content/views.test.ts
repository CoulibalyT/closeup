import { describe, expect, it } from 'vitest';
import { viewsFor } from './views.js';

const crop = (level: number, variant: string) => ({ id: `${variant}-${level}`, level, variant });
const four = (variant: string) => [3, 1, 0, 2].map((level) => crop(level, variant));

describe('viewsFor', () => {
  it('serves the views framed for the room difficulty, in level order', () => {
    const crops = [...four('normal'), ...four('hard'), ...four('easy')];
    expect(viewsFor(crops, 'hard')?.map((c) => c.id)).toEqual([
      'hard-0',
      'hard-1',
      'hard-2',
      'hard-3',
    ]);
  });

  it('falls back to the normal views of a point cut once (not a face)', () => {
    expect(viewsFor(four('normal'), 'easy')?.map((c) => c.id)).toEqual([
      'normal-0',
      'normal-1',
      'normal-2',
      'normal-3',
    ]);
  });

  it('has nothing to serve while a point is still being cut', () => {
    expect(viewsFor([crop(0, 'normal'), crop(1, 'normal')], 'normal')).toBeNull();
  });
});
