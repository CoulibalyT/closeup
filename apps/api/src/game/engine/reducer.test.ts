import { describe, expect, it } from 'vitest';
import { engineCard } from '../../testing/cards.js';
import { Party, PARTY_T0 } from '../../testing/party.js';
import { HINT, partialValue, roundValueAt } from '@closeup/shared';
import { createRoom, reduce } from './reducer.js';
import type { Command, Effect, EngineCard, Reduced, RoomState } from './types.js';

const T0 = 1_000_000;

const card = (n: number, mcq = false): EngineCard => engineCard(n, { mcq });

/** Drives the reducer with an explicit clock and keeps every effect for assertions. */
class Game {
  state: RoomState;
  effects: Effect[] = [];
  last!: Reduced;
  private ids = 0;

  constructor(options: {
    mode?: 'solo' | 'private';
    answerMode?: 'text' | 'mcq';
    rounds?: number;
    roundSeconds?: 30 | 45 | 60 | 90 | null;
    hints?: boolean;
    scoring?: 'decay' | 'fixed';
  }) {
    this.state = createRoom({
      code: 'AB2CD',
      mode: options.mode ?? 'solo',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: {
        rounds: options.rounds ?? 2,
        answerMode: options.answerMode ?? 'text',
        ...(options.roundSeconds !== undefined ? { roundSeconds: options.roundSeconds } : {}),
        ...(options.hints !== undefined ? { hints: options.hints } : {}),
        ...(options.scoring ? { scoring: options.scoring } : {}),
      },
      lexicon: [],
    });
    // A private room needs two players to start; the second one never answers on its own.
    if (options.mode === 'private') {
      this.state = reduce(
        this.state,
        { type: 'join', playerId: 'p2', nickname: 'Moussa' },
        { now: T0, newId: () => 'unused' },
      ).state;
    }
  }

  send(command: Command, now: number): Reduced {
    this.last = reduce(this.state, command, { now, newId: () => `id-${++this.ids}` });
    this.state = this.last.state;
    this.effects.push(...this.last.effects);
    return this.last;
  }

  events(): string[] {
    return this.effects.flatMap((e) => (e.type === 'emit' ? [e.event.type] : [e.type]));
  }

  /** start + first card + countdown elapsed: the round is live at the returned time. */
  toFirstRound(mcq = false, extra: Partial<EngineCard> = {}): number {
    this.send({ type: 'start', playerId: 'p1' }, T0);
    this.send({ type: 'cardReady', card: { ...card(1, mcq), ...extra } }, T0);
    const startsAt = this.state.round!.startsAt;
    this.send({ type: 'tick' }, startsAt);
    return startsAt;
  }

  get roundId(): string {
    return this.state.round!.id;
  }
}

describe('starting a game', () => {
  it('asks the room layer for a card and waits', () => {
    const game = new Game({});
    const { reply } = game.send({ type: 'start', playerId: 'p1' }, T0);
    expect(reply.ok).toBe(true);
    expect(game.events()).toEqual(['gameStarted', 'needCard']);
    expect(game.state.awaitingCard).toBe(true);
  });

  it('is reserved to the host and cannot happen twice', () => {
    const game = new Game({ mode: 'private' });
    game.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0);
    expect(game.send({ type: 'start', playerId: 'p2' }, T0).reply).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    game.send({ type: 'start', playerId: 'p1' }, T0);
    expect(game.send({ type: 'start', playerId: 'p1' }, T0).reply).toMatchObject({
      ok: false,
      error: { code: 'BAD_PHASE' },
    });
  });

  it('counts down before the round, without any content', () => {
    const game = new Game({});
    game.send({ type: 'start', playerId: 'p1' }, T0);
    game.send({ type: 'cardReady', card: card(1) }, T0);
    expect(game.state.phase).toBe('countdown');
    expect(game.state.round!.startsAt).toBe(T0 + 3_000);
    expect(game.state.wakeAt).toBe(T0 + 3_000);
    expect(game.events()).toContain('roundPrepare');
    expect(game.events()).not.toContain('roundStart');
  });
});

