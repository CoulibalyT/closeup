import type { BonusType } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import { Party } from '../../testing/party.js';
import { createRoom, reduce } from './reducer.js';

const refused = (code: string) => ({ ok: false, error: { code } });

describe('earning bonuses', () => {
  it('rewards every third correct answer in a row', () => {
    const party = new Party({ players: 2 });
    party.guess('p1', 1_000);
    party.finishRound();
    party.guess('p1', 1_000);
    expect(party.inventory('p1')).toHaveLength(0);
    party.finishRound();
    party.guess('p1', 1_000);

    expect(party.inventory('p1')).toHaveLength(1);
    expect(party.events('bonusGranted')).toMatchObject([
      { playerId: 'p1', reason: 'streak', sentTo: 'p1' },
    ]);
  });

  it('rewards the fastest of a round, from three players up', () => {
    const three = new Party();
    three.guess('p2', 2_000);
    three.guess('p1', 3_000);
    expect(three.events('bonusGranted')).toMatchObject([{ playerId: 'p2', reason: 'fastest' }]);

    const two = new Party({ players: 2 });
    two.guess('p2', 2_000);
    expect(two.events('bonusGranted')).toEqual([]);
  });

  it('helps whoever is last at the end of a round, from the second round on', () => {
    const party = new Party();
    party.guess('p1', 1_000);
    party.send({ type: 'tick' }, party.start + 30_000);
    // Round 1: p2 and p3 are tied last, but it is too early for a catch-up.
    expect(party.events('bonusGranted').filter((e) => e.reason === 'catchup')).toEqual([]);

    party.send({ type: 'tick' }, party.start + 38_000);
    party.nextRound(party.start + 38_000);
    party.guess('p2', 5_000);
    party.send({ type: 'tick' }, party.start + 30_000);
    expect(party.events('bonusGranted').filter((e) => e.reason === 'catchup')).toMatchObject([
      { playerId: 'p3' },
    ]);
  });

  it('gives no catch-up when everybody is level', () => {
    const party = new Party();
    party.finishRound();
    party.send({ type: 'tick' }, party.start + 30_000);
    expect(party.events('bonusGranted')).toEqual([]);
  });

  it('never fills an inventory beyond three', () => {
    const party = new Party();
    party.give('p2', 'blur', 'flip', 'freeze');
    party.guess('p2', 1_000);
    expect(party.inventory('p2')).toEqual(['blur', 'flip', 'freeze']);
    expect(party.events('bonusGranted')).toEqual([]);
  });

  it('only draws what makes sense in the room', () => {
    const drawn = (options: ConstructorParameters<typeof Party>[0]) => {
      const types = new Set<BonusType>();
      for (let i = 0; i < 40; i++) {
        const party = new Party(options);
        party.random = i / 40;
        const player = party.state.players.p1!;
        player.streak = 2;
        if (options?.mcq) {
          const roundId = party.state.round!.id;
          party.send({ type: 'pick', playerId: 'p1', roundId, optionId: 'b' }, party.start + 500);
        } else party.guess('p1', 500);
        for (const type of party.inventory('p1')) types.add(type);
      }
      return types;
    };

    const solo = drawn({ mode: 'solo' });
    expect(solo.has('zoomOut')).toBe(true);
    for (const type of ['blur', 'flip', 'freeze', 'stealBonus', 'stealPoints', 'removeTwo']) {
      expect(solo.has(type as BonusType), type).toBe(false);
    }
    expect(drawn({ players: 2 }).has('blur')).toBe(true);
    expect(drawn({ players: 2 }).has('removeTwo')).toBe(false);
    expect(drawn({ players: 2, mcq: true }).has('removeTwo')).toBe(true);
    const big = drawn({ players: 2, bigscreen: true });
    expect(big.has('blur')).toBe(false);
    expect(big.has('flip')).toBe(false);
    expect(big.has('freeze')).toBe(true);
  });
});

