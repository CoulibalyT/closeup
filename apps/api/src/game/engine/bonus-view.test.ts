import { roundLevelSchema } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import { SECRETS } from '../../testing/cards.js';
import { Party } from '../../testing/party.js';
import {
  bonusReply,
  eventToWire,
  maskInitials,
  recipientOf,
  type Sign,
  toSnapshot,
} from './view.js';

const sign: Sign = (kind, id) => `/api/media/${kind}-${Buffer.from(id).toString('hex')}`;

describe('maskInitials', () => {
  it('keeps first letters and word lengths, nothing else', () => {
    expect(maskInitials('tour Eiffel')).toBe('T···  E·····');
    expect(maskInitials('œuf au plat')).toBe('Œ··  A·  P···');
    expect(maskInitials('  kiwi ')).toBe('K···');
  });
});

describe('what others may know about your bonuses', () => {
  it('is how many you hold, never which ones', () => {
    const party = new Party();
    party.give('p1', 'shield', 'stealPoints');

    const theirs = toSnapshot(party.state, 'p2', sign);
    expect(theirs.players.find((p) => p.id === 'p1')?.bonusCount).toBe(2);
    expect(theirs.inventory).toEqual([]);
    // `"shielded"` is the viewer's own flag; what must not appear is someone else's item.
    expect(JSON.stringify(theirs)).not.toMatch(/"shield"|"stealPoints"|item-/);

    const mine = toSnapshot(party.state, 'p1', sign);
    expect(mine.inventory.map((item) => item.type)).toEqual(['shield', 'stealPoints']);
  });

  it('sends a granted bonus to its owner only', () => {
    const party = new Party();
    party.guess('p2', 1_000);
    const granted = party.effects.flatMap((e) =>
      e.type === 'emit' && e.event.type === 'bonusGranted' ? [e] : [],
    );
    expect(granted).toHaveLength(1);
    expect(granted[0]!.to).toBe('p2');
    expect(recipientOf(granted[0]!.event)).toBe('p2');
    expect(eventToWire(party.state, granted[0]!.event, sign)?.event).toBe('bonus:granted');
  });
});

describe('hints', () => {
  it('are derived on the server and never contain the answer', () => {
    const party = new Party({ secret: true });
    const [initials, category, second] = party.give('p1', 'initials', 'category', 'secondZone');
    expect(toSnapshot(party.state, 'p1', sign, party.start + 500).round!.hints).toEqual({
      removedOptionIds: [],
    });

    party.use('p1', initials!, 1_000);
    party.use('p1', category!, 1_100);
    party.use('p1', second!, 1_200);
    const reply = bonusReply(party.state, 'p1', sign)!;

    expect(reply.hints.initials).toBe(maskInitials(SECRETS.answer));
    expect(reply.hints.category).toBe('FOOD');
    expect(reply.hints.secondZone?.url).toContain('/api/media/crop-');
    expect(reply.penalty).toBe(400);
    expect(JSON.stringify(reply)).not.toContain(SECRETS.answer);
    expect(JSON.stringify(reply)).not.toContain(SECRETS.cropId);

    // Somebody else's snapshot shows none of it.
    expect(toSnapshot(party.state, 'p2', sign, party.start + 1_300).round!.hints).toEqual({
      removedOptionIds: [],
    });
  });

  it('survive a reconnection, with the zoom level the bonus bought', () => {
    const party = new Party({ mcq: true });
    const [zoom, remove] = party.give('p1', 'zoomOut', 'removeTwo');
    party.use('p1', zoom!, 1_000);
    party.use('p1', remove!, 1_100);

    const snapshot = toSnapshot(party.state, 'p1', sign, party.start + 2_000);
    expect(snapshot.round!.crop?.level).toBe(1);
    expect(snapshot.round!.hints.removedOptionIds).toHaveLength(2);
    expect(toSnapshot(party.state, 'p2', sign, party.start + 2_000).round!.crop?.level).toBe(0);
  });

  it('turn a zoom-out into a private round:level', () => {
    const party = new Party();
    const [zoom] = party.give('p1', 'zoomOut');
    party.use('p1', zoom!, 1_000);
    const effect = party.effects.find((e) => e.type === 'emit' && e.event.type === 'personalLevel');
    if (effect?.type !== 'emit') throw new Error('no personalLevel effect');

    const message = eventToWire(party.state, effect.event, sign)!;
    expect(message.event).toBe('round:level');
    expect(roundLevelSchema.parse(message.payload).level).toBe(1);
    expect(effect.to).toBe('p1');
  });
});

describe('a malus in a snapshot', () => {
  it('shows on its target while it lasts', () => {
    const party = new Party();
    const [flip] = party.give('p1', 'flip');
    party.use('p1', flip!, 1_000, 'p2');

    const during = toSnapshot(party.state, 'p2', sign, party.start + 3_000);
    expect(during.round!.effect).toEqual({ type: 'flip', from: 'p1', until: party.start + 6_000 });
    expect(toSnapshot(party.state, 'p2', sign, party.start + 6_001).round!.effect).toBeUndefined();
    expect(toSnapshot(party.state, 'p3', sign, party.start + 3_000).round!.effect).toBeUndefined();
  });
});

describe('fixed points', () => {
  it('pays by order of arrival, whatever the clock says', () => {
    const party = new Party({ fixed: true });
    expect(party.guess('p2', 25_000)).toMatchObject({ data: { points: 1000 } });
    expect(party.guess('p3', 26_000)).toMatchObject({ data: { points: 800 } });
    expect(party.guess('p1', 29_000)).toMatchObject({ data: { points: 600 } });
    expect(toSnapshot(party.state, 'p1', sign).scoring).toBe('fixed');
  });

  it('still charges for bonuses and wrong picks', () => {
    const party = new Party({ fixed: true });
    const [zoom] = party.give('p1', 'zoomOut');
    party.use('p1', zoom!, 1_000);
    expect(party.guess('p1', 2_000)).toMatchObject({ data: { points: 850 } });
  });
});
