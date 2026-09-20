import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CardStatus,
  type CataloguePack,
  type Category,
  type MyPack,
  type MyQuota,
  type PackCredits,
  type PackDraft,
  QUOTA,
  RESTRICTED_CATEGORIES,
  type Takedown,
} from '@closeup/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { MediaTokens } from '../media/media-tokens.js';
import { PrismaService } from '../prisma/prisma.module.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a pack looks like in a list: its author, how many cards are playable, and one level-1
 * crop as a cover — a taste of a card, never its answer.
 */
const LISTED = {
  owner: { select: { nickname: true } },
  _count: { select: { cards: { where: { status: 'LIVE' } } } },
  cards: {
    where: { status: 'LIVE' },
    take: 1,
    orderBy: { createdAt: 'asc' },
    include: { zoomPoints: { take: 1, include: { crops: { where: { level: 1 }, take: 1 } } } },
  },
} satisfies Prisma.PackInclude;

type ListedPack = Prisma.PackGetPayload<{ include: typeof LISTED }>;

/**
 * Packs made by players, and the catalogue the finished ones end up in. Editing the cards
 * inside is the back-office's editor, reached through `/api/me/...` with an ownership check:
 * one editor, one pipeline, whoever the author is.
 */
@Injectable()
export class PacksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MediaTokens) private readonly tokens: MediaTokens,
  ) {}

  // ---- the author's own packs ----

  async mine(playerId: string): Promise<MyPack[]> {
    const packs = await this.prisma.pack.findMany({
      where: { ownerId: playerId },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.prisma.card.groupBy({
      by: ['packId', 'status'],
      where: { packId: { in: packs.map((pack) => pack.id) } },
      _count: true,
    });
    return packs.map((pack) => this.myPack(pack, counts));
  }

  async quota(playerId: string): Promise<MyQuota> {
    const [packs, uploadsToday] = await Promise.all([
      this.prisma.pack.count({ where: { ownerId: playerId } }),
      this.prisma.card.count({
        where: {
          pack: { ownerId: playerId },
          rightsConfirmedAt: { gte: new Date(Date.now() - DAY_MS) },
        },
      }),
    ]);
    return {
      packs: { used: packs, max: QUOTA.packs },
      uploadsToday: { used: uploadsToday, max: QUOTA.uploadsPerDay },
    };
  }

  async create(playerId: string, draft: PackDraft): Promise<MyPack> {
    const { packs } = await this.quota(playerId);
    if (packs.used >= packs.max) throw new ConflictException({ code: 'QUOTA_PACKS' });
    const pack = await this.prisma.pack.create({
      data: {
        ...draft,
        ownerId: playerId,
        visibility: 'PRIVATE',
        restricted: RESTRICTED_CATEGORIES.includes(draft.category),
      },
    });
    return this.myPack(pack, []);
  }

  async update(playerId: string, id: string, draft: PackDraft): Promise<MyPack> {
    const pack = await this.own(playerId, id);
    if (pack.visibility === 'PENDING_REVIEW') throw new ConflictException({ code: 'IN_REVIEW' });
    const updated = await this.prisma.pack.update({
      where: { id },
      data: { ...draft, restricted: RESTRICTED_CATEGORIES.includes(draft.category) },
    });
    return this.myPack(updated, await this.counts(id));
  }

  /**
   * Asking for publication. It goes to the moderation queue; until somebody says yes it stays
   * exactly as playable as it was, which is to say playable in its author's own rooms.
   */
  async submit(playerId: string, id: string): Promise<MyPack> {
    const pack = await this.own(playerId, id);
    if (pack.visibility === 'PUBLIC') throw new ConflictException({ code: 'ALREADY_PUBLIC' });
    if (pack.visibility === 'PENDING_REVIEW') throw new ConflictException({ code: 'IN_REVIEW' });

    const playable = await this.prisma.card.count({ where: { packId: id, status: 'LIVE' } });
    if (playable < 1) throw new ConflictException({ code: 'NO_PLAYABLE_CARD' });

    const updated = await this.prisma.pack.update({
      where: { id },
      data: { visibility: 'PENDING_REVIEW', submittedAt: new Date(), reviewNote: null },
    });
    await this.prisma.report.create({
      data: {
        targetType: 'PACK',
        targetId: id,
        targetLabel: `${pack.titleFr} — ${playable} carte(s)`,
        reporterPlayerId: playerId,
        reason: 'submission',
        message: pack.descriptionFr,
      },
    });
    return this.myPack(updated, await this.counts(id));
  }

  /** Taking it back: out of the queue, or out of the catalogue. */
  async withdraw(playerId: string, id: string): Promise<MyPack> {
    const pack = await this.own(playerId, id);
    const updated = await this.prisma.pack.update({
      where: { id },
      data: { visibility: 'PRIVATE', publicMatchSafe: false, submittedAt: null },
    });
    await this.prisma.report.updateMany({
      where: { targetType: 'PACK', targetId: id, reason: 'submission', status: 'OPEN' },
      data: { status: 'DISMISSED', reviewedAt: new Date(), note: 'withdrawn by its author' },
    });
    return this.myPack(updated, await this.counts(pack.id));
  }

  async remove(playerId: string, id: string): Promise<void> {
    const pack = await this.own(playerId, id);
    if (pack.visibility === 'PUBLIC') throw new ConflictException({ code: 'PUBLIC_PACK' });
    // Cards, their images and their crops go with it (see AdminContentService.deleteCard for
    // the files: this only deletes rows, the media folder is swept by the worker).
    await this.prisma.pack.delete({ where: { id } });
  }

  /** Every write to a card of this pack goes through here first. */
  async own(playerId: string, id: string) {
    const pack = await this.prisma.pack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException();
    if (pack.ownerId !== playerId) throw new ForbiddenException();
    return pack;
  }

  async canAddCard(playerId: string, packId: string): Promise<void> {
    const pack = await this.own(playerId, packId);
    if (pack.visibility === 'PENDING_REVIEW') throw new ConflictException({ code: 'IN_REVIEW' });
    const cards = await this.prisma.card.count({ where: { packId } });
    if (cards >= QUOTA.cardsPerPack) throw new ConflictException({ code: 'QUOTA_CARDS' });
  }

  async canUpload(playerId: string): Promise<void> {
    const { uploadsToday } = await this.quota(playerId);
    if (uploadsToday.used >= uploadsToday.max)
      throw new ConflictException({ code: 'QUOTA_UPLOADS' });
  }

  // ---- the public catalogue ----

  async catalogue(
    language: string,
    category?: Category,
    sort = 'recent',
  ): Promise<CataloguePack[]> {
    const packs = await this.prisma.pack.findMany({
      // Restricted packs (real people, fictional characters) are never listed: the brief keeps
      // them off the landing page, previews and search engines. They are reached by their link.
      where: { visibility: 'PUBLIC', restricted: false, ...(category ? { category } : {}) },
      orderBy: sort === 'name' ? { titleFr: 'asc' } : { createdAt: 'desc' },
      include: LISTED,
    });
    return packs.map((pack) => this.catalogueRow(pack, language));
  }

  /** Every published pack owes its images a credit; this is where they are read. */
  async credits(id: string, language: string): Promise<PackCredits> {
    const pack = await this.prisma.pack.findFirst({
      where: { id, visibility: 'PUBLIC' },
      include: {
        owner: { select: { nickname: true } },
        cards: {
          where: { status: { in: ['LIVE', 'READY'] } },
          include: { answers: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!pack) throw new NotFoundException();
    return {
      id: pack.id,
      title: language === 'en' ? pack.titleEn : pack.titleFr,
      description: language === 'en' ? pack.descriptionEn : pack.descriptionFr,
      authorNickname: pack.owner?.nickname ?? null,
      restricted: pack.restricted,
      cards: pack.cards.map((card) => ({
        answer:
          card.answers.find((a) => a.locale === language)?.text ?? card.answers[0]?.text ?? '',
        author: card.creditAuthor ?? '',
        licence: card.creditLicence ?? '',
        sourceUrl: card.creditSourceUrl,
      })),
    };
  }

  /** Packs a room may be told to play: the catalogue, plus the host's own. */
  async playableFor(playerId: string | undefined, language: string): Promise<CataloguePack[]> {
    const packs = await this.prisma.pack.findMany({
      where: {
        OR: [{ visibility: 'PUBLIC' }, ...(playerId ? [{ ownerId: playerId }] : [])],
      },
      orderBy: [{ ownerId: 'desc' }, { createdAt: 'desc' }],
      include: LISTED,
    });
    return packs
      .filter((pack) => pack._count.cards > 0)
      .map((pack) => this.catalogueRow(pack, language));
  }

  // ---- takedown ----
  // ---- takedown ----

  async takedown(request: Takedown): Promise<void> {
    if (!request.message.trim()) throw new BadRequestException();
    await this.prisma.report.create({
      data: {
        targetType: 'TAKEDOWN',
        targetLabel: request.about,
        reason: 'takedown',
        message: request.message,
        contactEmail: request.contactEmail,
      },
    });
  }

  // ---- views ----

  private counts(packId: string) {
    return this.prisma.card.groupBy({ by: ['packId', 'status'], where: { packId }, _count: true });
  }

  private myPack(
    pack: Prisma.PackGetPayload<object>,
    counts: { packId: string; status: CardStatus; _count: number }[],
  ): MyPack {
    const mine = counts.filter((row) => row.packId === pack.id);
    return {
      id: pack.id,
      titleFr: pack.titleFr,
      titleEn: pack.titleEn,
      descriptionFr: pack.descriptionFr,
      descriptionEn: pack.descriptionEn,
      category: pack.category,
      visibility: pack.visibility,
      reviewNote: pack.reviewNote,
      submittedAt: pack.submittedAt?.toISOString() ?? null,
      cards: Object.fromEntries(mine.map((row) => [row.status, row._count])),
      playableCards: mine.find((row) => row.status === 'LIVE')?._count ?? 0,
      updatedAt: pack.updatedAt.toISOString(),
    };
  }

  private catalogueRow(pack: ListedPack, language: string): CataloguePack {
    const crop = pack.cards[0]?.zoomPoints[0]?.crops[0];
    return {
      id: pack.id,
      title: language === 'en' ? pack.titleEn : pack.titleFr,
      description: language === 'en' ? pack.descriptionEn : pack.descriptionFr,
      category: pack.category,
      cards: pack._count.cards,
      byPlayer: pack.ownerId !== null,
      authorNickname: pack.owner?.nickname ?? null,
      publicMatchSafe: pack.publicMatchSafe,
      restricted: pack.restricted,
      coverUrl: crop ? `/api/media/${this.tokens.seal('crop', crop.id, Date.now())}` : null,
    };
  }
}
