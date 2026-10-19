import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { STORAGE, type StorageDriver, storageKeys } from '../../media/storage.js';
import { MediaJob, MEDIA_QUEUE } from '../../pipeline/media-queue.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import { answerTaken } from '../answer-taken.js';
import { judgeFile, PREVIEW_WIDTH } from '../candidates.js';
import { slugOf } from '../card-factory.js';
import { WIKIMEDIA, type WikimediaApi } from '../wikimedia.client.js';
import {
  aliasesOf,
  answerOf,
  englishAnswerOf,
  expectedSlugs,
  wikidataOf,
  DATASET_PACKS,
  type DatasetCategory,
  type DatasetPackKey,
  frwikiTitleOf,
  isRealPerson,
  MIN_FACE_PX,
  parseManifest,
  photosOf,
  targetsOf,
} from './manifest.js';

export interface DatasetOptions {
  dir: string;
  ownerEmail?: string;
  only?: DatasetCategory;
  limit?: number;
  dryRun?: boolean;
  /** Prefix of the pack and card slugs: `ds` for real, another one for tests. */
  slugPrefix?: string;
  /** How long to wait for the worker with nothing moving before giving up (default 10 min). */
  waitLimitMs?: number;
  /** Told once each time the command starts waiting for the worker. */
  onWait?: () => void;
  /** Cards per pack before "— 2" opens (default 500, like the mass import). */
  packSize?: number;
  /** Remake a card whose picture file changed in the dataset since it was imported. */
  replaceChanged?: boolean;
  /**
   * Take away the cards whose entry or photo is no longer in the manifest (excluded, dropped
   * photos). Only on a full run: a partial one does not know what the manifest still has.
   */
  dropMissing?: boolean;
}
export type DatasetOutcome =
  'created' | 'exists' | 'remade' | 'replaced' | 'dropped' | `refused:${string}`;
export interface DatasetLine {
  index: number;
  total: number;
  name: string;
  pack: string;
  /** '-p2', '-p3' for a person's other photos. */
  photo?: string;
  outcome: DatasetOutcome;
  detail?: string;
}
/** Per pack slug, how many lines ended in each outcome (or, for `status`, cards per status). */
export type DatasetSummary = Record<string, Record<string, number>>;

/** Cards per pack, like the mass import's catalogue packs. */
const PACK_SIZE = 500;
/** At most this many of the command's pictures in flight, so that a game is never starved. */
const PENDING = 5;
const WAIT_MS = 2_000;
const WAIT_LIMIT_MS = 10 * 60_000;
/** A card in flight this long with no job left is given up and made again. */
const ORPHAN_AFTER_MS = 30 * 60_000;
/** A failure a new try fixes; the others (too small, unreadable…) would only fail again. */
const RETRYABLE = new Set([null, 'FAILED']);
const jobIdOf = (cardId: string) => `ds-${cardId}`;

/**
 * The owner's dataset into the game. Real people: their Commons credit, checked like the
 * importer's, and their Wikidata identity, so that nothing comes twice. Characters: private
 * packs of the owner's player, locked (`publishable: false`). Pictures are read from disk and
 * handed to the upload pipeline (`image.ingest` with automatic points and publication).
 */
