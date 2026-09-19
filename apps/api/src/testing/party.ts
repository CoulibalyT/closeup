import type { BonusType } from '@closeup/shared';
import { createRoom, reduce } from '../game/engine/reducer.js';
import type { Command, Effect, EngineEvent, Reply, RoomState } from '../game/engine/types.js';
import { engineCard } from './cards.js';

export const PARTY_T0 = 3_000_000;

export interface PartyOptions {
  players?: number;
  mode?: 'solo' | 'private';
  mcq?: boolean;
  fixed?: boolean;
  secret?: boolean;
}

/** Three players by default, first round live, with whatever bonuses the test hands out. */
export class Party {
  state: RoomState;
  effects: Effect[] = [];
  /** What the injected random source returns: tests decide every draw. */
  random = 0;
  start = 0;
  private ids = 0;

  constructor(private readonly options: PartyOptions = {}) {
    const mode = options.mode ?? 'private';
    this.state = createRoom({
      code: 'AB2CD',
      mode,
      display: 'phones',
      hostId: 'p1',
      nickname: 'Awa',
      language: 'fr',
      settings: {
        rounds: 9,
        answerMode: options.mcq ? 'mcq' : 'text',
        scoring: options.fixed ? 'fixed' : 'decay',
      },
      lexicon: [],
      now: PARTY_T0,
    });
    const names = ['Awa', 'Moussa', 'Inès', 'Théo'];
    const count = mode === 'solo' ? 1 : (options.players ?? 3);
    for (let i = 2; i <= count; i++) {
      this.send({ type: 'join', playerId: `p${i}`, nickname: names[i - 1]! }, PARTY_T0 + i);
    }
    this.send({ type: 'start', playerId: 'p1' }, PARTY_T0 + 10);
    this.nextRound(PARTY_T0 + 10);
  }

  send(command: Command, now: number): Reply {
    const result = reduce(this.state, command, {
      now,
      newId: () => `id-${++this.ids}`,
      random: () => this.random,
    });
    this.state = result.state;
    this.effects.push(...result.effects);
    return result.reply;
  }

  nextRound(now: number): void {
    const { mcq, secret } = this.options;
    this.send({ type: 'cardReady', card: engineCard(this.ids + 1, { mcq, secret }) }, now);
    this.start = this.state.round!.startsAt;
    this.send({ type: 'tick' }, this.start);
  }

  /** Ends the current round on the clock, waits out the reveal and starts the next one. */
  finishRound(): void {
    this.send({ type: 'tick' }, this.start + 30_000);
    this.send({ type: 'tick' }, this.start + 38_000);
    this.nextRound(this.start + 38_000);
  }

  give(playerId: string, ...types: BonusType[]): string[] {
    const items = types.map((type) => ({ id: `item-${++this.ids}`, type }));
    const player = this.state.players[playerId]!;
    player.inventory = [...(player.inventory ?? []), ...items];
    return items.map((item) => item.id);
  }

  use(playerId: string, itemId: string, at: number, targetId?: string): Reply {
    const roundId = this.state.round!.id;
    return this.send({ type: 'useBonus', playerId, roundId, itemId, targetId }, this.start + at);
  }

  guess(playerId: string, at: number, text = 'orange'): Reply {
    const roundId = this.state.round!.id;
    return this.send({ type: 'guess', playerId, roundId, text }, this.start + at);
  }

  events<T extends EngineEvent['type']>(type: T) {
    return this.effects.flatMap((e) =>
      e.type === 'emit' && e.event.type === type
        ? [{ ...(e.event as Extract<EngineEvent, { type: T }>), sentTo: e.to }]
        : [],
    );
  }

  inventory(playerId: string): BonusType[] {
    return (this.state.players[playerId]!.inventory ?? []).map((item) => item.type);
  }

  mine(playerId: string) {
    return this.state.round!.perPlayer[playerId]!;
  }
}
