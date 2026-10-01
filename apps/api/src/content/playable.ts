import type { Prisma } from '../generated/prisma/client.js';

/** Who is asking for cards, and what they are allowed to be given. */
export type DeckScope =
  /** Public matchmaking: only what the owner marked safe for strangers. */
  | { kind: 'public' }
  /**
   * A solo or private room. Its host may draw from every published pack and from their own,
   * published or not — the brief's "playable in the creator's private rooms straight away".
   * `packIds` empty means every published pack that is not restricted (celebrities, characters).
   */
  | { kind: 'room'; hostPlayerId?: string; packIds?: string[] };

/**
 * The one place that decides which cards may be dealt. Every round re-runs it before it starts,
 * which is what makes disabling a pack immediate (phase 5) and a pack unpublished mid-game stop
 * appearing at once.
 */
export function playableWhere(scope: DeckScope): Prisma.CardWhereInput {
  if (scope.kind === 'public') {
    // Real people and fictional characters never play with strangers (the brief's isolation).
    return {
      status: 'LIVE',
      pack: { visibility: 'PUBLIC', publicMatchSafe: true, restricted: false },
    };
  }
  const allowed: Prisma.PackWhereInput[] = [{ visibility: 'PUBLIC' }];
  if (scope.hostPlayerId) {
    // Their own pack is theirs to play with, whatever the moderation queue is doing with it.
    allowed.push({
      ownerId: scope.hostPlayerId,
      visibility: { in: ['PRIVATE', 'PENDING_REVIEW', 'PUBLIC'] },
    });
  }
  // No pack chosen means every published pack except the restricted ones: a celebrity pack is
  // only dealt in a room whose host ticked it.
  const chosen = scope.packIds?.length ? { id: { in: scope.packIds } } : { restricted: false };
  return { status: 'LIVE', pack: { ...chosen, OR: allowed } };
}
