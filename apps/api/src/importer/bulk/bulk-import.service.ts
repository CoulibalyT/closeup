import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type BulkFamily,
  type BulkImportView,
  type BulkStartInput,
  type BulkStatus,
  type SessionUser,
} from '@closeup/shared';
import { AppConfig } from '../../config/app-config.js';
import type { BulkImport } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.module.js';

/**
 * The admin's side of a mass import: a row that the worker's runner drives. Starting is making
 * the row; pausing, resuming and stopping are setting its status, which the runner reads at
 * every step. One run at a time per stack.
 */
@Injectable()
export class BulkImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** The latest run of this stack, whatever its state. */
  async current(): Promise<BulkImportView | null> {
    const row = await this.prisma.bulkImport.findFirst({
      where: { queuePrefix: this.config.env.QUEUE_PREFIX },
      orderBy: { startedAt: 'desc' },
    });
    return row ? this.view(row) : null;
  }

  async start(input: BulkStartInput, actor: SessionUser): Promise<BulkImportView> {
    const busy = await this.prisma.bulkImport.findFirst({
      where: { queuePrefix: this.config.env.QUEUE_PREFIX, status: { in: ['running', 'paused'] } },
    });
    if (busy) throw new ConflictException({ code: 'BULK_RUNNING' });
    const row = await this.prisma.bulkImport.create({
      data: {
        queuePrefix: this.config.env.QUEUE_PREFIX,
        family: input.family,
        target: input.target,
        status: 'running',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'bulk.start',
        targetType: 'bulkImport',
        targetId: row.id,
        note: `${input.family} × ${input.target}`,
      },
    });
    return this.view(row);
  }

  pause = (id: string) => this.transition(id, ['running'], 'paused');
  resume = (id: string) => this.transition(id, ['paused'], 'running');
  stop = (id: string) => this.transition(id, ['running', 'paused'], 'stopped');

  private async transition(id: string, from: BulkStatus[], to: BulkStatus) {
    const row = await this.prisma.bulkImport.findUnique({ where: { id } });
    if (!row || row.queuePrefix !== this.config.env.QUEUE_PREFIX) throw new NotFoundException();
    if (!from.includes(row.status as BulkStatus)) {
      throw new ConflictException({ code: 'BULK_STATE' });
    }
    return this.view(await this.prisma.bulkImport.update({ where: { id }, data: { status: to } }));
  }

  /** Counts come from the cards themselves: the worker finishes them after the row moved on. */
  async view(row: BulkImport): Promise<BulkImportView> {
    const counts = await this.prisma.card.groupBy({
      by: ['status'],
      where: { bulkImportId: row.id },
      _count: true,
    });
    const of = (...statuses: string[]) =>
      counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count, 0);
    const created = counts.reduce((n, c) => n + c._count, 0);
    const hours = (Date.now() - row.startedAt.getTime()) / 3_600_000;
    const perHour = hours > 0.05 && created ? Math.round(created / hours) : null;
    return {
      id: row.id,
      family: row.family as BulkFamily,
      target: row.target,
      status: row.status as BulkStatus,
      created,
      published: of('LIVE'),
      waiting: of('PROCESSING', 'NEEDS_POINTS', 'READY'),
      skipped: row.skipped,
      skipReasons: row.skipReasons as Record<string, number>,
      cursor: row.cursor as BulkImportView['cursor'],
      note: row.note,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      perHour,
      minutesLeft:
        perHour && row.status === 'running'
          ? Math.max(0, Math.round(((row.target - created) / perHour) * 60))
          : null,
    };
  }
}
