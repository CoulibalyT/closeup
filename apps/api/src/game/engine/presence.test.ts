import { describe, expect, it } from 'vitest';
import { engineCard } from '../../testing/cards.js';
import { createRoom, reduce } from './reducer.js';
import type { Command, Effect, RoomState } from './types.js';

const T0 = 2_000_000;
const GRACE = 60_000;

class Room {
  state: RoomState;
  effects: Effect[] = [];
  private ids = 0;

  constructor(mode: 'solo' | 'private' = 'private') {
    this.state = createRoom({
      code: 'AB2CD',
      mode,
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 3, answerMode: 'text' },
      lexicon: [],
      now: T0,
    });
  }

  send(command: Command, now: number) {
    const result = reduce(this.state, command, { now, newId: () => `id-${++this.ids}` });
    this.state = result.state;
    this.effects.push(...result.effects);
    return result.reply;
  }

  events(): string[] {
    return this.effects.flatMap((e) => (e.type === 'emit' ? [e.event.type] : [e.type]));
  }

  join(id: string, nickname: string, now = T0 + 1) {
    return this.send({ type: 'join', playerId: id, nickname }, now);
  }

  /** Two players, first round live. Returns the time the round started. */
  startRound(): number {
    this.send({ type: 'start', playerId: 'p1' }, T0 + 10);
    this.send({ type: 'cardReady', card: engineCard(1) }, T0 + 10);
    const startsAt = this.state.round!.startsAt;
    this.send({ type: 'tick' }, startsAt);
    return startsAt;
  }
}

const refused = (code: string) => ({ ok: false, error: { code } });