describe('using a bonus', () => {
  it('needs the item, a live round, and a player who has not answered yet', () => {
    const party = new Party();
    const [zoom] = party.give('p1', 'zoomOut');
    expect(party.use('p1', 'nope', 1_000)).toMatchObject(refused('BONUS_NOT_OWNED'));
    expect(party.use('p2', zoom!, 1_000)).toMatchObject(refused('BONUS_NOT_OWNED'));

    party.guess('p1', 2_000);
    expect(party.use('p1', zoom!, 3_000)).toMatchObject(refused('BAD_PHASE'));
    expect(party.inventory('p1')).toContain('zoomOut');
  });

  it('zooms out for that player only, and costs them part of the round', () => {
    const party = new Party();
    const [zoom] = party.give('p1', 'zoomOut');
    expect(party.use('p1', zoom!, 1_000)).toEqual({ ok: true, data: { used: 'zoomOut' } });

    expect(party.mine('p1')).toMatchObject({ bonusLevels: 1, penalty: 150 });
    expect(party.inventory('p1')).toEqual([]);
    expect(party.events('personalLevel')).toEqual([
      { type: 'personalLevel', playerId: 'p1', level: 1, sentTo: 'p1' },
    ]);

    // The automatic zoom-out keeps them one level ahead of the room.
    party.send({ type: 'tick' }, party.start + 10_000);
    expect(party.events('personalLevel').at(-1)).toMatchObject({ playerId: 'p1', level: 2 });
    expect(party.events('roundLevel').at(-1)).toMatchObject({ level: 1 });
    expect(party.guess('p1', 15_000)).toEqual({
      ok: true,
      data: { verdict: 'correct', points: 450 },
    });
  });

  it('cannot zoom past the last level, and keeps the bonus if it tries', () => {
    const party = new Party();
    const items = party.give('p1', 'zoomOut', 'zoomOut');
    party.send({ type: 'tick' }, party.start + 20_000);
    expect(party.use('p1', items[0]!, 21_000).ok).toBe(true);
    expect(party.use('p1', items[1]!, 22_000)).toMatchObject(refused('BAD_PHASE'));
    expect(party.inventory('p1')).toEqual(['zoomOut']);
  });

  it('reveals initials, the category or a second zone, each at its own cost', () => {
    const party = new Party();
    const [initials, category, second] = party.give('p1', 'initials', 'category', 'secondZone');
    party.use('p1', initials!, 1_000);
    party.use('p1', category!, 1_100);
    party.use('p1', second!, 1_200);
    expect(party.mine('p1')).toMatchObject({
      penalty: 200 + 100 + 100,
      revealed: { initials: true, category: true, secondZone: true },
    });
  });

  it('keeps the second-zone bonus when the image has no other zone', () => {
    const party = new Party();
    party.state.round!.card.secondZone = undefined;
    const [second] = party.give('p1', 'secondZone');
    expect(party.use('p1', second!, 1_000)).toMatchObject(refused('BAD_PHASE'));
    expect(party.inventory('p1')).toEqual(['secondZone']);
  });

  it('removes two wrong options, in multiple choice only', () => {
    const party = new Party({ mcq: true });
    const [remove] = party.give('p1', 'removeTwo');
    expect(party.use('p1', remove!, 1_000).ok).toBe(true);
    const removed = party.mine('p1').removedOptionIds!;
    expect(removed).toHaveLength(2);
    expect(removed).not.toContain('b');
    expect(party.mine('p1').penalty).toBe(150);

    const typed = new Party();
    const [useless] = typed.give('p1', 'removeTwo');
    expect(typed.use('p1', useless!, 1_000)).toMatchObject(refused('BAD_PHASE'));
    expect(typed.inventory('p1')).toEqual(['removeTwo']);
  });
});

