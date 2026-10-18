import { roomStateSchema, roundEndSchema, roundStartSchema } from '@closeup/shared';
import { describe, expect, it } from 'vitest';
import { engineCard, SECRETS } from '../../testing/cards.js';
import { createRoom, reduce } from './reducer.js';
import type { Command, Effect, RoomState } from './types.js';
import { eventToWire, type Sign, toSnapshot, type WireMessage } from './view.js';

const T0 = 5_000_000;

/** A signer that makes ids unrecognisable, as the real encrypted tokens do. */
const sign: Sign = (kind, id) => `/api/media/${kind}-${Buffer.from(id).toString('hex')}`;

/**
 * Plays a game and records everything a client could ever receive: every broadcast, plus a
 * snapshot for each player after each command (as if they reconnected at that instant).
 */
function record(answerMode: 'text' | 'mcq') {
  let state: RoomState = createRoom({
    code: 'AB2CD',
    mode: 'private',
    host: { id: 'p1', nickname: 'Awa' },
    language: 'fr',
    settings: { rounds: 1, answerMode },
    lexicon: [],
  });
  const beforeReveal: unknown[] = [];
  const afterReveal: unknown[] = [];
  const messages: WireMessage[] = [];
  let ids = 0;

  const send = (command: Command, now: number) => {
    const result = reduce(state, command, { now, newId: () => `round-${++ids}` });
    state = result.state;
    const revealed = state.phase === 'reveal' || state.phase === 'ended';
    const sink = revealed ? afterReveal : beforeReveal;
    for (const effect of result.effects as Effect[]) {
      if (effect.type !== 'emit') continue;
      const message = eventToWire(state, effect.event, sign);
      if (message) {
        messages.push(message);
        sink.push(message);
      }
    }
    sink.push(result.reply);
    for (const playerId of Object.keys(state.players)) sink.push(toSnapshot(state, playerId, sign));
    return result;
  };

  send({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0);
  send({ type: 'start', playerId: 'p1' }, T0);
  send({ type: 'cardReady', card: engineCard(1, { secret: true, mcq: answerMode === 'mcq' }) }, T0);
  const start = state.round!.startsAt;
  const roundId = state.round!.id;
  send({ type: 'tick' }, start);
  if (answerMode === 'text') {
    send({ type: 'guess', playerId: 'p2', roundId, text: 'banane' }, start + 2_000);
    send({ type: 'guess', playerId: 'p1', roundId, text: SECRETS.answer }, start + 5_000);
  } else {
    send({ type: 'pick', playerId: 'p2', roundId, optionId: 'a' }, start + 2_000);
    send({ type: 'pick', playerId: 'p1', roundId, optionId: 'b' }, start + 5_000);
  }
  send({ type: 'tick' }, start + 10_000);
  send({ type: 'tick' }, start + 20_000);
  send({ type: 'tick' }, start + 30_000);

  return { beforeReveal, afterReveal, messages, state: () => state };
}

describe('nothing secret reaches a client before the reveal', () => {
  it.each(['text', 'mcq'] as const)('in %s mode', (mode) => {
    const { beforeReveal } = record(mode);
    const everything = JSON.stringify(beforeReveal);

    expect(beforeReveal.length).toBeGreaterThan(15);
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(everything, `${name} leaked`).not.toContain(secret);
    }
    for (const key of [
      'correctOptionId',
      'answers',
      'aliases',
      'cardId',
      'zoomPointId',
      'cropId',
    ]) {
      expect(everything, `key "${key}" leaked`).not.toContain(`"${key}"`);
    }
  });

  it('sends multiple-choice options without saying which one is right', () => {
    const { messages } = record('mcq');
    const start = roundStartSchema.parse(messages.find((m) => m.event === 'round:start')!.payload);
    expect(start.options).toHaveLength(4);
    expect(Object.keys(start.options![0]!).sort()).toEqual(['id', 'label']);
  });

  it('shows nothing of the card during the countdown', () => {
    let state = createRoom({
      code: 'AB2CD',
      mode: 'solo',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 1, answerMode: 'mcq' },
      lexicon: [],
    });
    const ctx = { now: T0, newId: () => 'r1' };
    state = reduce(state, { type: 'start', playerId: 'p1' }, ctx).state;
    state = reduce(state, { type: 'cardReady', card: engineCard(1, { mcq: true }) }, ctx).state;

    const snapshot = toSnapshot(state, 'p1', sign);
    expect(snapshot.phase).toBe('countdown');
    expect(snapshot.round).toBeDefined();
    expect(snapshot.round!.crop).toBeUndefined();
    expect(snapshot.round!.options).toBeUndefined();
  });
});