describe('the clock of a round', () => {
  it('starts, zooms out at 10 s and 20 s, and ends at 30 s', () => {
    // The room hint has its own tests: the clock alone here.
    const game = new Game({ mode: 'private', hints: false });
    const start = game.toFirstRound();
    expect(game.state.phase).toBe('playing');
    expect(game.state.wakeAt).toBe(start + 10_000);

    game.send({ type: 'tick' }, start + 10_000);
    expect(game.state.round!.level).toBe(1);
    expect(game.state.wakeAt).toBe(start + 20_000);

    game.send({ type: 'tick' }, start + 20_000);
    expect(game.state.round!.level).toBe(2);
    expect(game.state.wakeAt).toBe(start + 30_000);

    game.send({ type: 'tick' }, start + 30_000);
    expect(game.state.phase).toBe('reveal');
    expect(game.events().slice(-4)).toEqual(['roundStart', 'roundLevel', 'roundLevel', 'roundEnd']);
  });

  it('catches up in order when a tick arrives late', () => {
    const game = new Game({ mode: 'private' });
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 25_000);
    const levels = game.effects.flatMap((e) =>
      e.type === 'emit' && e.event.type === 'roundLevel' ? [e.event.level] : [],
    );
    expect(levels).toEqual([1, 2]);
  });

  it('ignores an early tick', () => {
    const game = new Game({ mode: 'private' });
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 4_000);
    expect(game.state.round!.level).toBe(0);
    expect(game.state.wakeAt).toBe(start + 10_000);
  });
});

describe('the length of a round', () => {
  it("zooms out and ends on the room's own schedule", () => {
    const game = new Game({ mode: 'private', roundSeconds: 60 });
    const start = game.toFirstRound();
    expect(game.state.wakeAt).toBe(start + 20_000);
    game.send({ type: 'tick' }, start + 20_000);
    expect(game.state.round!.level).toBe(1);
    game.send({ type: 'tick' }, start + 40_000);
    expect(game.state.round!.level).toBe(2);
    expect(game.state.wakeAt).toBe(start + 60_000);
    game.send({ type: 'tick' }, start + 59_999);
    expect(game.state.phase).toBe('playing');
    game.send({ type: 'tick' }, start + 60_000);
    expect(game.state.phase).toBe('reveal');
  });

  it("scores over the room's length", () => {
    const game = new Game({ roundSeconds: 60 });
    const start = game.toFirstRound();
    const { reply } = game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 30_000,
    );
    expect(reply).toMatchObject({ ok: true, data: { verdict: 'correct', points: 600 } });
  });

  it('plays a room saved before the setting as 30 seconds', () => {
    const game = new Game({ mode: 'private' });
    const start = game.toFirstRound();
    expect(game.state.round!.endsAt).toBe(start + 30_000);
  });

  it('never ends a round without a clock on time, and zooms out at 15 and 30 s', () => {
    const game = new Game({ mode: 'private', roundSeconds: null });
    const start = game.toFirstRound();
    expect(game.state.round!.endsAt).toBeNull();
    game.send({ type: 'tick' }, start + 30_000);
    expect(game.state.round!.level).toBe(2);
    game.send({ type: 'tick' }, start + 9 * 60_000);
    expect(game.state.phase).toBe('playing');
  });

  it('ends a round without a clock after the 10-minute safety', () => {
    const game = new Game({ mode: 'private', roundSeconds: null });
    const start = game.toFirstRound();
    expect(game.state.wakeAt).toBe(start + 15_000);
    game.send({ type: 'tick' }, start + 30_000);
    expect(game.state.wakeAt).toBe(start + 600_000);
    game.send({ type: 'tick' }, start + 600_000);
    expect(game.state.phase).toBe('reveal');
  });

  it('lets only the host skip a round, and a solo player give up', () => {
    const party = new Game({ mode: 'private', roundSeconds: null });
    const start = party.toFirstRound();
    expect(
      party.send({ type: 'skipRound', playerId: 'p2', roundId: party.roundId }, start + 5_000)
        .reply,
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    expect(
      party.send({ type: 'skipRound', playerId: 'p1', roundId: party.roundId }, start + 5_000).reply
        .ok,
    ).toBe(true);
    expect(party.state.phase).toBe('reveal');
    expect(
      party.send({ type: 'skipRound', playerId: 'p1', roundId: 'old' }, start + 6_000).reply,
    ).toMatchObject({
      ok: false,
      error: { code: 'BAD_PHASE' },
    });

    const solo = new Game({ roundSeconds: null });
    const soloStart = solo.toFirstRound();
    expect(
      solo.send({ type: 'skipRound', playerId: 'p1', roundId: solo.roundId }, soloStart + 5_000)
        .reply.ok,
    ).toBe(true);
    expect(solo.state.phase).toBe('reveal');
  });

  it('never lets the host cut a timed round, nor skip another round than the one in play', () => {
    const game = new Game({ mode: 'private', roundSeconds: 60 });
    const start = game.toFirstRound();
    expect(
      game.send({ type: 'skipRound', playerId: 'p1', roundId: game.roundId }, start + 5_000).reply,
    ).toMatchObject({ ok: false, error: { code: 'BAD_PHASE' } });
    expect(game.state.phase).toBe('playing');

    const untimed = new Game({ mode: 'private', roundSeconds: null });
    const t = untimed.toFirstRound();
    expect(
      untimed.send({ type: 'skipRound', playerId: 'p1', roundId: 'another' }, t + 5_000).reply,
    ).toMatchObject({ ok: false, error: { code: 'BAD_PHASE' } });
  });

  it('decays the value over 90 s without a clock, then keeps 200', () => {
    const game = new Game({ roundSeconds: null, hints: false });
    const start = game.toFirstRound();
    const { reply } = game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 120_000,
    );
    expect(reply).toMatchObject({ ok: true, data: { verdict: 'correct', points: 200 } });
  });
});

