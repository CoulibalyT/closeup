import { readFile, writeFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@closeup/shared';
import { AdminContentService } from '../../admin/admin-content.service.js';
import { PrismaService } from '../../prisma/prisma.module.js';

/**
 * The owner's review of the dataset packs (points placed by hand, levels, cards taken out),
 * written to a file on one base and played back on another: the local stack reviews, the
 * server receives. A card is known by its pack and its slug (`wd-Q…`, `ds-…`), which the import
 * makes the same everywhere; points are kept as shares of the picture, so the size of the
 * stored original does not matter.
 */
interface CardCorrection {
  pack: string;
  slug: string;
  difficulty: number;
  /** Taken out of play (READY): the owner switched it off. */
  off: boolean;
  /** x, y and radius as shares of the width, the height and the shorter side. */
  points: { x: number; y: number; r: number }[];
}
interface CorrectionsFile {
  version: 1;
  exportedAt: string;
  cards: CardCorrection[];
}
export interface CorrectionsResult {
  cards: number;
  points: number;
  difficulty: number;
  off: number;
  on: number;
  missing: number;
}

const WAIT_MS = 1_000;
const WAIT_LIMIT_MS = 10 * 60_000;
/** Two points closer than this share of the picture are the same point. */
const SAME = 0.005;

@Injectable()
export class DatasetCorrections {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminContentService,
  ) {}

  async export(file: string, prefix = 'ds'): Promise<{ cards: number }> {
    const cards = await this.prisma.card.findMany({
      where: {
        pack: { slug: { startsWith: `${prefix}-` } },
        status: { in: ['LIVE', 'READY'] },
        imageId: { not: null },
      },
      include: {
        pack: { select: { slug: true } },
        image: true,
        zoomPoints: { orderBy: { id: 'asc' } },
      },
      orderBy: { slug: 'asc' },
    });
    const out: CorrectionsFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: cards
        .filter((card) => card.slug && card.image)
        .map((card) => {
          const { width, height } = card.image!;
          const side = Math.min(width, height);
          return {
            pack: card.pack.slug!,
            slug: card.slug!,
            difficulty: card.difficulty,
            off: card.status === 'READY',
            points: card.zoomPoints.map((p) => ({
              x: round(p.x / width),
              y: round(p.y / height),
              r: round(p.baseRadius / side),
            })),
          };
        }),
    };
    await writeFile(file, JSON.stringify(out, null, 1));
    return { cards: out.cards.length };
  }

  /** Plays a review back. Idempotent: what already matches is left alone. */
  async apply(
    file: string,
    ownerEmail: string | undefined,
    prefix = 'ds',
  ): Promise<CorrectionsResult> {
    const actor = await this.actorOf(ownerEmail);
    const data = JSON.parse(await readFile(file, 'utf8')) as CorrectionsFile;
    const result: CorrectionsResult = {
      cards: 0,
      points: 0,
      difficulty: 0,
      off: 0,
      on: 0,
      missing: 0,
    };
    const relive: string[] = [];
    const offs: string[] = [];

    for (const wanted of data.cards) {
      const pack = wanted.pack.replace(/^ds-/, `${prefix}-`);
      // A catalogue pack is numbered by its run ("bulk-objects-2" here, "-1" there): any pack of
      // the same family will do, the subject's slug is what identifies the card.
      const family = /^bulk-(.+)-\d+$/.exec(pack)?.[1];
      const card = await this.prisma.card.findFirst({
        where: {
          slug: wanted.slug.replace(/^ds-/, `${prefix}-`),
          pack: family ? { slug: { startsWith: `bulk-${family}-` } } : { slug: pack },
        },
        include: { image: true, zoomPoints: { orderBy: { id: 'asc' } } },
      });
      if (!card?.image || card.status === 'PROCESSING') {
        result.missing++;
        continue;
      }
      result.cards++;
      if (card.difficulty !== wanted.difficulty) {
        await this.prisma.card.update({
          where: { id: card.id },
          data: { difficulty: wanted.difficulty },
        });
        result.difficulty++;
      }
      const { width, height } = card.image;
      const side = Math.min(width, height);
      const now = card.zoomPoints.map((p) => ({ x: p.x / width, y: p.y / height }));
      const same =
        now.length === wanted.points.length &&
        wanted.points.every((p) =>
          now.some((q) => Math.abs(q.x - p.x) < SAME && Math.abs(q.y - p.y) < SAME),
        );
      if (!same && wanted.points.length >= 2) {
        await this.admin.setZoomPoints(
          card.id,
          wanted.points.map((p) => ({
            x: Math.min(width, Math.round(p.x * width)),
            y: Math.min(height, Math.round(p.y * height)),
            baseRadius: Math.max(4, Math.round(p.r * side)),
            labelFr: '',
            labelEn: '',
            weight: 1,
            origin: 'MANUAL' as const,
          })),
          actor,
        );
        result.points++;
      }
      // Whether it plays is settled once its crops are cut.
      if (wanted.off && (card.status === 'LIVE' || !same)) offs.push(card.id);
      if (!wanted.off && (card.status !== 'LIVE' || !same)) relive.push(card.id);
    }

    await this.waitForCrops(prefix);
    for (const id of offs) {
      const card = await this.prisma.card.findUniqueOrThrow({ where: { id } });
      if (card.status === 'LIVE') {
        await this.admin.setLive(id, false, actor);
        result.off++;
      }
    }
    for (const id of relive) {
      const card = await this.prisma.card.findUniqueOrThrow({ where: { id } });
      if (card.status === 'READY') {
        await this.admin.setLive(id, true, actor);
        result.on++;
      }
    }
    return result;
  }

  private async waitForCrops(prefix: string): Promise<void> {
    const until = Date.now() + WAIT_LIMIT_MS;
    while (Date.now() < until) {
      const pending = await this.prisma.card.count({
        where: { status: 'PROCESSING', pack: { slug: { startsWith: `${prefix}-` } } },
      });
      if (!pending) return;
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
    throw new Error('Pictures still being cut after 10 min: is the worker running?');
  }

  private async actorOf(email: string | undefined): Promise<SessionUser> {
    const user = email
      ? await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } })
      : null;
    if (!user || user.role !== 'ADMIN') {
      throw new Error(
        'OWNER_EMAIL must name the admin account: the changes are written in its name.',
      );
    }
    return {
      id: user.id,
      email: user.email,
      role: 'ADMIN',
      playerId: null,
      nickname: null,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