describe('the reveal', () => {
  it('then gives the answer, the credit and the zone', () => {
    const { afterReveal, messages } = record('text');
    const end = roundEndSchema.parse(messages.find((m) => m.event === 'round:end')!.payload);

    expect(end.reveal.answer).toBe(SECRETS.answer);
    expect(end.reveal.credit).toEqual({ author: 'closeup', licence: 'CC0' });
    expect(end.reveal.zone).toEqual({ cx: 0.575, cy: 0.425, r: 0.08 });
    expect(end.isLast).toBe(true);
    // Even then, server ids stay behind signed URLs.
    expect(JSON.stringify(afterReveal)).not.toContain(SECRETS.imageId);
    expect(JSON.stringify(afterReveal)).not.toContain(SECRETS.cardId);
  });

  it('lists who scored what, best first', () => {
    const { messages } = record('text');
    const end = roundEndSchema.parse(messages.find((m) => m.event === 'round:end')!.payload);

    expect(end.results).toContainEqual({ playerId: 'p1', points: 870, elapsedMs: 5_000 });
    expect(end.results).toContainEqual({ playerId: 'p2', points: 0, elapsedMs: null });
    expect(end.ranking.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('a snapshot for someone who reconnects mid-round', () => {
  it('carries the current zoom level, their penalty and their lock', () => {
    const { state } = record('mcq');
    // Rewind to a live round: replay the start of an MCQ game.
    let live = createRoom({
      code: state().code,
      mode: 'private',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 1, answerMode: 'mcq' },
      lexicon: [],
    });
    const at = (now: number) => ({ now, newId: () => 'r1' });
    live = reduce(live, { type: 'join', playerId: 'p2', nickname: 'Moussa' }, at(T0)).state;
    live = reduce(live, { type: 'start', playerId: 'p1' }, at(T0)).state;
    live = reduce(live, { type: 'cardReady', card: engineCard(1, { mcq: true }) }, at(T0)).state;
    const start = live.round!.startsAt;
    live = reduce(
      live,
      { type: 'pick', playerId: 'p1', roundId: 'r1', optionId: 'a' },
      at(start + 11_000),
    ).state;

    const snapshot = roomStateSchema.parse(toSnapshot(live, 'p1', sign));
    expect(snapshot.phase).toBe('playing');
    expect(snapshot.round).toMatchObject({
      answered: false,
      penalty: 100,
      lockedUntil: start + 14_000,
      crop: { level: 1 },
    });
    expect(snapshot.round!.levelAt).toEqual([start + 10_000, start + 20_000]);
  });
});

describe('the room hint', () => {
  const room = (card = engineCard(1)) => {
    let state = createRoom({
      code: 'AB2CD',
      mode: 'private',
      host: { id: 'p1', nickname: 'Awa' },
      language: 'fr',
      settings: { rounds: 1, answerMode: 'text', display: 'bigscreen' },
      lexicon: [],
    });
    const at = (now: number) => ({ now, newId: () => 'r1' });
    const effects: Effect[] = [];
    const run = (command: Command, now: number) => {
      const result = reduce(state, command, at(now));
      state = result.state;
      effects.push(...result.effects);
    };
    run({ type: 'join', playerId: 'p2', nickname: 'Moussa' }, T0);
    run({ type: 'start', playerId: 'p1' }, T0);
    run({ type: 'cardReady', card }, T0);
    const start = state.round!.startsAt;
    run({ type: 'tick' }, start + 18_000);
    return { state: () => state, effects };
  };

  it('goes to everyone, phones and screens, with the written hint', () => {
    const { state, effects } = room({ ...engineCard(1), hint: { text: 'Agrume' } });
    const hint = effects.find((e) => e.type === 'emit' && e.event.type === 'roundHint');
    expect(hint).toBeDefined();
    if (hint?.type !== 'emit') throw new Error('no hint');
    expect(hint.to).toBeUndefined();
    expect(eventToWire(state(), hint.event, sign)).toMatchObject({
      event: 'round:hint',
      payload: { text: 'Agrume' },
    });
    expect(toSnapshot(state(), 'p2', sign).round!.hint).toEqual({ text: 'Agrume' });
    expect(toSnapshot(state(), null, sign).round!.hint).toEqual({ text: 'Agrume' });
    expect(toSnapshot(state(), 'p1', sign).hints).toBe(true);
  });

  it('falls back on the category and the initials, never the answer', () => {
    const { state } = room(engineCard(1, { secret: true }));
    const snapshot = toSnapshot(state(), 'p2', sign);
    expect(snapshot.round!.hint).toEqual({ category: 'FOOD', initials: expect.any(String) });
    expect(JSON.stringify(snapshot)).not.toContain(SECRETS.answer);
  });
});
