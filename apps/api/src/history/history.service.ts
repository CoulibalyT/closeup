import { Injectable, Logger } from '@nestjs/common';
import type { RoomState } from '../game/engine/types.js';
import { PrismaService } from '../prisma/prisma.module.js';

/** Equal scores share a rank: 1, 2, 2, 4. */
export function rankByScore<T extends { score: number }>(players: T[]): (T & { rank: number })[] {
  return players.map((player) => ({
    ...player,
    rank: 1 + players.filter((other) => other.score > player.score).length,
  }));
}

/**
 * Writes a finished game down, once. Guests included: the history hangs on the player, which is
 * what lets an account inherit it later. A game is a good evening first: whatever goes wrong
 * here is logged and never reaches the room.
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger('History');

  constructor(private readonly prisma: PrismaService) {}

  async record(state: RoomState, endedAt = new Date()): Promise<string | null> {
    try {
      const played = Object.values(state.players).filter((p) => (p.roundsSeated ?? 0) > 0);
      if (!played.length || !state.history?.length) return null;

      // A player row can be gone by now: merged into an account while the game was running.
      const known = await this.prisma.player.findMany({
        where: { id: { in: played.map((p) => p.id) } },
        select: { id: true },
      });
      const ids = new Set(known.map((row) => row.id));
      const multiplayer = state.mode !== 'solo' && played.length >= 2;

      const game = await this.prisma.game.create({
        data: {
          mode: state.mode,
          display: state.settings.display ?? 'phones',
          answerMode: state.settings.answerMode,
          scoring: state.settings.scoring ?? 'decay',
          language: state.language,
          rounds: state.history.length,
          playerCount: played.length,
          startedAt: new Date(state.startedAt ?? endedAt.getTime()),
          endedAt,
          participants: {
            create: rankByScore(played)
              .filter((player) => ids.has(player.id))
              .map((player) => ({
                playerId: player.id,
                nickname: player.nickname,
                score: player.score,
                rank: player.rank,
                roundsSeated: player.roundsSeated ?? 0,
                correctCount: player.correctCount,
                bestStreak: player.bestStreak,
                answerMsTotal: Math.round(player.answerMsTotal ?? 0),
                multiplayer,
                endedAt,
              })),
          },
          roundRows: {
            create: state.history.map((round, index) => ({
              index,
              cardId: round.cardId,
              seated: round.seated,
              found: round.found,
              foundMsTotal: Math.round(round.foundMsTotal),
            })),
          },
        },
      });
      return game.id;
    } catch (error) {
      this.logger.error(`Game of room ${state.code} was not recorded: ${String(error)}`);
      return null;
    }
  }
}
