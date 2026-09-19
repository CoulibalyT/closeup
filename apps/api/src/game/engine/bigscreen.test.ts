import { ROOM, roundLevelSchema, roundStartSchema } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import { engineCard } from '../../testing/cards.js';
import { Party } from '../../testing/party.js';
import { createRoom, reduce } from './reducer.js';
import type { Command, Effect, EngineEvent, RoomState } from './types.js';
import { broadcast, type Sign, toSnapshot } from './view.js';

const sign: Sign = (kind, id) => `/api/media/${kind}-${Buffer.from(id).toString('hex')}`;
const T0 = 9_000_000;

/** A room opened from a shared screen: nobody in it yet, and nobody holds it. */
function screenRoom() {
  let state: RoomState = createRoom({
    code: 'AB2CD',
    mode: 'private',
    language: 'fr',
    settings: { rounds: 3, answerMode: 'text', display: 'bigscreen' },
    lexicon: [],
    now: T0,
  });
  const effects: Effect[] = [];
  const send = (command: Command, now: number) => {
    const result = reduce(state, command, { now, newId: () => 'id' });
    state = result.state;
    effects.push(...result.effects);
    return result.reply;
  };
  const emitted = (type: EngineEvent['type']) =>
    effects.filter((e) => e.type === 'emit' && e.event.type === type);
  return { send, effects, emitted, state: () => state };
}

describe('a room opened from a shared screen', () => {
  it('has no host until the first player joins, who then holds the room', () => {
    const room = screenRoom();
    expect(room.state().hostId).toBeNull();
    expect(room.state().players).toEqual({});

    room.send({ type: 'join', playerId: 'p1', nickname: 'Awa' }, T0 + 1_000);
    room.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0 + 2_000);

    expect(room.state().hostId).toBe('p1');
    expect(room.emitted('hostChanged')).toHaveLength(1);
    expect(room.send({ type: 'start', playerId: 'p2' }, T0 + 3_000)).toMatchObject({
      error: { code: 'NOT_HOST' },
    });
    expect(room.send({ type: 'start', playerId: 'p1' }, T0 + 3_000).ok).toBe(true);
  });

  it('waits for players for a while, then gives up', () => {
    const room = screenRoom();
    room.send({ type: 'tick' }, T0 + 1);
    expect(room.state().wakeAt).toBe(T0 + ROOM.emptyRoomTtlMs);

    room.send({ type: 'tick' }, T0 + ROOM.emptyRoomTtlMs - 1);
    expect(room.effects.some((e) => e.type === 'abandoned')).toBe(false);

    room.send({ type: 'tick' }, T0 + ROOM.emptyRoomTtlMs);
    expect(room.effects.filter((e) => e.type === 'abandoned')).toHaveLength(1);
    expect(room.state().wakeAt).toBeNull();
  });

  it('stops counting down once somebody is in', () => {
    const room = screenRoom();
    room.send({ type: 'join', playerId: 'p1', nickname: 'Awa' }, T0 + 1_000);
    room.send({ type: 'tick' }, T0 + ROOM.emptyRoomTtlMs + 1);
    expect(room.effects.some((e) => e.type === 'abandoned')).toBe(false);
  });

  it('goes back to waiting when its lobby empties: the screen still shows the code', () => {
    const room = screenRoom();
    room.send({ type: 'join', playerId: 'p1', nickname: 'Awa' }, T0 + 1_000);
    room.send({ type: 'leave', playerId: 'p1' }, T0 + 5_000);

    expect(room.effects.some((e) => e.type === 'abandoned')).toBe(false);
    expect(room.state().hostId).toBeNull();
    expect(room.state().wakeAt).toBe(T0 + 5_000 + ROOM.emptyRoomTtlMs);

    // Whoever comes next holds the room.
    room.send({ type: 'join', playerId: 'p7', nickname: 'Inès' }, T0 + 9_000);
    expect(room.state().hostId).toBe('p7');
  });

  it('is abandoned like any other when a running game loses everybody', () => {
    const room = screenRoom();
    room.send({ type: 'join', playerId: 'p1', nickname: 'Awa' }, T0 + 1_000);
    room.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0 + 2_000);
    room.send({ type: 'start', playerId: 'p1' }, T0 + 3_000);
    room.send({ type: 'cardReady', card: engineCard(1) }, T0 + 3_100);
    room.send({ type: 'leave', playerId: 'p1' }, T0 + 4_000);
    room.send({ type: 'leave', playerId: 'p2' }, T0 + 4_500);
    expect(room.effects.filter((e) => e.type === 'abandoned')).toHaveLength(1);
  });

  it('drops the card that was loading if everybody leaves right after "start"', () => {
    const room = screenRoom();
    room.send({ type: 'join', playerId: 'p1', nickname: 'Awa' }, T0 + 1_000);
    room.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0 + 2_000);
    room.send({ type: 'start', playerId: 'p1' }, T0 + 3_000);
    room.send({ type: 'leave', playerId: 'p1' }, T0 + 3_010);
    room.send({ type: 'leave', playerId: 'p2' }, T0 + 3_020);

    expect(room.send({ type: 'cardReady', card: engineCard(1) }, T0 + 3_100).ok).toBe(false);
    expect(room.state().phase).toBe('lobby');
    expect(room.state().round).toBeUndefined();
  });

  it('a room with a host is still abandoned as soon as its lobby empties', () => {
    let state = createRoom({
      code: 'AB2CD',
      mode: 'private',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 3, answerMode: 'text' },
      lexicon: [],
      now: T0,
    });
    const result = reduce(state, { type: 'leave', playerId: 'p1' }, { now: T0, newId: () => 'id' });
    state = result.state;
    expect(result.effects.some((e) => e.type === 'abandoned')).toBe(true);
    expect(state.wakeAt).toBeNull();
  });
});

