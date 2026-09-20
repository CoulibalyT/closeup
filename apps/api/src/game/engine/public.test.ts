import { ROOM } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import { engineCard } from '../../testing/cards.js';
import { createRoom, reduce } from './reducer.js';
import type { Command, Effect, RoomState } from './types.js';

const T0 = 7_000_000;
const WAIT_MS = 12_000;

/** A public room as the queue creates it: a host who has not arrived, and a deadline. */
function publicRoom(expectedPlayers = 3) {
  let state: RoomState = createRoom({
    code: 'AB2CD',
    mode: 'public',
    host: { id: 'p1', nickname: 'Awa' },
    language: 'fr',
    settings: { rounds: 5, answerMode: 'text' },
    lexicon: [],
    expectedPlayers,
    waitForPlayersMs: WAIT_MS,
    now: T0,
  });
  // The queue holds the first player's seat until their socket arrives, as the room layer does.
  state.players.p1!.connected = false;
  state.players.p1!.disconnectedAt = T0;
  const effects: Effect[] = [];
  const send = (command: Command, now: number) => {
    const result = reduce(state, command, { now, newId: () => 'id' });
    state = result.state;
    effects.push(...result.effects);
    return result.reply;
  };
  const asked = () => effects.filter((e) => e.type === 'needStart').length;
  return { send, effects, asked, state: () => state };
}

const arrive = (room: ReturnType<typeof publicRoom>, ids: string[], at: number) => {
  ids.forEach((id, index) =>
    room.send({ type: 'join', playerId: id, nickname: id.toUpperCase() }, at + index),
  );
};

describe('a public room starts by itself', () => {
  it('waits for the players the queue matched, then starts without anyone pressing start', () => {
    const room = publicRoom(3);
    arrive(room, ['p1', 'p2'], T0 + 1_000);
    expect(room.asked()).toBe(0);
    expect(room.state().phase).toBe('lobby');

    arrive(room, ['p3'], T0 + 2_000);
    expect(room.asked()).toBe(1);
  });

  it('starts with whoever is there when the wait runs out', () => {
    const room = publicRoom(4);
    arrive(room, ['p1', 'p2'], T0 + 1_000);

    room.send({ type: 'tick' }, T0 + WAIT_MS - 1);
    expect(room.asked()).toBe(0);
    room.send({ type: 'tick' }, T0 + WAIT_MS);
    expect(room.asked()).toBe(1);
  });

  it('asks only once, however many ticks follow', () => {
    const room = publicRoom(2);
    arrive(room, ['p1', 'p2'], T0 + 1_000);
    room.send({ type: 'tick' }, T0 + WAIT_MS + 1_000);
    room.send({ type: 'tick' }, T0 + WAIT_MS + 5_000);
    expect(room.asked()).toBe(1);
  });

  it('is dropped rather than leaving one player alone in a lobby', () => {
    const room = publicRoom(3);
    arrive(room, ['p1'], T0 + 1_000);
    room.send({ type: 'tick' }, T0 + WAIT_MS);

    expect(room.asked()).toBe(0);
    expect(room.effects.filter((e) => e.type === 'abandoned')).toHaveLength(1);
  });

  it('keeps its deadline as the room timer until it starts', () => {
    const room = publicRoom(3);
    arrive(room, ['p1'], T0 + 1_000);
    expect(room.state().wakeAt).toBe(T0 + WAIT_MS);
  });

  it('lets nobody walk in once it has started', () => {
    const room = publicRoom(2);
    arrive(room, ['p1', 'p2'], T0 + 1_000);
    room.send({ type: 'start', playerId: 'p1' }, T0 + 2_000);
    room.send({ type: 'cardReady', card: engineCard(1) }, T0 + 2_100);

    expect(
      room.send({ type: 'join', playerId: 'late', nickname: 'Théo' }, T0 + 3_000),
    ).toMatchObject({ error: { code: 'BAD_PHASE' } });
    // Somebody who was matched and lost their connection still comes back.
    room.send({ type: 'disconnect', playerId: 'p2' }, T0 + 3_100);
    expect(room.send({ type: 'join', playerId: 'p2', nickname: 'P2' }, T0 + 3_200).ok).toBe(true);
  });

  it('leaves private and solo rooms alone: they start when their host says so', () => {
    let state: RoomState = createRoom({
      code: 'AB2CD',
      mode: 'private',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 5, answerMode: 'text' },
      lexicon: [],
      now: T0,
    });
    const result = reduce(
      state,
      { type: 'join', playerId: 'p2', nickname: 'M' },
      {
        now: T0 + ROOM.emptyRoomTtlMs,
        newId: () => 'id',
      },
    );
    state = result.state;
    expect(result.effects.some((e) => e.type === 'needStart')).toBe(false);
    expect(state.phase).toBe('lobby');
  });
});
