import { describe, expect, it } from 'vitest';
import { playableWhere } from './playable.js';

describe('playableWhere', () => {
  it('keeps restricted packs out of the public queue, whatever publicMatchSafe says', () => {
    expect(playableWhere({ kind: 'public' })).toEqual({
      status: 'LIVE',
      pack: { visibility: 'PUBLIC', publicMatchSafe: true, restricted: false },
    });
  });

  it('deals every published pack, restricted ones included, to a room that chose none', () => {
    expect(playableWhere({ kind: 'room', hostPlayerId: 'p1' })).toEqual({
      status: 'LIVE',
      pack: {
        OR: [
          { visibility: 'PUBLIC' },
          { ownerId: 'p1', visibility: { in: ['PRIVATE', 'PENDING_REVIEW', 'PUBLIC'] } },
        ],
      },
    });
  });

  it('lets a room draw a restricted pack once its host chose it', () => {
    expect(playableWhere({ kind: 'room', packIds: ['a', 'b'] })).toEqual({
      status: 'LIVE',
      pack: { id: { in: ['a', 'b'] }, OR: [{ visibility: 'PUBLIC' }] },
    });
  });
});
