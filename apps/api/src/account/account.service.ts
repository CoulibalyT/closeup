import { Injectable } from '@nestjs/common';
import {
  type GameSummary,
  type PlayerStats,
  type RankingPeriod,
  type RankingRow,
  RANKINGS,
  type Rankings,
} from '@closeup/shared';
import { hashToken, newDeviceToken } from '../identity/device-token.js';
import { PrismaService } from '../prisma/prisma.module.js';

const DEFAULT_NICKNAME = 'Joueur';

interface RankingSqlRow {
  playerId: string;
  nickname: string;
  score: number;
  games: number;
  wins: number;
}

/**
 * Where guests and accounts meet. Identity never changes shape: a device points to a player,
 * and that is who plays. An account only decides *which* player a device points to: logging in
 * re-points the device (after folding the guest's history into the account's player), logging
 * out gives the device a fresh guest.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called on sign-up and on every login. Returns a device token to set as a cookie when the
   * browser had none. Nothing a guest played is ever lost: it is linked, or merged.
   */
  async adopt(
    userId: string,
    deviceToken: string | undefined,
  ): Promise<{ playerId: string; nickname: string; newDeviceToken?: string }> {
    const [mine, device] = await Promise.all([
      this.prisma.player.findUnique({ where: { userId } }),
      deviceToken
        ? this.prisma.device.findUnique({
            where: { tokenHash: hashToken(deviceToken) },
            include: { player: true },
          })
        : null,
    ]);

    if (!device) {
      const player = mine ?? (await this.newPlayer(DEFAULT_NICKNAME, userId));
      const token = newDeviceToken();
      await this.prisma.device.create({
        data: { tokenHash: hashToken(token), playerId: player.id },
      });
      return { playerId: player.id, nickname: player.nickname, newDeviceToken: token };
    }

    const guest = device.player;
    if (guest.id === mine?.id) return { playerId: mine.id, nickname: mine.nickname };

    // This browser's player belongs to somebody else's account (they never logged out, their
    // session just expired): it is not ours to take. Only this device moves.
    if (guest.userId !== null) {
      const player = mine ?? (await this.newPlayer(guest.nickname, userId));
      await this.prisma.device.update({ where: { id: device.id }, data: { playerId: player.id } });
      return { playerId: player.id, nickname: player.nickname };
    }

    // First device of a new account: the guest simply becomes the account's player.
    if (!mine) {
      const player = await this.prisma.player.update({ where: { id: guest.id }, data: { userId } });
      return { playerId: player.id, nickname: player.nickname };
    }

    await this.merge(guest.id, mine.id);
    // An account that never chose a name (it first logged in from a script, or as an admin)
    // takes the one its owner was playing under.
    if (mine.nickname === DEFAULT_NICKNAME && guest.nickname !== DEFAULT_NICKNAME) {
      await this.prisma.player.update({
        where: { id: mine.id },
        data: { nickname: guest.nickname },
      });
      return { playerId: mine.id, nickname: guest.nickname };
    }
    return { playerId: mine.id, nickname: mine.nickname };
  }

  /** Folds one player into another and deletes it. Both played the same game: the target's line stays. */
  async merge(fromId: string, intoId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const shared = await tx.gameParticipant.findMany({
        where: { playerId: intoId, game: { participants: { some: { playerId: fromId } } } },
        select: { gameId: true },
      });
      await tx.gameParticipant.deleteMany({
        where: { playerId: fromId, gameId: { in: shared.map((row) => row.gameId) } },
      });
      await tx.gameParticipant.updateMany({
        where: { playerId: fromId },
        data: { playerId: intoId },
      });

      // Personal bests: the better of the two, per configuration.
      for (const best of await tx.soloBest.findMany({ where: { playerId: fromId } })) {
        const where = { playerId_configKey: { playerId: intoId, configKey: best.configKey } };
        const existing = await tx.soloBest.findUnique({ where });
        if (!existing || existing.score < best.score) {
          const { score, achievedAt, configKey } = best;
          await tx.soloBest.upsert({
            where,
            create: { playerId: intoId, configKey, score, achievedAt },
            update: { score, achievedAt },
          });
        }
      }

      await tx.device.updateMany({ where: { playerId: fromId }, data: { playerId: intoId } });
      await tx.player.delete({ where: { id: fromId } });
    });
  }

  /** Logging out on a device hands it a fresh guest: the account's history stays with the account. */
  async release(deviceToken: string | undefined): Promise<void> {
    if (!deviceToken) return;
    const device = await this.prisma.device.findUnique({
      where: { tokenHash: hashToken(deviceToken) },
      include: { player: true },
    });
    if (!device || device.player.userId === null) return;
    const guest = await this.newPlayer(device.player.nickname, null);
    await this.prisma.device.update({ where: { id: device.id }, data: { playerId: guest.id } });
  }

  /**
   * The account goes, with its address and its password. Its games stay in other people's
   * rankings under an anonymous name; its own devices become fresh guests.
   */
  async forget(userId: string): Promise<void> {
    const player = await this.prisma.player.findUnique({
      where: { userId },
      include: { devices: true },
    });
    if (player) {
      for (const device of player.devices) {
        const guest = await this.newPlayer(DEFAULT_NICKNAME, null);
        await this.prisma.device.update({ where: { id: device.id }, data: { playerId: guest.id } });
      }
      await this.prisma.soloBest.deleteMany({ where: { playerId: player.id } });
      await this.prisma.gameParticipant.updateMany({
        where: { playerId: player.id },
        data: { nickname: DEFAULT_NICKNAME },
      });
      await this.prisma.player.update({
        where: { id: player.id },
        data: { nickname: DEFAULT_NICKNAME },
      });
    }
    // Sessions and reset links cascade; the player row is unlinked (ON DELETE SET NULL).
    await this.prisma.user.delete({ where: { id: userId } });
  }

  private newPlayer(nickname: string, userId: string | null) {
    return this.prisma.player.create({ data: { nickname, userId } });
  }

  // ---- statistics ----

  async stats(playerId: string): Promise<PlayerStats | null> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { soloBests: { orderBy: { score: 'desc' } } },
    });
    if (!player) return null;

    const where = { playerId };
    const [all, multiplayerGames, wins, recent] = await Promise.all([
      this.prisma.gameParticipant.aggregate({
        where,
        _count: true,
        _sum: { score: true, roundsSeated: true, correctCount: true, answerMsTotal: true },
        _max: { score: true, bestStreak: true },
      }),
      this.prisma.gameParticipant.count({ where: { ...where, multiplayer: true } }),
      this.prisma.gameParticipant.count({ where: { ...where, multiplayer: true, rank: 1 } }),
      this.prisma.gameParticipant.findMany({
        where,
        orderBy: { endedAt: 'desc' },
        take: 10,
        include: { game: { select: { mode: true, playerCount: true } } },
      }),
    ]);

    const found = all._sum.correctCount ?? 0;
    return {
      nickname: player.nickname,
      hasAccount: player.userId !== null,
      games: all._count,
      multiplayerGames,
      wins,
      totalScore: all._sum.score ?? 0,
      bestScore: all._max.score ?? 0,
      roundsSeated: all._sum.roundsSeated ?? 0,
      correctCount: found,
      bestStreak: all._max.bestStreak ?? 0,
      averageFoundMs: found ? Math.round((all._sum.answerMsTotal ?? 0) / found) : null,
      soloBests: player.soloBests.map((best) => ({
        configKey: best.configKey,
        score: best.score,
        achievedAt: best.achievedAt.toISOString(),
      })),
      recent: recent.map((row): GameSummary => ({
        gameId: row.gameId,
        endedAt: row.endedAt.toISOString(),
        mode: row.game.mode as GameSummary['mode'],
        score: row.score,
        rank: row.rank,
        playerCount: row.game.playerCount,
        correctCount: row.correctCount,
        roundsSeated: row.roundsSeated,
      })),
    };
  }

  // ---- rankings ----

  /**
   * Points scored in games with other people, by players who have an account: a guest is a
   * device, not somebody, and solo training against nobody is not a ranking.
   */
  async rankings(period: RankingPeriod, viewerPlayerId?: string): Promise<Rankings> {
    const since = period === 'week' ? new Date(Date.now() - RANKINGS.weekMs) : new Date(0);
    const totals = await this.prisma.$queryRaw<RankingSqlRow[]>`
      SELECT p."playerId", pl."nickname",
             SUM(p."score")::int AS "score",
             COUNT(*)::int AS "games",
             (COUNT(*) FILTER (WHERE p."rank" = 1))::int AS "wins"
      FROM "GameParticipant" p
      JOIN "Player" pl ON pl."id" = p."playerId"
      JOIN "User" u ON u."id" = pl."userId"
      WHERE p."multiplayer" AND u."bannedAt" IS NULL AND p."endedAt" >= ${since}
      GROUP BY p."playerId", pl."nickname"
      ORDER BY "score" DESC, "games" ASC, pl."nickname" ASC`;

    // Already sorted by score: equal totals share the rank of the first of them.
    const rows: RankingRow[] = [];
    totals.forEach((row, index) => {
      const previous = rows[index - 1];
      rows.push({
        rank: previous && totals[index - 1]!.score === row.score ? previous.rank : index + 1,
        nickname: row.nickname,
        score: row.score,
        games: row.games,
        wins: row.wins,
        you: row.playerId === viewerPlayerId,
      });
    });
    const top = rows.slice(0, RANKINGS.size);
    const mine = rows.find((row) => row.you);
    return { period, rows: top, you: mine && !top.includes(mine) ? mine : null };
  }
}
