import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AdminCard,
  type AdminCardSummary,
  type AdminPack,
  type CardInput,
  type CardStatus,
  checkUpload,
  type FaceDetection,
  type PackInput,
  publishBlockers,
  type PublishBlocker,
  RESTRICTED_CATEGORIES,
  type SessionUser,
  ZOOM,
  type ZoomPointInput,
} from '@closeup/shared';
import type { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client.js';
import { MediaTokens } from '../media/media-tokens.js';
import { STORAGE, type StorageDriver, storageKeys } from '../media/storage.js';
import { MEDIA_QUEUE, MediaJob } from '../pipeline/media-queue.js';
import { PrismaService } from '../prisma/prisma.module.js';

const cardInclude = {
  image: true,
  answers: true,
  zoomPoints: { include: { crops: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.CardInclude;
type CardRow = Prisma.CardGetPayload<{ include: typeof cardInclude }>;

const JOB_OPTIONS = { attempts: 3, backoff: 2_000 };
const LEVELS = ZOOM.maxLevel + 1;

/**
 * Everything the back-office does to content. It never touches pixels: images go to the worker
 * through the queue, like the seed's and later the importer's.
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: MediaTokens,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue,
  ) {}

  // ---- packs ----

  async listPacks(): Promise<AdminPack[]> {
    const [packs, counts] = await Promise.all([
      this.prisma.pack.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.card.groupBy({ by: ['packId', 'status'], _count: true }),
    ]);
    return packs.map((pack) => this.packView(pack, counts));
  }

  async getPack(id: string): Promise<{ pack: AdminPack; cards: AdminCardSummary[] }> {
    const pack = await this.prisma.pack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException();
    const [counts, cards] = await Promise.all([
      this.prisma.card.groupBy({ by: ['packId', 'status'], where: { packId: id }, _count: true }),
      this.prisma.card.findMany({
        where: { packId: id },
        include: cardInclude,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      pack: this.packView(pack, counts),
      cards: cards.map((card) => {
        const answer = (locale: string) => card.answers.find((a) => a.locale === locale)?.text;
        return {
          id: card.id,
          status: card.status,
          answerFr: answer('fr') ?? '',
          answerEn: answer('en') ?? '',
          difficulty: card.difficulty,
          points: card.zoomPoints.length,
          thumbnailUrl: card.image?.revealKey ? this.imageUrl(card.image.id) : null,
          blockers: this.blockers(card),
        };
      }),
    };
  }

  async createPack(input: PackInput, actor: SessionUser): Promise<AdminPack> {
    const pack = await this.prisma.pack.create({
      // Real people and fictional characters start restricted: off the landing page and SEO.
      data: { ...input, restricted: RESTRICTED_CATEGORIES.includes(input.category) },
    });
    await this.audit(actor, 'pack.create', 'pack', pack.id, input.titleFr);
    return this.packView(pack, []);
  }

  async updatePack(id: string, input: PackInput, actor: SessionUser): Promise<AdminPack> {
    await this.requirePack(id);
    const pack = await this.prisma.pack.update({
      where: { id },
      data: { ...input, restricted: RESTRICTED_CATEGORIES.includes(input.category) },
    });
    await this.audit(actor, 'pack.update', 'pack', id);
    return (await this.getPack(pack.id)).pack;
  }

  /**
   * The one-click switch. Every round re-checks the pack of its card before it starts
   * (`DeckService.load`), so DISABLED takes a pack out of running games too, without a deploy.
   */
  async setVisibility(
    id: string,
    visibility: 'PRIVATE' | 'PUBLIC' | 'DISABLED',
    actor: SessionUser,
  ): Promise<AdminPack> {
    await this.requirePack(id);
    await this.prisma.pack.update({ where: { id }, data: { visibility } });
    await this.audit(actor, 'pack.visibility', 'pack', id, visibility);
    return (await this.getPack(id)).pack;
  }

  /** Only an empty pack of the admin's own: seeded packs come back, and cards hold files. */
  async deletePack(id: string, actor: SessionUser): Promise<void> {
    const pack = await this.prisma.pack.findUnique({
      where: { id },
      include: { _count: { select: { cards: true } } },
    });
    if (!pack) throw new NotFoundException();
    if (pack.slug) throw new ConflictException({ code: 'SYSTEM_PACK' });
    if (pack._count.cards) throw new ConflictException({ code: 'PACK_NOT_EMPTY' });
    await this.prisma.pack.delete({ where: { id } });
    await this.audit(actor, 'pack.delete', 'pack', id, pack.titleFr);
  }

  // ---- cards ----

  async createCard(
    packId: string,
    input: { category: CardInput['category']; isPerson: boolean },
    actor: SessionUser,
  ): Promise<AdminCard> {
    await this.requirePack(packId);
    const card = await this.prisma.card.create({
      data: { packId, source: 'UPLOAD', status: 'DRAFT', ...input },
      include: cardInclude,
    });
    await this.audit(actor, 'card.create', 'card', card.id);
    return this.cardView(card);
  }

  async getCard(id: string): Promise<AdminCard> {
    return this.cardView(await this.requireCard(id));
  }

  async updateCard(id: string, input: CardInput, actor: SessionUser): Promise<AdminCard> {
    await this.requireCard(id);
    const answers = (['fr', 'en'] as const).map((locale) => ({ locale, ...input.answers[locale] }));

    await this.prisma.$transaction([
      this.prisma.cardAnswer.deleteMany({ where: { cardId: id } }),
      this.prisma.card.update({
        where: { id },
        data: {
          category: input.category,
          difficulty: input.difficulty,
          isPerson: input.isPerson,
          creditAuthor: input.credit.author || null,
          creditLicence: input.credit.licence || null,
          creditSourceUrl: input.credit.sourceUrl || null,
          answers: { create: answers.filter((answer) => answer.text) },
        },
      }),
    ]);

    // A live card that lost its credit or an answer leaves the game at once.
    const card = await this.requireCard(id);
    if (card.status === 'LIVE' && this.blockers(card).length) {
      await this.prisma.card.update({ where: { id }, data: { status: 'READY' } });
      card.status = 'READY';
    }
    await this.audit(actor, 'card.update', 'card', id);
    return this.cardView(card);
  }

  /**
   * First gate only (size, bytes that look like an image, rights confirmed). The file is parked
   * under a private key and the worker does the real work: decode, strip EXIF, resize, detect.
   */
  async acceptUpload(
    id: string,
    file: { buffer: Buffer; size: number } | undefined,
    rightsConfirmed: boolean,
    actor: SessionUser,
  ): Promise<AdminCard> {
    const card = await this.requireCard(id);
    if (card.status === 'PROCESSING') throw new ConflictException({ code: 'PROCESSING' });
    if (!file) throw new BadRequestException({ code: 'UNSUPPORTED_TYPE' });
    const problem = checkUpload({
      size: file.size,
      head: file.buffer.subarray(0, 16),
      rightsConfirmed,
    });
    if (problem) throw new BadRequestException({ code: problem });

    const incomingKey = storageKeys.incoming(randomUUID());
    await this.storage.put(incomingKey, file.buffer);
    await this.prisma.card.update({
      where: { id },
      data: { status: 'PROCESSING', processingError: null, rightsConfirmedAt: new Date() },
    });
    await this.queue.add(MediaJob.ingestImage, { cardId: id, incomingKey }, { attempts: 1 });
    await this.audit(actor, 'card.upload', 'card', id, `${file.size} bytes, rights confirmed`);
    return this.getCard(id);
  }

  /** The whole set at once. Crops are cut again; a card that was live comes back live. */
  async setZoomPoints(
    id: string,
    points: ZoomPointInput[],
    actor: SessionUser,
  ): Promise<AdminCard> {
    const card = await this.requireCard(id);
    if (!card.image) throw new ConflictException({ code: 'NO_IMAGE' });
    if (card.status === 'PROCESSING') throw new ConflictException({ code: 'PROCESSING' });
    const { width, height } = card.image;
    if (points.some((point) => point.x > width || point.y > height)) {
      throw new BadRequestException({ code: 'POINT_OUTSIDE_IMAGE' });
    }

    for (const point of card.zoomPoints) {
      for (const crop of point.crops) await this.storage.remove(crop.storageKey);
    }
    const wasLive = card.status === 'LIVE';
    const playable = points.length >= 2;
    await this.prisma.$transaction([
      this.prisma.zoomPoint.deleteMany({ where: { cardId: id } }),
      this.prisma.card.update({
        where: { id },
        data: {
          status: playable ? 'PROCESSING' : 'NEEDS_POINTS',
          zoomPoints: {
            create: points.map(({ labelFr, labelEn, ...point }) => ({
              ...point,
              labelFr: labelFr || null,
              labelEn: labelEn || null,
            })),
          },
        },
      }),
    ]);
    if (playable) {
      await this.queue.add(MediaJob.processCard, { cardId: id, publish: wasLive }, JOB_OPTIONS);
    }
    await this.audit(actor, 'card.points', 'card', id, `${points.length} point(s)`);
    return this.getCard(id);
  }

  async setLive(id: string, live: boolean, actor: SessionUser): Promise<AdminCard> {
    const card = await this.requireCard(id);
    const blockers = this.blockers(card);
    if (live && blockers.length) throw new ConflictException({ code: 'NOT_PUBLISHABLE', blockers });
    if (!live && card.status !== 'LIVE') return this.cardView(card);

    await this.prisma.card.update({ where: { id }, data: { status: live ? 'LIVE' : 'READY' } });
    await this.audit(actor, live ? 'card.publish' : 'card.unpublish', 'card', id);
    return this.getCard(id);
  }

  async deleteCard(id: string, actor: SessionUser): Promise<void> {
    const card = await this.requireCard(id);
    // The seed puts its cards back at the next start: disable their pack instead.
    if (card.source === 'SEED') throw new ConflictException({ code: 'SEED_CARD' });
    if (card.status === 'PROCESSING') throw new ConflictException({ code: 'PROCESSING' });

    for (const point of card.zoomPoints) {
      for (const crop of point.crops) await this.storage.remove(crop.storageKey);
    }
    if (card.image) {
      await this.storage.remove(card.image.originalKey);
      if (card.image.revealKey) await this.storage.remove(card.image.revealKey);
    }
    await this.prisma.$transaction([
      this.prisma.card.delete({ where: { id } }),
      ...(card.image ? [this.prisma.imageAsset.delete({ where: { id: card.image.id } })] : []),
    ]);
    await this.audit(actor, 'card.delete', 'card', id);
  }

  // ---- views ----

  private imageUrl = (imageId: string) =>
    `/api/media/${this.tokens.seal('image', imageId, Date.now())}`;

  private blockers(card: CardRow): PublishBlocker[] {
    const answer = (locale: string) => card.answers.find((a) => a.locale === locale)?.text;
    return publishBlockers({
      hasImage: Boolean(card.image?.revealKey),
      processing: card.status === 'PROCESSING',
      rightsConfirmed: card.source !== 'UPLOAD' || card.rightsConfirmedAt !== null,
      credit: { author: card.creditAuthor, licence: card.creditLicence },
      answers: { fr: answer('fr'), en: answer('en') },
      points: card.zoomPoints.map((point) => ({
        cropsReady: new Set(point.crops.map((crop) => crop.level)).size >= LEVELS,
      })),
    });
  }

  private cardView(card: CardRow): AdminCard {
    const answer = (locale: string) => {
      const row = card.answers.find((a) => a.locale === locale);
      return { text: row?.text ?? '', aliases: row?.aliases ?? [] };
    };
    return {
      id: card.id,
      packId: card.packId,
      status: card.status,
      source: card.source,
      category: card.category,
      difficulty: card.difficulty,
      isPerson: card.isPerson,
      answers: { fr: answer('fr'), en: answer('en') },
      credit: {
        author: card.creditAuthor ?? '',
        licence: card.creditLicence ?? '',
        sourceUrl: card.creditSourceUrl ?? '',
      },
      rightsConfirmed: card.rightsConfirmedAt !== null,
      image: card.image?.revealKey
        ? {
            width: card.image.width,
            height: card.image.height,
            url: this.imageUrl(card.image.id),
          }
        : null,
      zoomPoints: card.zoomPoints.map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        baseRadius: point.baseRadius,
        labelFr: point.labelFr ?? '',
        labelEn: point.labelEn ?? '',
        weight: point.weight,
        origin: point.origin,
        cropsReady: new Set(point.crops.map((crop) => crop.level)).size >= LEVELS,
      })),
      detection: (card.detection as FaceDetection | null) ?? null,
      processingError: card.processingError,
      blockers: this.blockers(card),
      updatedAt: card.updatedAt.toISOString(),
    };
  }

  private packView(
    pack: Prisma.PackGetPayload<object>,
    counts: { packId: string; status: CardStatus; _count: number }[],
  ): AdminPack {
    return {
      id: pack.id,
      slug: pack.slug,
      titleFr: pack.titleFr,
      titleEn: pack.titleEn,
      descriptionFr: pack.descriptionFr,
      descriptionEn: pack.descriptionEn,
      category: pack.category,
      publicMatchSafe: pack.publicMatchSafe,
      visibility: pack.visibility,
      restricted: pack.restricted,
      cards: Object.fromEntries(
        counts.filter((row) => row.packId === pack.id).map((row) => [row.status, row._count]),
      ),
      updatedAt: pack.updatedAt.toISOString(),
    };
  }

  private async requirePack(id: string): Promise<void> {
    const found = await this.prisma.pack.count({ where: { id } });
    if (!found) throw new NotFoundException();
  }

  private async requireCard(id: string): Promise<CardRow> {
    const card = await this.prisma.card.findUnique({ where: { id }, include: cardInclude });
    if (!card) throw new NotFoundException();
    return card;
  }

  private audit(
    actor: SessionUser,
    action: string,
    targetType: 'pack' | 'card',
    targetId: string,
    note?: string,
  ) {
    return this.prisma.auditLog.create({
      data: { actorId: actor.id, action, targetType, targetId, note },
    });
  }
}