describe('the lobby', () => {
  it('lets people in, and tells the room', () => {
    const room = new Room();
    expect(room.join('p2', 'Moussa').ok).toBe(true);
    expect(Object.keys(room.state.players)).toEqual(['p1', 'p2']);
    expect(room.events()).toEqual(['playerJoined']);
  });

  it('tells two people with the same nickname apart', () => {
    const room = new Room();
    room.join('p2', 'awa');
    room.join('p3', 'Awa');
    expect(Object.values(room.state.players).map((p) => p.nickname)).toEqual([
      'Awa',
      'awa 2',
      'Awa 3',
    ]);
  });

  it('never gives two players the same name, whatever order they arrive in', () => {
    const room = new Room();
    room.join('p2', 'Moussa 2');
    room.join('p3', 'Moussa');
    room.join('p4', 'Moussa');
    room.join('p5', 'moussa 2');
    const names = Object.values(room.state.players).map((p) => p.nickname.toLowerCase());
    expect(names).toEqual(['awa', 'moussa 2', 'moussa', 'moussa 3', 'moussa 4']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('holds 12 players and no more', () => {
    const room = new Room();
    for (let i = 2; i <= 12; i++) expect(room.join(`p${i}`, `Joueur ${i}`).ok).toBe(true);
    expect(room.join('p13', 'Trop tard')).toMatchObject(refused('ROOM_FULL'));
  });

  it('needs two connected players to start, unless it is solo training', () => {
    const room = new Room();
    expect(room.send({ type: 'start', playerId: 'p1' }, T0)).toMatchObject(
      refused('NOT_ENOUGH_PLAYERS'),
    );
    room.join('p2', 'Moussa');
    expect(room.send({ type: 'start', playerId: 'p1' }, T0 + 5).ok).toBe(true);

    const solo = new Room('solo');
    expect(solo.send({ type: 'start', playerId: 'p1' }, T0).ok).toBe(true);
  });

  it('plays as many rounds as the deck allows', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    room.send({ type: 'start', playerId: 'p1', lexicon: ['orange'], availableRounds: 2 }, T0 + 5);
    expect(room.state.totalRounds).toBe(2);
    expect(room.state.lexicon).toEqual(['orange']);
  });

  it('lets the host, and only the host, change the settings before the game', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const settings = { rounds: 10, answerMode: 'mcq' } as const;
    expect(room.send({ type: 'updateSettings', playerId: 'p2', settings }, T0 + 2)).toMatchObject(
      refused('NOT_HOST'),
    );
    expect(room.send({ type: 'updateSettings', playerId: 'p1', settings }, T0 + 2).ok).toBe(true);
    expect(room.state.settings).toEqual(settings);
    expect(room.events()).toContain('settingsChanged');

    room.startRound();
    expect(
      room.send({ type: 'updateSettings', playerId: 'p1', settings }, T0 + 9_000),
    ).toMatchObject(refused('BAD_PHASE'));
  });

  it('lets the host remove someone, but not themselves', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    expect(room.send({ type: 'kick', playerId: 'p2', targetId: 'p1' }, T0 + 2)).toMatchObject(
      refused('NOT_HOST'),
    );
    expect(room.send({ type: 'kick', playerId: 'p1', targetId: 'p1' }, T0 + 2)).toMatchObject(
      refused('TARGET_INVALID'),
    );
    expect(room.send({ type: 'kick', playerId: 'p1', targetId: 'p2' }, T0 + 2).ok).toBe(true);
    expect(room.state.players.p2).toBeUndefined();
    expect(room.effects.at(-1)).toEqual({
      type: 'emit',
      event: { type: 'playerLeft', playerId: 'p2', reason: 'kicked' },
    });
  });

  it('lets the host hand the room to another player who is there', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    room.join('p3', 'Inès');
    const hand = (playerId: string, targetId: string) =>
      room.send({ type: 'transferHost', playerId, targetId }, T0 + 2);
    expect(hand('p2', 'p3')).toMatchObject(refused('NOT_HOST'));
    expect(hand('p1', 'p1')).toMatchObject(refused('TARGET_INVALID'));
    expect(hand('p1', 'nobody')).toMatchObject(refused('TARGET_INVALID'));
    room.send({ type: 'disconnect', playerId: 'p3' }, T0 + 2);
    expect(hand('p1', 'p3')).toMatchObject(refused('TARGET_INVALID'));

    expect(hand('p1', 'p2').ok).toBe(true);
    expect(room.state.hostId).toBe('p2');
    expect(room.events().at(-1)).toBe('hostChanged');
    // The former host is an ordinary player now.
    expect(hand('p1', 'p3')).toMatchObject(refused('NOT_HOST'));
  });

  it('hands the room to the longest-present player when the host leaves', () => {
    const room = new Room();
    room.join('p2', 'Moussa', T0 + 100);
    room.join('p3', 'Inès', T0 + 50);
    room.send({ type: 'leave', playerId: 'p1' }, T0 + 200);
    expect(room.state.hostId).toBe('p3');
    expect(room.events().slice(-2)).toEqual(['playerLeft', 'hostChanged']);
  });
});