describe('maluses', () => {
  it('hits one target for a few seconds, in front of everyone', () => {
    const party = new Party();
    const [blur] = party.give('p1', 'blur');
    expect(party.use('p1', blur!, 1_000, 'p2').ok).toBe(true);

    expect(party.mine('p2').effect).toEqual({
      type: 'blur',
      from: 'p1',
      until: party.start + 5_000,
    });
    expect(party.mine('p1').penalty).toBe(0);
    expect(party.events('malus')).toEqual([
      {
        type: 'malus',
        malus: 'blur',
        from: 'p1',
        to: 'p2',
        until: party.start + 5_000,
        sentTo: undefined,
      },
    ]);
  });

  it('allows one malus per target at a time', () => {
    const party = new Party();
    const [blur] = party.give('p1', 'blur');
    const [flip] = party.give('p3', 'flip');
    party.use('p1', blur!, 1_000, 'p2');
    expect(party.use('p3', flip!, 2_000, 'p2')).toMatchObject(refused('TARGET_BUSY'));
    expect(party.inventory('p3')).toEqual(['flip']);
    expect(party.use('p3', flip!, 5_001, 'p2').ok).toBe(true);
  });

  it('freezes the input of the target, on the server', () => {
    const party = new Party();
    const [freeze] = party.give('p1', 'freeze');
    party.use('p1', freeze!, 1_000, 'p2');
    expect(party.guess('p2', 2_000)).toMatchObject(refused('FROZEN'));
    expect(party.guess('p2', 4_001)).toMatchObject({ ok: true, data: { verdict: 'correct' } });
  });

  it('can still be thrown after answering, but not at just anyone', () => {
    const party = new Party();
    const [blur, flip] = party.give('p1', 'blur', 'flip');
    party.guess('p1', 1_000);
    party.guess('p3', 1_500);
    expect(party.use('p1', blur!, 2_000, 'p1')).toMatchObject(refused('TARGET_INVALID'));
    expect(party.use('p1', blur!, 2_000, 'ghost')).toMatchObject(refused('TARGET_INVALID'));
    expect(party.use('p1', blur!, 2_000, 'p3')).toMatchObject(refused('TARGET_INVALID'));
    expect(party.use('p1', blur!, 2_000)).toMatchObject(refused('TARGET_INVALID'));
    expect(party.use('p1', flip!, 2_000, 'p2').ok).toBe(true);
  });
});

describe('the shield', () => {
  it('waits, armed, and absorbs the next attack along with the attacker’s bonus', () => {
    const party = new Party();
    const [shield] = party.give('p2', 'shield');
    const [blur] = party.give('p1', 'blur');
    party.use('p2', shield!, 500);
    expect(party.state.players.p2!.shielded).toBe(true);
    expect(party.mine('p2').penalty).toBe(0);

    expect(party.use('p1', blur!, 1_000, 'p2').ok).toBe(true);
    expect(party.mine('p2').effect).toBeUndefined();
    expect(party.state.players.p2!.shielded).toBe(false);
    expect(party.inventory('p1')).toEqual([]);
    expect(party.events('blocked')).toMatchObject([{ from: 'p1', to: 'p2', what: 'blur' }]);
    expect(party.events('malus')).toEqual([]);
  });

  it('stays armed into the next round', () => {
    const party = new Party();
    const [shield] = party.give('p2', 'shield');
    party.use('p2', shield!, 500);
    party.finishRound();
    expect(party.state.players.p2!.shielded).toBe(true);
  });
});