describe('who gets the image in big-screen mode', () => {
  const lastEvent = (party: Party, type: EngineEvent['type']) =>
    party.effects
      .flatMap((e) => (e.type === 'emit' && e.event.type === type ? [e.event] : []))
      .at(-1)!;

  it('sends the round to the screens with its crop, and to the phones without it', () => {
    const party = new Party({ bigscreen: true, mcq: true });
    const messages = broadcast(party.state, lastEvent(party, 'roundStart'), sign);

    expect(messages.map((m) => m.audience)).toEqual(['screens', 'players']);
    const [screens, phones] = messages.map((m) => roundStartSchema.parse(m.payload));
    expect(screens!.crop?.url).toContain('/api/media/');
    expect(phones!.crop).toBeUndefined();
    expect(JSON.stringify(messages[1])).not.toContain('/api/media/');
    // Everything a controller needs is still there.
    expect(phones!.options).toHaveLength(4);
    expect(phones!.endsAt).toBe(screens!.endsAt);
  });

  it('does the same for the automatic zoom-outs', () => {
    const party = new Party({ bigscreen: true });
    party.send({ type: 'tick' }, party.start + 10_000);
    const messages = broadcast(party.state, lastEvent(party, 'roundLevel'), sign);

    expect(messages.map((m) => m.audience)).toEqual(['screens', 'players']);
    const [screens, phones] = messages.map((m) => roundLevelSchema.parse(m.payload));
    expect(screens!.crop?.level).toBe(1);
    expect(phones).toMatchObject({ level: 1 });
    expect(phones!.crop).toBeUndefined();
  });

  it('keeps one message for the whole room when everyone plays on their phone', () => {
    const party = new Party();
    const messages = broadcast(party.state, lastEvent(party, 'roundStart'), sign);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.audience).toBeUndefined();
    expect(roundStartSchema.parse(messages[0]!.payload).crop).toBeDefined();
  });

  it('never splits anything else: the reveal is for everyone', () => {
    const party = new Party({ bigscreen: true });
    party.send({ type: 'tick' }, party.start + 30_000);
    const messages = broadcast(party.state, lastEvent(party, 'roundEnd'), sign);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.audience).toBeUndefined();
  });

  it('gives a phone no image on reconnection, and the shared screen the room level', () => {
    const party = new Party({ bigscreen: true });
    party.send({ type: 'tick' }, party.start + 10_000);

    const phone = toSnapshot(party.state, 'p2', sign, party.start + 11_000, 1);
    expect(phone).toMatchObject({ display: 'bigscreen', role: 'player', you: 'p2', screens: 1 });
    expect(phone.round!.crop).toBeUndefined();
    expect(JSON.stringify(phone)).not.toContain('/api/media/');

    const screen = toSnapshot(party.state, null, sign, party.start + 11_000, 1);
    expect(screen).toMatchObject({ role: 'screen', you: null, inventory: [], shielded: false });
    expect(screen.round).toMatchObject({ seated: false, answered: false, penalty: 0 });
    expect(screen.round!.crop?.level).toBe(1);
  });

  it('shows a zoom-out bonus on the phone of whoever played it, and nowhere else', () => {
    const party = new Party({ bigscreen: true });
    const [zoomOut] = party.give('p1', 'zoomOut');
    expect(party.use('p1', zoomOut!, 1_000).ok).toBe(true);

    const personal = party.events('personalLevel').at(-1)!;
    expect(personal.sentTo).toBe('p1');
    const [message] = broadcast(party.state, personal, sign);
    expect(roundLevelSchema.parse(message!.payload).crop?.level).toBe(1);

    expect(toSnapshot(party.state, 'p1', sign, party.start + 2_000).round!.crop?.level).toBe(1);
    expect(toSnapshot(party.state, 'p2', sign, party.start + 2_000).round!.crop).toBeUndefined();
    expect(toSnapshot(party.state, null, sign, party.start + 2_000).round!.crop?.level).toBe(0);
  });

  it('sends the new total as soon as somebody scores: the ranking on the screen is live', () => {
    const party = new Party({ bigscreen: true });
    const [steal] = party.give('p2', 'stealPoints');
    party.use('p2', steal!, 1_000, 'p3');
    const before = party.events('playerUpdated').length;

    party.guess('p3', 4_000);
    const updated = party
      .events('playerUpdated')
      .slice(before)
      .map((e) => e.playerId);
    // Whoever scored, and the thief who took a share of it.
    expect(updated).toEqual(expect.arrayContaining(['p3', 'p2']));
    expect(party.state.players.p2!.score).toBeGreaterThan(0);
  });

  it('tells a reconnecting client who has already found', () => {
    const party = new Party({ bigscreen: true });
    party.guess('p3', 4_000);
    party.guess('p1', 6_000);
    expect(toSnapshot(party.state, null, sign, party.start + 7_000).round!.foundIds).toEqual([
      'p3',
      'p1',
    ]);
  });
});
