import { randomInt, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  type BonusUseReply,
  type Locale,
  ROOM,
  roomClosedSchema,
  type RoomStateView,
  type RoomSummary,
  ServerEvent,
} from '@closeup/shared';
import type { Redis } from 'ioredis';
import { withTimeout } from '../../common/with-timeout.js';
import { DeckService } from '../../content/deck.service.js';
import { HistoryService } from '../../history/history.service.js';
import { MediaTokens } from '../../media/media-tokens.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import { REDIS } from '../../redis/redis.module.js';
import type { DeckScope } from '../../content/playable.js';
import { createRoom, reduce } from '../engine/reducer.js';
import type { Command, Effect, Reply, RoomMode, RoomSettings, RoomState } from '../engine/types.js';
import {
  bonusReply,
  broadcast,
  gameEnd,
  recipientOf,
  type Sign,
  toSnapshot,
  type WireMessage,
} from '../engine/view.js';

const ROOM_TTL_S = 2 * 60 * 60;
const RECOVERY_TIMEOUT_MS = 2_500;
const ENDED_ROOM_KEPT_MS = 10 * 60 * 1000;
/** How long a matched public room waits for the players the queue sent it. */
const PUBLIC_ROOM_WAIT_MS = 12_000;
const ACTIVE_ROOMS = 'closeup:rooms:active';
const roomKey = (code: string) => `closeup:room:${code}`;

/**
 * Who this room may draw cards from. It is recomputed before every round, so a pack that is
 * disabled or unpublished mid-game stops appearing at the next one.
 */
const deckScope = (state: RoomState): DeckScope =>
  state.mode === 'public'
    ? { kind: 'public' }
    : { kind: 'room', hostPlayerId: state.hostId ?? undefined, packIds: state.settings.packIds };

/** What survives a restart: the engine state and the cards still to be played. */
interface RoomRecord {
  state: RoomState;
  deck: string[];
}

interface Actor {
  record: RoomRecord;
  /** Commands of a room run one after the other: no two of them ever see the same state. */
  queue: Promise<unknown>;
  timer?: NodeJS.Timeout;
}

/** `to` is a player id: the message is for them alone. Without it, the whole room hears it. */
export type RoomListener = (code: string, message: WireMessage, to?: string) => void;