describe('free-text guesses', () => {
  it('scores the value at the moment the server received the answer', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    const { reply } = game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: "l'orange" },
      start + 9_100,
    );
    expect(reply).toEqual({ ok: true, data: { verdict: 'correct', points: 760 } });
    expect(game.state.players.p1).toMatchObject({ score: 760, streak: 1, correctCount: 1 });
  });

  it('ends a solo round at once, and the reveal waits for the player', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 2_000,
    );
    expect(game.state.phase).toBe('reveal');
    expect(game.state.revealUntil).toBeNull();
    expect(game.state.wakeAt).toBeNull();
  });

  it('tells wrong from close', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    const id = game.roundId;
    const wrong = game.send(
      { type: 'guess', playerId: 'p1', roundId: id, text: 'banane' },
      start + 1_000,
    );
    expect(wrong.reply).toEqual({ ok: true, data: { verdict: 'wrong' } });
    const close = game.send(
      { type: 'guess', playerId: 'p1', roundId: id, text: 'oranjes' },
      start + 2_000,
    );
    expect(close.reply).toEqual({ ok: true, data: { verdict: 'close' } });
    expect(game.state.players.p1!.score).toBe(0);
  });

  it('rate limits without evaluating the guess', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    const id = game.roundId;
    game.send({ type: 'guess', playerId: 'p1', roundId: id, text: 'banane' }, start + 1_000);
    const tooFast = game.send(
      { type: 'guess', playerId: 'p1', roundId: id, text: 'orange' },
      start + 1_300,
    );
    expect(tooFast.reply).toEqual({ ok: true, data: { verdict: 'rate_limited' } });
    expect(game.state.phase).toBe('playing');
    const ok = game.send(
      { type: 'guess', playerId: 'p1', roundId: id, text: 'orange' },
      start + 1_700,
    );
    expect(ok.reply).toMatchObject({ ok: true, data: { verdict: 'correct' } });
  });

  it('refuses an answer that arrives after the bell, even if the timer has not fired yet', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    const late = game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 30_001,
    );
    expect(late.reply).toMatchObject({ ok: false, error: { code: 'BAD_PHASE' } });
    expect(game.state.phase).toBe('reveal');
    expect(game.state.players.p1!.score).toBe(0);
  });

  it('refuses a guess for another round, from a stranger, or in multiple-choice mode', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    expect(
      game.send({ type: 'guess', playerId: 'p1', roundId: 'old', text: 'orange' }, start + 1_000)
        .reply,
    ).toMatchObject({ ok: false, error: { code: 'BAD_PHASE' } });
    expect(
      game.send(
        { type: 'guess', playerId: 'ghost', roundId: game.roundId, text: 'orange' },
        start + 1_000,
      ).reply,
    ).toMatchObject({ ok: false, error: { code: 'BAD_PHASE' } });

    const mcq = new Game({ answerMode: 'mcq' });
    const mcqStart = mcq.toFirstRound(true);
    expect(
      mcq.send(
        { type: 'guess', playerId: 'p1', roundId: mcq.roundId, text: 'orange' },
        mcqStart + 1_000,
      ).reply,
    ).toMatchObject({ ok: false, error: { code: 'BAD_PHASE' } });
  });
});

