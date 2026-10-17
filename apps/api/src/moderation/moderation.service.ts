import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AdminReport, ContentReport, ReportInput, SessionUser } from '@closeup/shared';
import { PrismaService } from '../prisma/prisma.module.js';

/**
 * Reports and bans. A ban is recorded here for the story (who, why, by whom, lifted when), but
 * enforced by `bannedAt` on the device and the account: the handshake of every socket reads
 * that, and must not join a table to do it.
 */
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  /** About a pack or a card of the public catalogue. Anybody who can see it can report it. */
  async reportContent(input: ContentReport, reporterPlayerId: string | null): Promise<void> {
    const label =
      input.targetType === 'PACK'
        ? (await this.prisma.pack.findUnique({ where: { id: input.targetId } }))?.titleFr
        : (
            await this.prisma.card.findUnique({
              where: { id: input.targetId },
              include: { answers: { take: 1 } },
            })
          )?.answers[0]?.text;
    if (label === undefined) throw new NotFoundException();

    await this.prisma.report.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        targetLabel: label || input.targetId,
        reporterPlayerId,
        reason: input.reason,
        message: input.message,
      },
    });
  }

  /** From a player, about a player they were just in a public game with. */
  async report(input: ReportInput, reporterPlayerId: string): Promise<void> {
    if (input.targetId === reporterPlayerId) {
      throw new BadRequestException({ code: 'CANNOT_REPORT_YOURSELF' });
    }
    const target = await this.prisma.player.findUnique({ where: { id: input.targetId } });
    if (!target) throw new NotFoundException();

    // One open report per pair: a second one is the same complaint, not a louder one.
    const already = await this.prisma.report.count({
      where: {
        targetType: 'PLAYER',
        targetId: input.targetId,
        reporterPlayerId,
        status: 'OPEN',
      },
    });
    if (already) return;

    await this.prisma.report.create({
      data: {
        targetType: 'PLAYER',
        targetId: input.targetId,
        // As reported: a rename afterwards must not hide who this was about.
        targetLabel: `${target.nickname} (${input.roomCode})`,
        reporterPlayerId,
        reason: input.reason,
        message: input.message,
      },
    });
  }

  async list(status: 'OPEN' | 'ALL'): Promise<AdminReport[]> {
    const reports = await this.prisma.report.findMany({
      where: status === 'OPEN' ? { status: 'OPEN' } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return Promise.all(
      reports.map(async (report): Promise<AdminReport> => {
        const [alsoReported, banned] = await Promise.all([
          report.targetId
            ? this.prisma.report.count({
                where: {
                  targetId: report.targetId,
                  status: 'OPEN',
                  NOT: { id: report.id },
                },
              })
            : 0,
          report.targetType === 'PLAYER' && report.targetId ? this.banState(report.targetId) : null,
        ]);
        return {
          id: report.id,
          targetType: report.targetType,
          targetId: report.targetId,
          targetLabel: report.targetLabel,
          reason: report.reason,
          message: report.message,
          status: report.status,
          note: report.note,
          createdAt: report.createdAt.toISOString(),
          alsoReported,
          banned,
        };
      }),
    );
  }

  /**
   * A submitted pack: published, or sent back with a word for its author. Publishing is the
   * only way a player's pack reaches the catalogue; `publicMatchSafe` stays the owner's call,
   * made afterwards on the pack itself.
   */
  async reviewPack(
    reportId: string,
    verdict: 'PUBLISH' | 'REJECT',
    note: string,
    actor: SessionUser,
  ): Promise<void> {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report?.targetId || report.targetType !== 'PACK') throw new NotFoundException();
    if (verdict === 'PUBLISH') {
      const pack = await this.prisma.pack.findUnique({ where: { id: report.targetId } });
      if (pack && !pack.publishable) throw new ConflictException({ code: 'NOT_PUBLISHABLE' });
    }

    await this.prisma.pack.update({
      where: { id: report.targetId },
      data: {
        visibility: verdict === 'PUBLISH' ? 'PUBLIC' : 'PRIVATE',
        reviewNote: note || null,
        reviewedAt: new Date(),
        ...(verdict === 'REJECT' ? { submittedAt: null } : {}),
      },
    });
    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'RESOLVED', note: note || null, reviewedAt: new Date() },
    });
    await this.audit(actor, `pack.${verdict.toLowerCase()}`, report.targetId, note);
  }

  async decide(
    id: string,
    status: 'RESOLVED' | 'DISMISSED',
    note: string,
    actor: SessionUser,
  ): Promise<void> {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException();
    await this.prisma.report.update({
      where: { id },
      data: { status, note: note || null, reviewedAt: new Date() },
    });
    await this.audit(actor, `report.${status.toLowerCase()}`, id, report.targetLabel);
  }

  /**
   * Bans the account behind a player and every device that plays as them: a ban on the account
   * alone is a new browser away, a ban on the device alone is a new login away.
   */
  async ban(playerId: string, reason: string, reportId: string | undefined, actor: SessionUser) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { devices: true },
    });
    if (!player) throw new NotFoundException();
    const bannedAt = new Date();

    await this.prisma.$transaction([
      ...(player.userId
        ? [
            this.prisma.user.update({ where: { id: player.userId }, data: { bannedAt } }),
            this.prisma.session.deleteMany({ where: { userId: player.userId } }),
          ]
        : []),
      this.prisma.device.updateMany({ where: { playerId }, data: { bannedAt } }),
      this.prisma.ban.createMany({
        data: [
          ...(player.userId
            ? [{ userId: player.userId, reason, actorId: actor.id, reportId }]
            : []),
          ...player.devices.map((device) => ({
            deviceId: device.id,
            reason,
            actorId: actor.id,
            reportId,
          })),
        ],
      }),
    ]);
    await this.audit(actor, 'player.ban', playerId, reason);
    return this.banState(playerId);
  }

  async unban(playerId: string, actor: SessionUser) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException();
    const liftedAt = new Date();
    const devices = await this.deviceIds(playerId);

    await this.prisma.$transaction([
      ...(player.userId
        ? [this.prisma.user.update({ where: { id: player.userId }, data: { bannedAt: null } })]
        : []),
      this.prisma.device.updateMany({ where: { playerId }, data: { bannedAt: null } }),
      this.prisma.ban.updateMany({
        where: {
          liftedAt: null,
          OR: [
            ...(player.userId ? [{ userId: player.userId }] : []),
            { deviceId: { in: devices } },
          ],
        },
        data: { liftedAt },
      }),
    ]);
    await this.audit(actor, 'player.unban', playerId);
    return this.banState(playerId);
  }

  private async deviceIds(playerId: string): Promise<string[]> {
    const devices = await this.prisma.device.findMany({
      where: { playerId },
      select: { id: true },
    });
    return devices.map((device) => device.id);
  }

  private async banState(playerId: string): Promise<{ user: boolean; devices: number }> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { user: true, devices: true },
    });
    return {
      user: Boolean(player?.user?.bannedAt),
      devices: player?.devices.filter((device) => device.bannedAt).length ?? 0,
    };
  }

  private audit(actor: SessionUser, action: string, targetId: string, note?: string) {
    return this.prisma.auditLog.create({
      data: { actorId: actor.id, action, targetType: 'moderation', targetId, note },
    });
  }
}