@Injectable()
export class RoomService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Rooms');
  private readonly actors = new Map<string, Actor>();
  private listener: RoomListener = () => undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly decks: DeckService,
    private readonly prisma: PrismaService,
    private readonly tokens: MediaTokens,
    private readonly history: HistoryService,
  ) {}

  /** Relative on purpose: the client prefixes its API base, which differs between dev and prod. */
  private readonly sign: Sign = (kind, id) =>
    `/api/media/${this.tokens.seal(kind, id, Date.now())}`;

  onMessage(listener: RoomListener): void {
    this.listener = listener;
  }

  async onApplicationBootstrap(): Promise<void> {
    // Rooms outlive a deploy: reload them and re-arm their single timer. Bounded, because
    // ioredis queues commands while disconnected and the API must boot with Redis down.
    const codes = await withTimeout(
      this.redis.smembers(ACTIVE_ROOMS),
      RECOVERY_TIMEOUT_MS,
      'redis',
    ).catch((error: Error) => {
      this.logger.warn(`Rooms were not recovered: ${error.message}`);
      return [] as string[];
    });
    for (const code of codes) {
      const raw = await this.redis.get(roomKey(code));
      if (!raw) {
        await this.redis.srem(ACTIVE_ROOMS, code);
        continue;
      }
      const actor: Actor = { record: JSON.parse(raw) as RoomRecord, queue: Promise.resolve() };
      this.actors.set(code, actor);
      this.arm(code, actor);
      if (actor.record.state.awaitingCard) void this.supplyCard(code, actor);
    }
    if (codes.length) this.logger.log(`Recovered ${this.actors.size} room(s)`);
  }

  onModuleDestroy(): void {
    for (const actor of this.actors.values()) clearTimeout(actor.timer);
  }

  /** `host: null` opens the room from a shared screen: the first player to join will hold it. */
  async create(
    mode: RoomMode,
    host: { playerId: string; nickname: string } | null,
    settings: RoomSettings,
    language: Locale,
    /** Public rooms: how many the queue matched. They have no host to press start. */
    expectedPlayers?: number,
  ): Promise<string> {
    const code = this.newCode();
    const state = createRoom({
      code,
      mode,
      host: host ? { id: host.playerId, nickname: host.nickname } : undefined,
      language,
      settings,
      lexicon: [],
      expectedPlayers,
      waitForPlayersMs: PUBLIC_ROOM_WAIT_MS,
      now: Date.now(),
    });
    // The host is only present once their socket joins; until then the seat is held for them.
    if (host) {
      state.players[host.playerId]!.connected = false;
      state.players[host.playerId]!.disconnectedAt = Date.now();
    }
    const actor: Actor = { record: { state, deck: [] }, queue: Promise.resolve() };
    this.actors.set(code, actor);
    await this.persist(code, actor);
    this.arm(code, actor);
    return code;
  }

  /**
   * The deck is drawn when the game starts, not when the room is created: the host may still
   * change the number of rounds in the lobby. It is set before `start` is dispatched because
   * `start` immediately asks for the first card.
   */
  async start(code: string, playerId: string): Promise<Reply> {
    const actor = this.actors.get(code);
    if (!actor) return this.dispatch(code, { type: 'start', playerId });
    const { state } = actor.record;
    const deck = await this.decks.build(state.settings.rounds, deckScope(state));
    actor.record.deck = deck.cardIds;
    return this.dispatch(code, {
      type: 'start',
      playerId,
      lexicon: deck.lexicon,
      availableRounds: deck.cardIds.length,
    });
  }

  /** Plays a bonus, then answers with everything of the player's that it may have changed. */
  async useBonus(
    code: string,
    command: Extract<Command, { type: 'useBonus' }>,
  ): Promise<Reply | { ok: true; data: BonusUseReply }> {
    const reply = await this.dispatch(code, command);
    const state = this.actors.get(code)?.record.state;
    const data = reply.ok && state ? bonusReply(state, command.playerId, this.sign) : null;
    return data ? { ok: true, data } : reply;
  }

  /** `viewerId: null` is a shared screen. `screens` is how many of them the gateway counts. */
  snapshot(code: string, viewerId: string | null, screens: number): RoomStateView | null {
    const state = this.actors.get(code)?.record.state;
    if (!state || (viewerId !== null && !state.players[viewerId])) return null;
    return toSnapshot(state, viewerId, this.sign, Date.now(), screens);
  }

  /**
   * The card of a round a player was dealt, while the room still shows it (the round or its
   * reveal): what a "bad close-up" report is about. The card id itself never leaves the server.
   */
  cardOfRound(code: string, playerId: string, roundId: string): string | null {
    const state = this.actors.get(code)?.record.state;
    const round = state?.round;
    if (!round || round.id !== roundId || !round.perPlayer[playerId]) return null;
    return round.card.cardId;
  }

  /** Big-screen rooms cannot start blind: the gateway checks that a screen is there. */
  needsScreen(code: string): boolean {
    return this.actors.get(code)?.record.state.settings.display === 'bigscreen';
  }

  /** What anyone holding the code may know before joining. */
  summary(code: string): RoomSummary | null {
    const state = this.actors.get(code)?.record.state;
    // Solo has nothing to show; a public room is not joined by its code, only by the queue.
    if (!state || state.mode !== 'private') return null;
    return {
      code,
      phase: state.phase,
      hostNickname: (state.hostId && state.players[state.hostId]?.nickname) || '',
      display: state.settings.display ?? 'phones',
      playerCount: Object.values(state.players).filter((p) => !p.gone).length,
      maxPlayers: ROOM.maxPlayers,
      rounds: state.settings.rounds,
      answerMode: state.settings.answerMode,
    };
  }

  dispatch(code: string, command: Command): Promise<Reply> {
    const actor = this.actors.get(code);
    if (!actor) {
      return Promise.resolve({
        ok: false,
        error: { code: 'ROOM_NOT_FOUND', message: 'This room does not exist any more' },
      });
    }
    const result = actor.queue.then(() => this.run(code, actor, command));
    actor.queue = result.catch((error: unknown) => {
      this.logger.error(`Room ${code}: ${error instanceof Error ? error.stack : String(error)}`);
    });
    return result;
  }

  private async run(code: string, actor: Actor, command: Command): Promise<Reply> {
    const { state, effects, reply } = reduce(actor.record.state, command, {
      now: Date.now(),
      newId: randomUUID,
    });
    actor.record.state = state;
    for (const effect of effects) await this.apply(code, actor, effect);
    await this.persist(code, actor);
    this.arm(code, actor);
    return reply;
  }

  private async apply(code: string, actor: Actor, effect: Effect): Promise<void> {
    const { state } = actor.record;
    switch (effect.type) {
      case 'emit': {
        const messages =
          effect.event.type === 'gameEnd' && state.mode === 'solo'
            ? [{ event: 'game:end', payload: gameEnd(state, await this.personalBest(state)) }]
            : broadcast(state, effect.event, this.sign);
        // Private events name their recipient twice over: on the effect, and by their type.
        const to = effect.to ?? recipientOf(effect.event);
        for (const message of messages) this.listener(code, message, to);
        return;
      }
      case 'needCard':
        void this.supplyCard(code, actor);
        return;
      case 'needStart':
        // Outside the queue, back in through `start`, which builds the deck first.
        void this.start(code, state.hostId ?? '');
        return;
      case 'gameOver':
        // Not awaited: the ranking is already on everyone's screen, the archive can follow.
        void this.history.record(structuredClone(state));
        // Solo rooms are disposable. A private room stays for "play again" until it is abandoned.
        if (state.mode === 'solo') {
          setTimeout(() => void this.forget(code), ENDED_ROOM_KEPT_MS).unref();
        }
        return;
      case 'abandoned':
        setTimeout(() => void this.forget(code), 0).unref();
        return;
    }
  }

  /** Outside the queue (it waits on the database), then back in through `dispatch`. */
  private async supplyCard(code: string, actor: Actor): Promise<void> {
    const { state, deck } = actor.record;
    try {
      while (deck.length) {
        const card = await this.decks.load(
          deck.shift()!,
          state.language,
          state.settings.answerMode,
          deckScope(state),
        );
        if (card) {
          await this.dispatch(code, { type: 'cardReady', card });
          return;
        }
      }
    } catch (error) {
      this.logger.error(`Room ${code}: could not load a card: ${String(error)}`);
    }
    await this.dispatch(code, { type: 'noCardLeft' });
  }

  private arm(code: string, actor: Actor): void {
    clearTimeout(actor.timer);
    const { wakeAt } = actor.record.state;
    if (wakeAt === null) return;
    actor.timer = setTimeout(
      () => void this.dispatch(code, { type: 'tick' }),
      Math.max(0, wakeAt - Date.now()),
    );
  }

  private async persist(code: string, actor: Actor): Promise<void> {
    await this.redis
      .multi()
      .set(roomKey(code), JSON.stringify(actor.record), 'EX', ROOM_TTL_S)
      .sadd(ACTIVE_ROOMS, code)
      .exec();
  }

  private async forget(code: string): Promise<void> {
    clearTimeout(this.actors.get(code)?.timer);
    if (!this.actors.delete(code)) return;
    // A shared screen may still be showing this room: it offers to open another one.
    this.listener(code, { event: ServerEvent.roomClosed, payload: roomClosedSchema.parse({}) });
    await this.redis.multi().del(roomKey(code)).srem(ACTIVE_ROOMS, code).exec();
  }

  private async personalBest(state: RoomState): Promise<{ score: number; isNew: boolean }> {
    const player = state.players[state.hostId!]!;
    const configKey = `${state.settings.answerMode}:${state.totalRounds}`;
    const where = { playerId_configKey: { playerId: player.id, configKey } };
    const previous = await this.prisma.soloBest.findUnique({ where });
    if (previous && previous.score >= player.score) return { score: previous.score, isNew: false };

    await this.prisma.soloBest.upsert({
      where,
      create: { playerId: player.id, configKey, score: player.score },
      update: { score: player.score, achievedAt: new Date() },
    });
    return { score: player.score, isNew: true };
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM.codeLength; i++) {
        code += ROOM.codeAlphabet[randomInt(ROOM.codeAlphabet.length)];
      }
      if (!this.actors.has(code)) return code;
    }
  }
}