describe('multiple choice', () => {
  it('locks the player out for 3 s after a wrong pick and lowers the value of the round', () => {
    const game = new Game({ answerMode: 'mcq' });
    const start = game.toFirstRound(true);
    const id = game.roundId;

    const wrong = game.send(
      { type: 'pick', playerId: 'p1', roundId: id, optionId: 'a' },
      start + 1_000,
    );
    expect(wrong.reply).toEqual({
      ok: true,
      data: { verdict: 'wrong', lockedUntil: start + 4_000, penalty: 100 },
    });

    const locked = game.send(
      { type: 'pick', playerId: 'p1', roundId: id, optionId: 'b' },
      start + 2_000,
    );
    expect(locked.reply).toMatchObject({ ok: false, error: { code: 'LOCKED' } });

    const right = game.send(
      { type: 'pick', playerId: 'p1', roundId: id, optionId: 'b' },
      start + 4_000,
    );
    // value at 4 s is 890, minus the 100 penalty
    expect(right.reply).toEqual({ ok: true, data: { verdict: 'correct', points: 790 } });
  });

  it('rejects an option that is not on the table', () => {
    const game = new Game({ answerMode: 'mcq' });
    const start = game.toFirstRound(true);
    expect(
      game.send(
        { type: 'pick', playerId: 'p1', roundId: game.roundId, optionId: 'z' },
        start + 1_000,
      ).reply,
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });
});

describe('several players', () => {
  const twoPlayers = () => {
    const game = new Game({ mode: 'private' });
    game.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0);
    return game;
  };

  it('keeps the round open after the first correct answer', () => {
    const game = twoPlayers();
    const start = game.toFirstRound();
    game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 5_000,
    );
    expect(game.state.phase).toBe('playing');
    expect(game.state.round!.answerOrder).toEqual(['p1']);
  });

  it('ends early, after a short grace, once everyone connected has found', () => {
    const game = twoPlayers();
    const start = game.toFirstRound();
    const id = game.roundId;
    game.send({ type: 'guess', playerId: 'p1', roundId: id, text: 'orange' }, start + 5_000);
    game.send({ type: 'guess', playerId: 'p2', roundId: id, text: 'orange' }, start + 7_000);
    expect(game.state.phase).toBe('playing');
    expect(game.state.wakeAt).toBe(start + 8_500);

    game.send({ type: 'tick' }, start + 8_500);
    expect(game.state.phase).toBe('reveal');
    expect(game.state.revealUntil).toBe(start + 8_500 + 8_000);
  });

  it('breaks the streak of whoever did not find', () => {
    const game = twoPlayers();
    const start = game.toFirstRound();
    game.state.players.p2!.streak = 2;
    game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 5_000,
    );
    game.send({ type: 'tick' }, start + 30_000);
    expect(game.state.players.p1!.streak).toBe(1);
    expect(game.state.players.p2!.streak).toBe(0);
    expect(game.state.players.p2!.bestStreak).toBe(0);
  });

  it('moves on by itself after the reveal, or sooner if the host says so', () => {
    const game = twoPlayers();
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 30_000);
    expect(game.send({ type: 'skipReveal', playerId: 'p2' }, start + 31_000).reply).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    game.send({ type: 'skipReveal', playerId: 'p1' }, start + 31_000);
    expect(game.events().slice(-1)).toEqual(['needCard']);

    const auto = twoPlayers();
    const autoStart = auto.toFirstRound();
    auto.send({ type: 'tick' }, autoStart + 30_000);
    auto.send({ type: 'tick' }, autoStart + 38_000);
    expect(auto.events().slice(-1)).toEqual(['needCard']);
  });
});