describe('losing the connection', () => {
  it('keeps the seat for 60 seconds', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    room.send({ type: 'disconnect', playerId: 'p2' }, T0 + 1_000);
    expect(room.state.players.p2).toMatchObject({ connected: false, disconnectedAt: T0 + 1_000 });
    expect(room.state.wakeAt).toBe(T0 + 1_000 + GRACE);
    expect(room.events().at(-1)).toBe('playerUpdated');
  });

  it('gives everything back to someone who returns in time', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const start = room.startRound();
    room.send(
      { type: 'guess', playerId: 'p2', roundId: room.state.round!.id, text: 'orange' },
      start + 1_000,
    );
    room.send({ type: 'disconnect', playerId: 'p2' }, start + 2_000);
    room.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, start + 30_000);

    expect(room.state.players.p2).toMatchObject({ connected: true, score: 970 });
    expect(room.state.players.p2!.disconnectedAt).toBeUndefined();
    expect(room.events().at(-1)).toBe('playerUpdated');
    expect(room.events().filter((e) => e === 'playerJoined')).toHaveLength(1);
  });

  it('frees the seat of someone who never returns to the lobby', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    room.send({ type: 'disconnect', playerId: 'p2' }, T0 + 1_000);
    room.send({ type: 'tick' }, T0 + 1_000 + GRACE);
    expect(room.state.players.p2).toBeUndefined();
    expect(room.effects.at(-1)).toEqual({
      type: 'emit',
      event: { type: 'playerLeft', playerId: 'p2', reason: 'timeout' },
    });
  });

  it('keeps the score of someone who drops out mid-game, and lets them back later', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const start = room.startRound();
    room.send(
      { type: 'guess', playerId: 'p2', roundId: room.state.round!.id, text: 'orange' },
      start + 1_000,
    );
    room.send({ type: 'disconnect', playerId: 'p2' }, start + 2_000);
    room.send({ type: 'tick' }, start + 2_000 + GRACE);
    expect(room.state.players.p2).toMatchObject({ gone: true, connected: false, score: 970 });

    room.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, start + 2_000 + GRACE + 5_000);
    expect(room.state.players.p2).toMatchObject({ connected: true, score: 970 });
    expect(room.state.players.p2!.gone).toBeUndefined();
  });

  it('passes the room on when the host has been gone for 60 seconds', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const start = room.startRound();
    room.send({ type: 'disconnect', playerId: 'p1' }, start + 1_000);
    room.send({ type: 'tick' }, start + 1_000 + GRACE - 1);
    expect(room.state.hostId).toBe('p1');
    room.send({ type: 'tick' }, start + 1_000 + GRACE);
    expect(room.state.hostId).toBe('p2');
    expect(room.events()).toContain('hostChanged');
  });

  it('does not make the others wait for someone who is offline', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const start = room.startRound();
    const roundId = room.state.round!.id;
    room.send({ type: 'guess', playerId: 'p1', roundId, text: 'orange' }, start + 3_000);
    expect(room.state.round!.endsEarlyAt).toBeUndefined();

    room.send({ type: 'disconnect', playerId: 'p2' }, start + 4_000);
    expect(room.state.round!.endsEarlyAt).toBe(start + 4_000 + 1_500);
  });

  it('gives the room up once everybody is gone for good', () => {
    const room = new Room();
    room.send({ type: 'disconnect', playerId: 'p1' }, T0 + 1_000);
    room.send({ type: 'tick' }, T0 + 1_000 + GRACE);
    expect(room.events().at(-1)).toBe('abandoned');
  });
});

describe('joining a game that has started', () => {
  it('seats the newcomer for the next round, with no points', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const start = room.startRound();
    expect(room.join('p3', 'Inès', start + 5_000).ok).toBe(true);
    expect(room.state.round!.perPlayer.p3).toBeUndefined();

    const roundId = room.state.round!.id;
    expect(
      room.send({ type: 'guess', playerId: 'p3', roundId, text: 'orange' }, start + 6_000),
    ).toMatchObject(refused('BAD_PHASE'));

    room.send({ type: 'tick' }, start + 30_000);
    room.send({ type: 'tick' }, start + 38_000);
    room.send({ type: 'cardReady', card: engineCard(2) }, start + 38_000);
    expect(room.state.round!.perPlayer.p3).toEqual({ penalty: 0 });
  });

  it('is refused once the game is over', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    room.send({ type: 'start', playerId: 'p1' }, T0 + 10);
    room.send({ type: 'noCardLeft' }, T0 + 10);
    expect(room.join('p3', 'Inès', T0 + 20)).toMatchObject(refused('BAD_PHASE'));
  });
});

describe('playing again', () => {
  it('brings the same players back to the lobby with a clean slate', () => {
    const room = new Room();
    room.join('p2', 'Moussa');
    const start = room.startRound();
    room.send(
      { type: 'guess', playerId: 'p1', roundId: room.state.round!.id, text: 'orange' },
      start + 1_000,
    );
    room.send({ type: 'noCardLeft' }, start + 2_000);
    room.state.phase = 'ended';

    expect(room.send({ type: 'playAgain', playerId: 'p2' }, start + 3_000)).toMatchObject(
      refused('NOT_HOST'),
    );
    expect(room.send({ type: 'playAgain', playerId: 'p1' }, start + 3_000).ok).toBe(true);
    expect(room.state.phase).toBe('lobby');
    expect(room.state.roundIndex).toBe(0);
    expect(room.state.round).toBeUndefined();
    expect(room.state.players.p1).toMatchObject({ score: 0, streak: 0, correctCount: 0 });
    expect(Object.keys(room.state.players)).toEqual(['p1', 'p2']);
    expect(room.events().at(-1)).toBe('backToLobby');
  });
});
