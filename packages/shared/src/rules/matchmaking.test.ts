import { describe, expect, it } from 'vitest';
import { MATCHMAKING } from '../constants/game.js';
import { formRoom, queueStatus, type Waiting } from './matchmaking.js';

const T0 = 1_000_000;
const waiting = (n: number, since = T0): Waiting[] =>
  Array.from({ length: n }, (_, i) => ({
    playerId: `p${i + 1}`,
    nickname: `P${i + 1}`,
    since: since + i,
  }));

describe('formRoom', () => {
  it('waits while there is only one player, however long', () => {
    expect(formRoom(waiting(1), T0 + 10 * MATCHMAKING.timeoutMs)).toBeNull();
  });

  it('starts as soon as three are waiting, without waiting for the clock', () => {
    expect(formRoom(waiting(2), T0)).toBeNull();
    expect(formRoom(waiting(3), T0)).toHaveLength(3);
  });

  it('starts with two once the first has waited long enough, and not a moment before', () => {
    const two = waiting(2);
    expect(formRoom(two, T0 + MATCHMAKING.timeoutMs - 1)).toBeNull();
    expect(formRoom(two, T0 + MATCHMAKING.timeoutMs)).toHaveLength(2);
  });

  it('serves the oldest first and fills a room of at most eight', () => {
    const queue = waiting(11);
    const room = formRoom(queue, T0)!;
    expect(room).toHaveLength(MATCHMAKING.maxPlayers);
    expect(room.map((player) => player.playerId)).toEqual(
      queue.slice(0, MATCHMAKING.maxPlayers).map((player) => player.playerId),
    );
  });

  it('does not care in which order the queue was handed over', () => {
    const queue = waiting(4);
    const shuffled = [queue[3]!, queue[1]!, queue[0]!, queue[2]!];
    expect(formRoom(shuffled, T0)).toEqual(formRoom(queue, T0));
  });
});

describe('queueStatus', () => {
  it('counts who waits, and says nothing about a start while alone', () => {
    expect(queueStatus(waiting(1))).toEqual({ waiting: 1, startsAt: null });
  });

  it('announces the deadline of the oldest once two are waiting', () => {
    expect(queueStatus(waiting(2))).toEqual({
      waiting: 2,
      startsAt: T0 + MATCHMAKING.timeoutMs,
    });
  });
});
