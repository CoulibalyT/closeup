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
  type AdminAvailablePerson,
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
import { givesAnswer } from '../content/hint-guard.js';
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
    const [packs, counts, latest] = await Promise.all([
      this.prisma.pack.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.card.groupBy({ by: ['packId', 'status'], _count: true }),
      this.latestCards(),
    ]);
    return packs.map((pack) => this.packView(pack, counts, latest));
  }

  async getPack(id: string): Promise<{ pack: AdminPack; cards: AdminCardSummary[] }> {
    const pack = await this.prisma.pack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException();
    const [counts, latest, cards] = await Promise.all([
      this.prisma.card.groupBy({ by: ['packId', 'status'], where: { packId: id }, _count: true }),
      this.latestCards(id),
      this.prisma.card.findMany({
        where: { packId: id },
        include: cardInclude,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      pack: this.packView(pack, counts, latest),
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
          createdAt: card.createdAt.toISOString(),
          updatedAt: card.updatedAt.toISOString(),
        };
      }),
    };
  }

  async availablePeople(packId: string): Promise<AdminAvailablePerson[]> {
    const pack = await this.prisma.pack.findUnique({ where: { id: packId } });
    if (!pack) throw new NotFoundException();
    const target = await this.prisma.card.findMany({
      where: { packId, isPerson: true, category: pack.category },
      include: { answers: true, image: { select: { sha256: true } } },
    });
    const imageHashes = new Set(target.map((card) => card.image?.sha256).filter(Boolean));
    const people = await this.prisma.card.findMany({
      where: {
        isPerson: true,
        category: pack.category,
        packId: { not: packId },
        pack: { audience: pack.audience },
      },
      include: { ...cardInclude, pack: { select: { titleFr: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return people
      .map((card) => {
        const answerFr = card.answers.find((answer) => answer.locale === 'fr')?.text ?? '';
        const answerEn = card.answers.find((answer) => answer.locale === 'en')?.text ?? '';
        return {
          person: {
            id: card.id,
            packId: card.packId,
            packTitle: card.pack.titleFr,
            answerFr,
            answerEn,
            thumbnailUrl: card.image?.revealKey ? this.imageUrl(card.image.id) : null,
          },
          imageHash: card.image?.sha256 ?? null,
        };
      })
      .filter(({ person }) => person.answerFr || person.answerEn)
      .filter(({ imageHash }) => !imageHash || !imageHashes.has(imageHash))
      .map(({ person }) => person);
  }

  async createPack(input: PackInput, actor: SessionUser): Promise<AdminPack> {
    const pack = await this.prisma.pack.create({ data: { ...input, ...this.packFlags(input) } });
    await this.audit(actor, 'pack.create', 'pack', pack.id, input.titleFr);
    return this.packView(pack, []);
  }

  /**
   * Real people and fictional characters are restricted (off the landing page, the catalogue,
   * the default games), and never safe for strangers.
   */
  private packFlags(input: PackInput): { restricted: boolean } {
    const restricted = RESTRICTED_CATEGORIES.includes(input.category);
    if (restricted && input.publicMatchSafe) {
      throw new ConflictException({ code: 'RESTRICTED_PUBLIC_MATCH' });
    }
    return { restricted };
  }

  async updatePack(id: string, input: PackInput, actor: SessionUser): Promise<AdminPack> {
    await this.requirePack(id);
    const flags = this.packFlags(input);
    const stored = await this.prisma.pack.findUniqueOrThrow({ where: { id } });
    if (!stored.publishable && (input.publicMatchSafe || !flags.restricted)) {
      throw new ConflictException({ code: 'NOT_PUBLISHABLE' });
    }
    const pack = await this.prisma.pack.update({ where: { id }, data: { ...input, ...flags } });
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
    const stored = await this.prisma.pack.findUniqueOrThrow({ where: { id } });
    if (visibility === 'PUBLIC' && !stored.publishable) {
      throw new ConflictException({ code: 'NOT_PUBLISHABLE' });
    }
    await this.prisma.pack.update({ where: { id }, data: { visibility } });
    await this.audit(actor, 'pack.visibility', 'pack', id, visibility);
    return (await this.getPack(id)).pack;
  }

  /** The lock comes off only with the admin vouching for the rights; the log keeps it. */
  async unlockPack(id: string, actor: SessionUser): Promise<AdminPack> {
    await this.requirePack(id);
    await this.prisma.pack.update({ where: { id }, data: { publishable: true } });
    await this.audit(
      actor,
      'pack.unlock',
      'pack',
      id,
      'rights confirmed by the admin for every image of this pack',
    );
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

  async copyCard(id: string, targetPackId: string, actor: SessionUser): Promise<AdminCard> {
    const source = await this.requireCard(id);
    if (source.packId === targetPackId) throw new ConflictException({ code: 'SAME_PACK' });
    await this.requirePack(targetPackId);
    if (source.status === 'PROCESSING') throw new ConflictException({ code: 'PROCESSING' });

    if (source.image) {
      const duplicate = await this.prisma.card.findFirst({
        where: { packId: targetPackId, image: { is: { sha256: source.image.sha256 } } },
      });
      if (duplicate) throw new ConflictException({ code: 'IMAGE_ALREADY_IN_PACK' });
    }

    const copiedFiles: string[] = [];
    const imageId = source.image ? randomUUID() : null;
    const image = source.image
      ? {
          id: imageId!,
          originalKey: storageKeys.original(
            imageId!,
            source.image.originalKey.split('.').pop() ?? 'bin',
          ),
          revealKey: source.image.revealKey ? storageKeys.reveal(imageId!) : null,
        }
      : null;
    const copiedPoints = source.zoomPoints.map((point) => {
      const pointId = randomUUID();
      return {
        point,
        id: pointId,
        crops: point.crops.map((crop) => ({
          crop,
          storageKey: storageKeys.crop(pointId, crop.level, crop.sizePx, crop.variant),
        })),
      };
    });

    try {
      if (source.image && image) {
        await this.storage.put(
          image.originalKey,
          await this.storage.read(source.image.originalKey),
        );
        copiedFiles.push(image.originalKey);
        if (source.image.revealKey && image.revealKey) {
          await this.storage.put(image.revealKey, await this.storage.read(source.image.revealKey));
          copiedFiles.push(image.revealKey);
        }
      }
      for (const point of copiedPoints) {
        for (const crop of point.crops) {
          await this.storage.put(crop.storageKey, await this.storage.read(crop.crop.storageKey));
          copiedFiles.push(crop.storageKey);
        }
      }

      const copied = await this.prisma.$transaction(async (tx) => {
        if (image) {
          await tx.imageAsset.create({
            data: {
              id: image.id,
              originalKey: image.originalKey,
              revealKey: image.revealKey,
              width: source.image!.width,
              height: source.image!.height,
              mime: source.image!.mime,
              bytes: source.image!.bytes,
              sha256: source.image!.sha256,
            },
          });
        }
        return tx.card.create({
          data: {
            packId: targetPackId,
            category: source.category,
            difficulty: source.difficulty,
            status: source.status,
            isPerson: source.isPerson,
            gender: source.gender,
            source: source.source,
            sourceHash: source.sourceHash,
            creditAuthor: source.creditAuthor,
            creditLicence: source.creditLicence,
            creditSourceUrl: source.creditSourceUrl,
            rightsConfirmedAt: source.rightsConfirmedAt,
            processingError: source.processingError,
            detection: source.detection ?? undefined,
            imageId: image?.id,
            answers: {
              create: source.answers.map(({ locale, text, aliases, hint, secondary }) => ({
                locale,
                text,
                aliases,
                hint,
                secondary,
              })),
            },
            zoomPoints: {
              create: copiedPoints.map(({ point, id: pointId, crops }) => ({
                id: pointId,
                x: point.x,
                y: point.y,
                baseRadius: point.baseRadius,
                labelFr: point.labelFr,
                labelEn: point.labelEn,
                weight: point.weight,
                origin: point.origin,
                crops: {
                  create: crops.map(({ crop, storageKey }) => ({
                    level: crop.level,
                    sizePx: crop.sizePx,
                    storageKey,
                    focusX: crop.focusX,
                    focusY: crop.focusY,
                    scaleFromPrev: crop.scaleFromPrev,
                    bytes: crop.bytes,
                    variant: crop.variant,
                  })),
                },
              })),
            },
          },
          include: cardInclude,
        });
      });
      await this.audit(
        actor,
        'card.copy',
        'card',
        copied.id,
        `copied from ${id} to pack ${targetPackId}`,
      );
      return this.cardView(copied);
    } catch (error) {
      await Promise.all(copiedFiles.map((key) => this.storage.remove(key)));
      throw error;
    }
  }

  async updateCard(id: string, input: CardInput, actor: SessionUser): Promise<AdminCard> {
    await this.requireCard(id);
    for (const locale of ['fr', 'en'] as const) {
      const { hint } = input.answers[locale];
      // Checked against both languages: an English hint must not name the French answer either.
      if (hint && (['fr', 'en'] as const).some((l) => givesAnswer(hint, input.answers[l]))) {
        throw new BadRequestException({ code: 'HINT_GIVES_ANSWER' });
      }
    }
    const answers = (['fr', 'en'] as const).map((locale) => {
      const { hint, ...rest } = input.answers[locale];
      return { locale, ...rest, hint: hint || null };
    });

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
    options: { autoPoints?: boolean; publish?: boolean } = {},
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
    await this.queue.add(
      MediaJob.ingestImage,
      { cardId: id, incomingKey, ...options },
      { attempts: 1 },
    );
    await this.audit(actor, 'card.upload', 'card', id, `${file.size} bytes, rights confirmed`);
    return this.getCard(id);
  }

  /** The whole set at once. Copies of the same image receive the same points and crops. */
  async setZoomPoints(
    id: string,
    points: ZoomPointInput[],
    actor: SessionUser,
  ): Promise<AdminCard> {
    const card = await this.requireCard(id);
    if (!card.image) throw new ConflictException({ code: 'NO_IMAGE' });
    if (card.status === 'PROCESSING') throw new ConflictException({ code: 'PROCESSING' });
    const relatedCards = await this.prisma.card.findMany({
      where: { image: { is: { sha256: card.image.sha256 } } },
      include: cardInclude,
    });
    if (relatedCards.some((related) => related.status === 'PROCESSING')) {
      throw new ConflictException({ code: 'PROCESSING' });
    }
    const { width, height } = card.image;
    if (points.some((point) => point.x > width || point.y > height)) {
      throw new BadRequestException({ code: 'POINT_OUTSIDE_IMAGE' });
    }

    for (const related of relatedCards) {
      for (const point of related.zoomPoints) {
        for (const crop of point.crops) await this.storage.remove(crop.storageKey);
      }
    }
    const playable = points.length >= 2;
    await this.prisma.$transaction(async (tx) => {
      for (const related of relatedCards) {
        await tx.zoomPoint.deleteMany({ where: { cardId: related.id } });
        await tx.card.update({
          where: { id: related.id },
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
        });
      }
    });
    if (playable) {
      await Promise.all(
        relatedCards.map((related) =>
          this.queue.add(
            MediaJob.processCard,
            { cardId: related.id, publish: related.status === 'LIVE' },
            JOB_OPTIONS,
          ),
        ),
      );
    }
    await this.audit(
      actor,
      'card.points',
      'card',
      id,
      `${points.length} point(s), synchronized to ${relatedCards.length} card(s)`,
    );
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
      return {
        text: row?.text ?? '',
        aliases: row?.aliases ?? [],
        hint: row?.hint ?? '',
        secondary: row?.secondary ?? [],
      };
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

  /** Per pack, when its newest card arrived and when a card last changed. */
  private latestCards(packId?: string) {
    return this.prisma.card.groupBy({
      by: ['packId'],
      ...(packId ? { where: { packId } } : {}),
      _max: { createdAt: true, updatedAt: true },
    });
  }

  private packView(
    pack: Prisma.PackGetPayload<object>,
    counts: { packId: string; status: CardStatus; _count: number }[],
    latest: { packId: string; _max: { createdAt: Date | null; updatedAt: Date | null } }[] = [],
  ): AdminPack {
    const last = latest.find((row) => row.packId === pack.id)?._max;
    return {
      id: pack.id,
      slug: pack.slug,
      titleFr: pack.titleFr,
      titleEn: pack.titleEn,
      descriptionFr: pack.descriptionFr,
      descriptionEn: pack.descriptionEn,
      category: pack.category,
      audience: pack.audience,
      publicMatchSafe: pack.publicMatchSafe,
      visibility: pack.visibility,
      restricted: pack.restricted,
      publishable: pack.publishable,
      byPlayer: pack.ownerId !== null,
      cards: Object.fromEntries(
        counts.filter((row) => row.packId === pack.id).map((row) => [row.status, row._count]),
      ),
      createdAt: pack.createdAt.toISOString(),
      updatedAt: pack.updatedAt.toISOString(),
      lastCardAddedAt: last?.createdAt?.toISOString() ?? null,
      lastCardChangedAt: last?.updatedAt?.toISOString() ?? null,
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