describe('the end of the game', () => {
  it('comes after the last round', () => {
    const game = new Game({ rounds: 1 });
    const start = game.toFirstRound();
    game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      start + 1_000,
    );
    game.send({ type: 'skipReveal', playerId: 'p1' }, start + 5_000);
    expect(game.state.phase).toBe('ended');
    expect(game.events().slice(-2)).toEqual(['gameEnd', 'gameOver']);
    expect(game.state.wakeAt).toBeNull();
  });

  it('comes early, without failing, when the deck runs dry', () => {
    const game = new Game({ rounds: 5 });
    game.send({ type: 'start', playerId: 'p1' }, T0);
    game.send({ type: 'noCardLeft' }, T0);
    expect(game.state.phase).toBe('ended');
  });

  it('plays the requested number of rounds', () => {
    const game = new Game({ rounds: 2 });
    let now = game.toFirstRound();
    game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      now + 1_000,
    );
    game.send({ type: 'skipReveal', playerId: 'p1' }, now + 2_000);
    expect(game.state.awaitingCard).toBe(true);

    game.send({ type: 'cardReady', card: card(2) }, now + 2_000);
    now = game.state.round!.startsAt;
    game.send({ type: 'tick' }, now);
    expect(game.state.round!.index).toBe(1);
    game.send(
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      now + 1_000,
    );
    game.send({ type: 'skipReveal', playerId: 'p1' }, now + 2_000);
    expect(game.state.phase).toBe('ended');
    expect(game.state.players.p1!.score).toBe(970 + 970);
    expect(game.state.players.p1!.bestStreak).toBe(2);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const game = new Game({});
    const start = game.toFirstRound();
    const before = structuredClone(game.state);
    const frozen = game.state;
    reduce(
      frozen,
      { type: 'guess', playerId: 'p1', roundId: game.roundId, text: 'orange' },
      { now: start + 1_000, newId: () => 'x' },
    );
    expect(frozen).toEqual(before);
  });
});

describe('what a game leaves behind for the history', () => {
  it('remembers when it started, each round, and how each player did', () => {
    const party = new Party({ players: 3 });
    expect(party.state.startedAt).toBe(PARTY_T0 + 10);

    party.guess('p1', 4_000);
    party.guess('p2', 10_000);
    party.finishRound();
    party.guess('p1', 6_000);
    party.send({ type: 'tick' }, party.start + 30_000);

    expect(party.state.history).toEqual([
      { cardId: expect.any(String), seated: 3, found: 2, foundMsTotal: 14_000 },
      { cardId: expect.any(String), seated: 3, found: 1, foundMsTotal: 6_000 },
    ]);
    expect(party.state.players.p1).toMatchObject({
      roundsSeated: 2,
      correctCount: 2,
      answerMsTotal: 10_000,
    });
    expect(party.state.players.p3).toMatchObject({ roundsSeated: 2, correctCount: 0 });
  });

  it('does not count a round for someone who joined in the middle of it', () => {
    const party = new Party({ players: 2 });
    party.send({ type: 'join', playerId: 'late', nickname: 'Théo' }, party.start + 5_000);
    party.finishRound();
    expect(party.state.players.late!.roundsSeated).toBe(1);
    expect(party.state.players.p1!.roundsSeated).toBe(2);
  });
});

