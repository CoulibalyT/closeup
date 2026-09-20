import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  formRoom,
  type Locale,
  MATCHMAKING,
  PUBLIC_SETTINGS,
  type QueueStatus,
  queueKey,
  queueStatus,
  type Waiting,
} from '@closeup/shared';
import type { Redis } from 'ioredis';
import { withTimeout } from '../../common/with-timeout.js';
import { REDIS } from '../../redis/redis.module.js';
import { RoomService } from '../rooms/room.service.js';

const REDIS_TIMEOUT_MS = 1_500;
const TICK_MS = 1_000;

/** Told to the gateway: these players have a room now. */
export type MatchListener = (language: Locale, players: Waiting[], code: string) => void;
export type QueueListener = (language: Locale, status: QueueStatus) => void;

/**
 * The public queue: one per language, so strangers who are matched can read the same answers.
 * Entries are kept in Redis as the brief asks, but they are only meaningful while their socket
 * is connected, so the queues are emptied at boot: a queue of a dead process is a queue of
 * ghosts. Like rooms, this assumes the single API instance the deployment plans for.
 */
@Injectable()
export class MatchmakingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Matchmaking');
  private timer?: NodeJS.Timeout;
  private onMatch: MatchListener = () => undefined;
  private onQueue: QueueListener = () => undefined;
  /** One pass at a time: forming a room is a read, a delete and a create. */
  private pass: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rooms: RoomService,
  ) {}

  listen(onMatch: MatchListener, onQueue: QueueListener): void {
    this.onMatch = onMatch;
    this.onQueue = onQueue;
  }

  async onApplicationBootstrap(): Promise<void> {
    const keys = (['fr', 'en'] as const).map(queueKey);
    await withTimeout(this.redis.del(...keys), REDIS_TIMEOUT_MS, 'redis').catch((error: Error) => {
      this.logger.warn(`Queues were not cleared: ${error.message}`);
    });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Joining twice is joining once: the queue is a set, keyed by player. */
  async join(language: Locale, player: Omit<Waiting, 'since'>, now = Date.now()): Promise<void> {
    const entry: Waiting = { ...player, since: now };
    await this.redis.hset(queueKey(language), player.playerId, JSON.stringify(entry));
    await this.announce(language);
    await this.tick();
  }

  async leave(language: Locale, playerId: string): Promise<void> {
    const removed = await this.redis.hdel(queueKey(language), playerId);
    if (removed) await this.announce(language);
  }

  /** A player only ever waits in one queue; leaving is cheap, so leave them all. */
  async leaveAll(playerId: string): Promise<void> {
    for (const language of ['fr', 'en'] as const) await this.leave(language, playerId);
  }

  async status(language: Locale): Promise<QueueStatus> {
    return queueStatus(await this.queue(language));
  }

  private async queue(language: Locale): Promise<Waiting[]> {
    const raw = await this.redis.hvals(queueKey(language));
    return raw.flatMap((entry) => {
      try {
        return [JSON.parse(entry) as Waiting];
      } catch {
        return [];
      }
    });
  }

  private async announce(language: Locale): Promise<void> {
    this.onQueue(language, await this.status(language));
  }

  /** Every second, and after every join: is there a room to form? */
  private tick(): Promise<unknown> {
    this.pass = this.pass
      .then(() => this.formRooms())
      .catch((error: unknown) => {
        this.logger.error(`Matchmaking pass failed: ${String(error)}`);
      });
    return this.pass;
  }

  private async formRooms(): Promise<void> {
    for (const language of ['fr', 'en'] as const) {
      const queue = await this.queue(language);
      const players = formRoom(queue, Date.now());
      if (!players) continue;

      // Out of the queue first: a player must never end up in two rooms.
      await this.redis.hdel(queueKey(language), ...players.map((player) => player.playerId));
      // The first of the queue holds the room, but nobody presses start: it starts by itself
      // once everyone the queue matched is in, or when the wait runs out.
      const [first] = players;
      const code = await this.rooms.create(
        'public',
        { playerId: first!.playerId, nickname: first!.nickname },
        { ...PUBLIC_SETTINGS },
        language,
        players.length,
      );
      this.logger.log(`Public room ${code} (${language}) for ${players.length} player(s)`);
      this.onMatch(language, players, code);
      await this.announce(language);
    }
  }

  /** Public rooms are fixed: the queue page shows what everybody is about to play. */
  readonly settings = { ...PUBLIC_SETTINGS, maxPlayers: MATCHMAKING.maxPlayers };
}