@Injectable()
export class DatasetImporter {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue,
  ) {}

  /** A card and its files: the picture, its reveal and every crop. */
  private async dropCard(id: string): Promise<void> {
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id },
      include: { image: true, zoomPoints: { include: { crops: true } } },
    });
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
  }

  async run(options: DatasetOptions, report: (line: DatasetLine) => void): Promise<DatasetSummary> {
    const prefix = options.slugPrefix ?? 'ds';
    let entries = parseManifest(
      JSON.parse(await readFile(join(options.dir, 'manifest.json'), 'utf8')),
    );
    if (options.only) entries = entries.filter((entry) => entry.category === options.only);
    if (options.limit) entries = entries.slice(0, options.limit);

    // One card per photo of a person, and per pack a character goes to.
    const work = entries.flatMap((entry) =>
      targetsOf(entry).flatMap((target) =>
        photosOf(entry).map((photo) => ({ entry, target, photo })),
      ),
    );
    const packSize = options.packSize ?? PACK_SIZE;
    const needsOwner = work.some(({ target }) => DATASET_PACKS[target.pack].private);
    const ownerId = needsOwner ? await this.ownerOf(options.ownerEmail) : null;

    // Commons and Wikidata, in batches, before the loop.
    const people = entries.filter(isRealPerson);
    const fileNames = [
      ...new Set(
        people
          .flatMap((entry) => photosOf(entry).map((photo) => photo.commonsFile))
          .filter((name): name is string => !!name),
      ),
    ];
    const files = fileNames.length
      ? await this.wikimedia.files(fileNames, PREVIEW_WIDTH)
      : new Map();
    const titles = [...new Set(people.map(frwikiTitleOf))];
    const items = titles.length ? await this.wikimedia.itemsForTitles(titles, 'frwiki') : new Map();

    const packs = new Map<DatasetPackKey, { id: string; slug: string; count: number }>();
    const summary: DatasetSummary = {};
    for (const [index, { entry, target, photo }] of work.entries()) {
      const packSlug = `${prefix}-${target.pack}`;
      const line = (outcome: DatasetOutcome, detail?: string) => {
        report({
          index: index + 1,
          total: work.length,
          name: entry.name,
          pack: packSlug,
          ...(photo.suffix ? { photo: photo.suffix } : {}),
          outcome,
          detail,
        });
        const counts = (summary[packSlug] ??= {});
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      };

      const imagePath = join(options.dir, photo.path);
      const image = await readImage(imagePath);
      if (!image) {
        line('refused:NO_FILE');
        continue;
      }
      const answer = answerOf(entry);
      if (!answer) {
        line('refused:NO_ANSWER');
        continue;
      }

      const person = isRealPerson(entry);
      if (person && photo.facePx !== undefined && photo.facePx < MIN_FACE_PX) {
        line('refused:SMALL_FACE');
        continue;
      }
      let credit: { author: string; licence: string; sourceUrl: string };
      let slug: string;
      if (person) {
        const name = photo.commonsFile;
        const file = name ? files.get(name) : undefined;
        if (!file) {
          line('refused:NO_COMMONS_FILE');
          continue;
        }
        // The picture sent is the dataset's own: its size and format are checked by the upload
        // pipeline on that file; Commons is asked for the licence and the author only.
        const judged = judgeFile(
          {
            ...file,
            width: Number.MAX_SAFE_INTEGER,
            height: Number.MAX_SAFE_INTEGER,
            mime: 'image/jpeg',
          },
          { people: true },
        );
        if ('rejection' in judged) {
          line(`refused:${judged.rejection}`);
          continue;
        }
        credit = judged.credit;
        const qid = wikidataOf(entry) ?? items.get(frwikiTitleOf(entry));
        slug = (qid ? slugOf(qid) : `${prefix}-${entry.id}`) + photo.suffix;
      } else {
        credit = {
          author: entry.source === 'fandom' ? `Fandom — ${entry.wiki ?? '?'}` : 'Wikipédia',
          licence: 'Usage privé',
          sourceUrl: entry.page_url,
        };
        slug = `${prefix}-${entry.id}${target.slugSuffix}`;
      }

      // The card may already be in any pack of the family ("— 2"…): that is where it is.
      const family = { OR: [{ slug: packSlug }, { slug: { startsWith: `${packSlug}-` } }] };
      const placed = await this.prisma.card.findFirst({
        where: { slug, pack: family },
        select: { packId: true },
      });
      const packId =
        placed?.packId ??
        (options.dryRun
          ? (packs.get(target.pack)?.id ?? (await this.findPack(packSlug)))
          : await this.packWithRoom(target.pack, packSlug, ownerId, packs, packSize));
      if (packId && DATASET_PACKS[target.pack].private && (await this.unlocked(packId))) {
        // The owner vouched for the images that were in it then, not for new ones.
        line('refused:PACK_UNLOCKED');
        continue;
      }
      let remade = false;
      const here = packId
        ? await this.prisma.card.findFirst({
            where: { packId, slug },
            select: {
              id: true,
              status: true,
              processingError: true,
              updatedAt: true,
              sourceHash: true,
            },
          })
        : null;
      const sourceHash = createHash('sha256').update(image).digest('hex');
      let replaced = false;
      if (here) {
        const orphan = here.status === 'PROCESSING' && (await this.isOrphan(here));
        const changed =
          options.replaceChanged && here.sourceHash !== null && here.sourceHash !== sourceHash;
        if (changed && here.status !== 'PROCESSING') {
          // A new photo: the card goes and is made again, its old points and review with it.
          if (!options.dryRun) await this.dropCard(here.id);
          replaced = true;
        } else if (here.status !== 'DRAFT' && !orphan) {
          line('exists');
          continue;
        }
        if (here.status === 'DRAFT' && !RETRYABLE.has(here.processingError)) {
          line(`refused:${here.processingError}`);
          continue;
        }
        if (!replaced) {
          // Its picture failed, or its job vanished: it goes, and is made again.
          if (!options.dryRun) await this.prisma.card.delete({ where: { id: here.id } });
          remade = true;
        }
      } else if (person && photo.suffix) {
        // Another photo of a person: it follows the main one, which decided whether they come.
        const main = await this.prisma.card.findFirst({
          where: { slug: slug.slice(0, -photo.suffix.length) },
          select: { id: true },
        });
        if (!main) {
          line('refused:NO_MAIN_PHOTO');
          continue;
        }
      } else if (person) {
        const elsewhere = await this.prisma.card.findFirst({
          where: { slug },
          select: { id: true },
        });
        if (elsewhere || (await answerTaken(this.prisma, answer))) {
          line('exists');
          continue;
        }
      }

      const outcome = replaced ? 'replaced' : remade ? 'remade' : 'created';
      if (options.dryRun) {
        line(outcome, credit.licence);
        continue;
      }
      await this.waitForRoom(prefix, options);
      const card = await this.prisma.card.create({
        data: {
          packId: packId!,
          slug,
          sourceHash,
          source: person ? 'WIKIMEDIA' : 'UPLOAD',
          status: 'PROCESSING',
          category: DATASET_PACKS[target.pack].category,
          difficulty: target.difficulty,
          isPerson: person,
          creditAuthor: credit.author,
          creditLicence: credit.licence,
          creditSourceUrl: credit.sourceUrl,
          rightsConfirmedAt: person ? null : new Date(),
          answers: {
            create: [
              { locale: 'fr', text: answer, aliases: aliasesOf(entry) },
              {
                locale: 'en',
                text: englishAnswerOf(entry) ?? answer,
                aliases: englishAnswerOf(entry) ? [answer, ...aliasesOf(entry)] : aliasesOf(entry),
              },
            ],
          },
        },
        select: { id: true },
      });
      try {
        const incomingKey = storageKeys.incoming(randomUUID());
        await this.storage.put(incomingKey, image);
        await this.queue.add(
          MediaJob.ingestImage,
          { cardId: card.id, incomingKey, autoPoints: true, publish: true },
          { attempts: 1, jobId: jobIdOf(card.id) },
        );
      } catch (error) {
        // No card without its picture on the way: a rerun makes it again.
        await this.prisma.card.delete({ where: { id: card.id } });
        throw error;
      }
      const room = packs.get(target.pack);
      if (room && room.id === packId) room.count += 1;
      line(outcome, credit.licence);
    }
    if (options.dropMissing && !options.only && !options.limit) {
      const qids = new Map(
        people.flatMap((entry) => {
          const qid = wikidataOf(entry) ?? items.get(frwikiTitleOf(entry));
          return qid ? [[entry.id, qid] as const] : [];
        }),
      );
      const wanted = expectedSlugs(entries, prefix, qids);
      const packSlugs = Object.keys(DATASET_PACKS).map((key) => `${prefix}-${key}`);
      const cards = await this.prisma.card.findMany({
        where: {
          status: { not: 'PROCESSING' },
          pack: {
            OR: packSlugs.flatMap((slug) => [{ slug }, { slug: { startsWith: `${slug}-` } }]),
          },
        },
        select: { id: true, slug: true, pack: { select: { slug: true } } },
      });
      for (const card of cards) {
        if (!card.slug || wanted.has(card.slug)) continue;
        if (!options.dryRun) await this.dropCard(card.id);
        report({
          index: work.length,
          total: work.length,
          name: card.slug,
          pack: card.pack.slug ?? '',
          outcome: 'dropped',
        });
        const counts = (summary[card.pack.slug ?? '?'] ??= {});
        counts.dropped = (counts.dropped ?? 0) + 1;
      }
    }
    return summary;
  }

  /** Per dataset pack, cards per status, and waiting cards per reason. */
  async status(prefix = 'ds'): Promise<DatasetSummary> {
    const rows = await this.prisma.card.groupBy({
      by: ['packId', 'status', 'processingError'],
      where: { pack: { slug: { startsWith: `${prefix}-` } } },
      _count: true,
    });
    const packs = await this.prisma.pack.findMany({
      where: { slug: { startsWith: `${prefix}-` } },
      select: { id: true, slug: true },
    });
    const slugOfPack = new Map(packs.map((pack) => [pack.id, pack.slug!]));
    const summary: DatasetSummary = {};
    for (const row of rows) {
      const counts = (summary[slugOfPack.get(row.packId)!] ??= {});
      counts[row.status] = (counts[row.status] ?? 0) + row._count;
      if (row.processingError) {
        counts[row.processingError] = (counts[row.processingError] ?? 0) + row._count;
      }
    }
    return summary;
  }

  private async ownerOf(email: string | undefined): Promise<string> {
    const player = email
      ? await this.prisma.player.findFirst({ where: { user: { email: email.toLowerCase() } } })
      : null;
    if (!player) {
      throw new Error(
        'OWNER_EMAIL must name an account that has played once while logged in (it needs a player): the private packs are its own.',
      );
    }
    return player.id;
  }

  private async findPack(slug: string): Promise<string | null> {
    return (
      (await this.prisma.pack.findFirst({ where: { slug }, select: { id: true } }))?.id ?? null
    );
  }

  /**
   * The pack of the family with room left: "ds-sportif", then "ds-sportif-2"… Each is made with
   * its flags the first time; an existing pack is left as it is.
   */
  private async packWithRoom(
    key: DatasetPackKey,
    family: string,
    ownerId: string | null,
    cache: Map<DatasetPackKey, { id: string; slug: string; count: number }>,
    packSize: number,
  ): Promise<string> {
    const cached = cache.get(key);
    if (cached && cached.count < packSize) return cached.id;
    for (let n = 1; ; n++) {
      const slug = n === 1 ? family : `${family}-${n}`;
      const found = await this.prisma.pack.findFirst({
        where: { slug },
        select: { id: true, _count: { select: { cards: true } } },
      });
      if (found && found._count.cards >= packSize) continue;
      const spec = DATASET_PACKS[key];
      const id =
        found?.id ??
        (
          await this.prisma.pack.create({
            data: {
              slug,
              titleFr: n === 1 ? spec.titleFr : `${spec.titleFr} — ${n}`,
              titleEn: n === 1 ? spec.titleEn : `${spec.titleEn} — ${n}`,
              category: spec.category,
              restricted: true,
              publicMatchSafe: false,
              ...(spec.private
                ? { visibility: 'PRIVATE', ownerId, publishable: false }
                : { visibility: 'PUBLIC' }),
            },
            select: { id: true },
          })
        ).id;
      cache.set(key, { id, slug, count: found?._count.cards ?? 0 });
      return id;
    }
  }

  /** Whether a private pack of the dataset was unlocked or made visible since. */
  private async unlocked(packId: string): Promise<boolean> {
    const pack = await this.prisma.pack.findUnique({
      where: { id: packId },
      select: { publishable: true, visibility: true },
    });
    return Boolean(pack && (pack.publishable || pack.visibility !== 'PRIVATE'));
  }

  /** A card in flight for long whose job is gone (a crash between the card and its job). */
  private async isOrphan(card: { id: string; updatedAt: Date }): Promise<boolean> {
    if (Date.now() - card.updatedAt.getTime() < ORPHAN_AFTER_MS) return false;
    const job = await this.queue.getJob(jobIdOf(card.id));
    const state = job ? await job.getState() : 'missing';
    return state === 'missing' || state === 'failed' || state === 'unknown';
  }

  /**
   * At most PENDING pictures in flight. The wait is said once; a worker that does not move for
   * the limit is a worker that is not running, and the command says so instead of hanging.
   */
  private async waitForRoom(prefix: string, options: DatasetOptions): Promise<void> {
    const limit = options.waitLimitMs ?? WAIT_LIMIT_MS;
    let told = false;
    let last = -1;
    let since = Date.now();
    for (;;) {
      const pending = await this.prisma.card.count({
        where: { status: 'PROCESSING', pack: { slug: { startsWith: `${prefix}-` } } },
      });
      if (pending < PENDING) return;
      if (!told) {
        options.onWait?.();
        told = true;
      }
      if (pending !== last) {
        last = pending;
        since = Date.now();
      } else if (Date.now() - since > limit) {
        throw new Error(
          `${pending} photos waiting for the worker for ${Math.round(limit / 1000)} s with nothing moving: is the worker running?`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(WAIT_MS, limit / 3)));
    }
  }
}

/** The picture's bytes, or null when the path is missing, a folder, or unreadable. */
async function readImage(path: string): Promise<Buffer | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}