describe('the room hint and partial answers', () => {
  const films = { secondary: [{ text: 'Pirates des Caraïbes', aliases: [] }] };
  const twoPlayers = (options: ConstructorParameters<typeof Game>[0] = {}) => {
    const game = new Game({ mode: 'private', ...options });
    game.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0);
    return game;
  };
  const hints = (game: Game) => game.events().filter((e) => e === 'roundHint').length;
  const guess = (game: Game, playerId: string, text: string, at: number) =>
    game.send({ type: 'guess', playerId, roundId: game.roundId, text }, at).reply;

  it('shows the hint at 60 % when nobody found', () => {
    const game = twoPlayers({ roundSeconds: 30 });
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 17_999);
    expect(hints(game)).toBe(0);
    expect(game.state.wakeAt).toBe(start + 18_000);
    game.send({ type: 'tick' }, start + 18_000);
    expect(hints(game)).toBe(1);
    expect(game.state.round!.hintAt).toBe(start + 18_000);
  });

  it('shows no hint when the room turned hints off', () => {
    const game = twoPlayers({ roundSeconds: 30, hints: false });
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 25_000);
    expect(hints(game)).toBe(0);
  });

  it('shows no hint once someone found', () => {
    const game = twoPlayers({ roundSeconds: 30 });
    const start = game.toFirstRound();
    guess(game, 'p1', 'orange', start + 17_000);
    game.send({ type: 'tick' }, start + 18_000);
    expect(hints(game)).toBe(0);
  });

  it('treats a room saved without the setting as hints on', () => {
    const game = twoPlayers();
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 18_000);
    expect(hints(game)).toBe(1);
  });

  it('makes an answer after the hint worth 150 less', () => {
    const game = twoPlayers({ roundSeconds: 30 });
    const start = game.toFirstRound();
    game.send({ type: 'tick' }, start + 18_000);
    expect(guess(game, 'p1', 'orange', start + 19_000)).toMatchObject({
      ok: true,
      data: { verdict: 'correct', points: roundValueAt(19_000, HINT.cost) },
    });
  });

  it("scores a partial answer at 30 %, ends that player's round, keeps them out of the ranking", () => {
    const game = twoPlayers({ roundSeconds: 30 });
    const start = game.toFirstRound(false, films);
    game.state.players.p1!.streak = 3;
    expect(guess(game, 'p1', 'pirates des caraibes', start + 3_000)).toMatchObject({
      ok: true,
      data: { verdict: 'partial', points: partialValue(roundValueAt(3_000)) },
    });
    expect(game.state.round!.answerOrder).toEqual([]);
    expect(game.state.round!.perPlayer.p1).toMatchObject({ partial: true });
    expect(game.state.players.p1!.streak).toBe(0);
    expect(guess(game, 'p1', 'orange', start + 4_000)).toMatchObject({ ok: false });
  });

  it('gives a partial answer 30 % of the next rank in fixed scoring', () => {
    const game = twoPlayers({ roundSeconds: 30, scoring: 'fixed' });
    const start = game.toFirstRound(false, films);
    guess(game, 'p2', 'orange', start + 1_000);
    expect(guess(game, 'p1', 'Pirates des Caraïbes', start + 2_000)).toMatchObject({
      ok: true,
      data: { verdict: 'partial', points: partialValue(800) },
    });
    expect(game.state.round!.answerOrder).toEqual(['p2']);
  });

  it('lets the hint fire after a partial answer', () => {
    const game = new Game({ mode: 'private', roundSeconds: 30 });
    game.send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0);
    game.send({ type: 'join', playerId: 'p3', nickname: 'Lina' }, T0);
    const start = game.toFirstRound(false, films);
    guess(game, 'p1', 'Pirates des Caraïbes', start + 2_000);
    game.send({ type: 'tick' }, start + 18_000);
    expect(hints(game)).toBe(1);
  });

  it('ends the round early when everyone answered partially, and breaks every streak', () => {
    const game = twoPlayers({ roundSeconds: null });
    const start = game.toFirstRound(false, films);
    for (const id of ['p1', 'p2']) game.state.players[id]!.streak = 2;
    guess(game, 'p1', 'Pirates des Caraïbes', start + 2_000);
    guess(game, 'p2', 'Pirates des Caraibes', start + 3_000);
    game.send({ type: 'tick' }, start + 3_000 + 1_500);
    expect(game.state.phase).toBe('reveal');
    expect(game.state.players.p1!.streak).toBe(0);
    expect(game.state.players.p2!.streak).toBe(0);
  });

  it('ignores secondary answers in multiple-choice rooms', () => {
    const game = new Game({ answerMode: 'mcq' });
    const start = game.toFirstRound(true, films);
    expect(guess(game, 'p1', 'Pirates des Caraïbes', start + 2_000)).toMatchObject({ ok: false });
  });

  it('records partial answers apart in the round history', () => {
    const game = new Game({ roundSeconds: 30 });
    const start = game.toFirstRound(false, films);
    guess(game, 'p1', 'Pirates des Caraïbes', start + 2_000);
    expect(game.state.history?.at(-1)).toMatchObject({ found: 0, partial: 1 });
  });
});