describe('stealing', () => {
  it('takes a random bonus from the chosen player, and says which one', () => {
    const party = new Party();
    const [steal] = party.give('p1', 'stealBonus');
    party.give('p2', 'zoomOut', 'shield');
    party.random = 0.99;
    expect(party.use('p1', steal!, 1_000, 'p2').ok).toBe(true);

    expect(party.inventory('p1')).toEqual(['shield']);
    expect(party.inventory('p2')).toEqual(['zoomOut']);
    expect(party.events('steal')).toMatchObject([
      { kind: 'bonus', from: 'p1', to: 'p2', bonusType: 'shield' },
    ]);
    expect(party.events('bonusGranted')).toMatchObject([{ playerId: 'p1', reason: 'stolen' }]);
  });

  it('keeps the bonus when the victim has nothing to steal', () => {
    const party = new Party();
    const [steal] = party.give('p1', 'stealBonus');
    expect(party.use('p1', steal!, 1_000, 'p2')).toMatchObject(refused('TARGET_INVALID'));
    expect(party.inventory('p1')).toEqual(['stealBonus']);
  });

  it('moves a share of what the victim scores this round to the thief', () => {
    const party = new Party();
    const [steal] = party.give('p1', 'stealPoints');
    party.use('p1', steal!, 1_000, 'p2');
    expect(party.events('steal')).toMatchObject([{ kind: 'points', from: 'p1', to: 'p2' }]);
    expect(party.events('steal')[0]!.amount).toBeUndefined();

    // 7.5 s into the round a correct answer is worth 800: 30% of it goes to the thief.
    expect(party.guess('p2', 7_500)).toEqual({
      ok: true,
      data: { verdict: 'correct', points: 560 },
    });
    expect(party.state.players.p2!.score).toBe(560);
    expect(party.state.players.p1!.score).toBe(240);
    expect(party.mine('p1').stolenGain).toBe(240);
    expect(party.events('steal').at(-1)).toMatchObject({ kind: 'points', amount: 240 });
  });

  it('has one thief per victim, and is stopped by a shield', () => {
    const party = new Party();
    const [first] = party.give('p1', 'stealPoints');
    const [second] = party.give('p3', 'stealPoints');
    party.use('p1', first!, 1_000, 'p2');
    expect(party.use('p3', second!, 1_500, 'p2')).toMatchObject(refused('TARGET_BUSY'));

    const shielded = new Party();
    const [shield] = shielded.give('p2', 'shield');
    const [steal] = shielded.give('p1', 'stealPoints');
    shielded.use('p2', shield!, 500);
    shielded.use('p1', steal!, 1_000, 'p2');
    shielded.guess('p2', 7_500);
    expect(shielded.state.players.p2!.score).toBe(800);
    expect(shielded.state.players.p1!.score).toBe(0);
  });
});

describe('bonuses and the room hint', () => {
  it('refuses the initials and category bonuses once the room hint is shown, and stops drawing them', () => {
    const party = new Party();
    const [initials, category] = party.give('p1', 'initials', 'category');
    party.send({ type: 'tick' }, party.start + 18_000);
    expect(party.state.round!.hintAt).toBeDefined();
    expect(party.use('p1', initials!, 19_000)).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_SHOWN' },
    });
    expect(party.use('p1', category!, 19_000)).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_SHOWN' },
    });
    expect(party.inventory('p1')).toEqual(['initials', 'category']);
  });
});

describe('starting a big-screen game', () => {
  it('swaps a Blur or a Flip kept from a phone game for a bonus dealt there', () => {
    let state = createRoom({
      code: 'AB2CD',
      mode: 'private',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 3, answerMode: 'mcq', display: 'bigscreen' },
      lexicon: [],
      now: 1_000,
    });
    let ids = 0;
    const ctx = (now: number) => ({ now, newId: () => `new-${++ids}`, random: () => 0.5 });
    state = reduce(state, { type: 'join', playerId: 'p2', nickname: 'Moussa' }, ctx(1_001)).state;
    state.players.p1!.inventory = [
      { id: 'a', type: 'blur' },
      { id: 'b', type: 'shield' },
      { id: 'c', type: 'flip' },
    ];
    const started = reduce(state, { type: 'start', playerId: 'p1' }, ctx(1_002));
    const held = started.state.players.p1!.inventory!;
    expect(held).toHaveLength(3);
    expect(held[1]).toEqual({ id: 'b', type: 'shield' });
    expect(held.map((item) => item.type)).not.toContain('blur');
    expect(held.map((item) => item.type)).not.toContain('flip');
    const swapped = started.effects.filter(
      (e) => e.type === 'emit' && e.event.type === 'bonusGranted',
    );
    expect(swapped).toHaveLength(2);
    expect(swapped.every((e) => e.type === 'emit' && e.to === 'p1')).toBe(true);
  });
});
