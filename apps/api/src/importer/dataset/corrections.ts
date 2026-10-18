import { readFile, writeFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { type FaceDetection, faceOf, type SessionUser } from '@closeup/shared';
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
  /**
   * x, y and radius as shares of the width, the height and the shorter side; the label says what
   * part of a face the point is on, which the room difficulty reads ("an eye", "the nose"…).
   */
  points: { x: number; y: number; r: number; fr?: string; en?: string }[];
  /** A face's eyes and nose, as shares, when detection gave them or they were placed by hand. */
  face?: { leftEye: Share; rightEye: Share; nose: Share };
  /** The photo these points were placed on (dataset cards): another photo, they are stale. */
  sourceHash?: string;
}
interface Share {
  x: number;
  y: number;
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
  /** Reviewed on a photo the dataset has replaced since: left alone, to review again. */
  stale: number;
  /** Face landmarks written (placed by hand where detection found nothing). */
  faces: number;
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
          const face = faceOf(card.detection as FaceDetection | null);
          const share = (p: { x: number; y: number }) => ({
            x: round(p.x / width),
            y: round(p.y / height),
          });
          return {
            pack: card.pack.slug!,
            slug: card.slug!,
            difficulty: card.difficulty,
            off: card.status === 'READY',
            ...(card.sourceHash ? { sourceHash: card.sourceHash } : {}),
            points: card.zoomPoints.map((p) => ({
              x: round(p.x / width),
              y: round(p.y / height),
              r: round(p.baseRadius / side),
              ...(p.labelEn ? { en: p.labelEn } : {}),
              ...(p.labelFr ? { fr: p.labelFr } : {}),
            })),
            ...(face
              ? {
                  face: {
                    leftEye: share(face.leftEye),
                    rightEye: share(face.rightEye),
                    nose: share(face.nose),
                  },
                }
              : {}),
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
      stale: 0,
      faces: 0,
    };
    const relive: string[] = [];
    const offs: string[] = [];

    for (const wanted of data.cards) {
      const pack = wanted.pack.replace(/^ds-/, `${prefix}-`);
      // A catalogue pack is numbered by its run ("bulk-objects-2" here, "-1" there): any pack of
      // the same family will do, the subject's slug is what identifies the card.
      // Same for a full dataset pack: "ds-acteur — 2" is `ds-acteur-2`.
      const family = /^bulk-(.+)-\d+$/.exec(pack)?.[1];
      const base = family ? `bulk-${family}` : pack.replace(/-\d+$/, '');
      const candidates = await this.prisma.card.findMany({
        where: {
          slug: wanted.slug.replace(/^ds-/, `${prefix}-`),
          pack: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
        },
        include: {
          pack: { select: { slug: true } },
          image: true,
          zoomPoints: { orderBy: { id: 'asc' } },
        },
      });
      const card = candidates.find(
        (c) => c.pack.slug === base || /^-\d+$/.test(c.pack.slug!.slice(base.length)),
      );
      if (!card?.image || card.status === 'PROCESSING') {
        result.missing++;
        continue;
      }
      if (wanted.sourceHash && card.sourceHash && wanted.sourceHash !== card.sourceHash) {
        result.stale++;
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
      const faceChanged = wanted.face ? await this.placeFace(card, wanted.face) : false;
      if (faceChanged) result.faces++;
      const now = card.zoomPoints.map((p) => ({
        x: p.x / width,
        y: p.y / height,
        en: p.labelEn ?? '',
      }));
      const samePoints =
        now.length === wanted.points.length &&
        wanted.points.every((p) =>
          now.some(
            (q) =>
              Math.abs(q.x - p.x) < SAME && Math.abs(q.y - p.y) < SAME && q.en === (p.en ?? ''),
          ),
        );
      // New landmarks frame the views anew: the card is cut again, with the same points.
      const same = samePoints && !faceChanged;
      if (!same && wanted.points.length >= 2) {
        await this.admin.setZoomPoints(
          card.id,
          wanted.points.map((p) => ({
            x: Math.min(width, Math.round(p.x * width)),
            y: Math.min(height, Math.round(p.y * height)),
            baseRadius: Math.max(4, Math.round(p.r * side)),
            labelFr: p.fr ?? '',
            labelEn: p.en ?? '',
            weight: 1,
            origin: 'MANUAL' as const,
          })),
          actor,
        );
        if (!samePoints) result.points++;
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

  /** Writes the face's landmarks into the card's detection; false when they already match. */
  private async placeFace(
    card: { id: string; detection: unknown; image: { width: number; height: number } | null },
    wanted: NonNullable<CardCorrection['face']>,
  ): Promise<boolean> {
    const { width, height } = card.image!;
    const detection = (card.detection as FaceDetection | null) ?? null;
    const now = faceOf(detection);
    const px = (p: Share) => ({ x: p.x * width, y: p.y * height });
    const zones = {
      leftEye: px(wanted.leftEye),
      rightEye: px(wanted.rightEye),
      nose: px(wanted.nose),
    };
    const close = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) / width < SAME && Math.abs(a.y - b.y) / height < SAME;
    if (
      now &&
      close(now.leftEye, zones.leftEye) &&
      close(now.rightEye, zones.rightEye) &&
      close(now.nose, zones.nose)
    ) {
      return false;
    }
    const d = Math.hypot(zones.leftEye.x - zones.rightEye.x, zones.leftEye.y - zones.rightEye.y);
    const kept = (detection?.proposals ?? []).filter((p) => !(p.zone in zones));
    const placed = Object.entries(zones).map(([zone, p]) => ({
      zone,
      x: p.x,
      y: p.y,
      baseRadius: d / 2,
      labelFr: '',
      labelEn: '',
      weight: 1,
    }));
    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        detection: {
          verdict: detection?.verdict ?? 'none',
          faces: detection?.faces ?? 0,
          eyeDistancePx: detection?.eyeDistancePx ?? Math.round(d),
          proposals: [...kept, ...placed],
        } as never,
      },
    });
    return true;
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
