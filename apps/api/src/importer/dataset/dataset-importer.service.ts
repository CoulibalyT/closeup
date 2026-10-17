import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
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
  answerOf,
  commonsFileOf,
  DATASET_PACKS,
  type DatasetCategory,
  type DatasetPackKey,
  frwikiTitleOf,
  isRealPerson,
  parseManifest,
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
}
export type DatasetOutcome = 'created' | 'exists' | 'remade' | `refused:${string}`;
export interface DatasetLine {
  index: number;
  total: number;
  name: string;
  pack: string;
  outcome: DatasetOutcome;
  detail?: string;
}
/** Per pack slug, how many lines ended in each outcome (or, for `status`, cards per status). */
export type DatasetSummary = Record<string, Record<string, number>>;

/** At most this many of the command's pictures in flight, so that a game is never starved. */
const PENDING = 5;
const WAIT_MS = 2_000;

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

  async run(options: DatasetOptions, report: (line: DatasetLine) => void): Promise<DatasetSummary> {
    const prefix = options.slugPrefix ?? 'ds';
    let entries = parseManifest(
      JSON.parse(await readFile(join(options.dir, 'manifest.json'), 'utf8')),
    );
    if (options.only) entries = entries.filter((entry) => entry.category === options.only);
    if (options.limit) entries = entries.slice(0, options.limit);

    const work = entries.flatMap((entry) => targetsOf(entry).map((target) => ({ entry, target })));
    const needsOwner = work.some(({ target }) => DATASET_PACKS[target.pack].private);
    const ownerId = needsOwner ? await this.ownerOf(options.ownerEmail) : null;

    // Commons and Wikidata, in batches, before the loop.
    const people = entries.filter(isRealPerson);
    const fileNames = [
      ...new Set(people.map(commonsFileOf).filter((name): name is string => !!name)),
    ];
    const files = fileNames.length
      ? await this.wikimedia.files(fileNames, PREVIEW_WIDTH)
      : new Map();
    const titles = [...new Set(people.map(frwikiTitleOf))];
    const items = titles.length ? await this.wikimedia.itemsForTitles(titles, 'frwiki') : new Map();

    const packIds = new Map<DatasetPackKey, string>();
    const summary: DatasetSummary = {};
    for (const [index, { entry, target }] of work.entries()) {
      const packSlug = `${prefix}-${target.pack}`;
      const line = (outcome: DatasetOutcome, detail?: string) => {
        report({
          index: index + 1,
          total: work.length,
          name: entry.name,
          pack: packSlug,
          outcome,
          detail,
        });
        const counts = (summary[packSlug] ??= {});
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      };

      const imagePath = join(options.dir, entry.image);
      if (!(await exists(imagePath))) {
        line('refused:NO_FILE');
        continue;
      }
      const answer = answerOf(entry);
      if (!answer) {
        line('refused:NO_ANSWER');
        continue;
      }

      const person = isRealPerson(entry);
      let credit: { author: string; licence: string; sourceUrl: string };
      let slug: string;
      if (person) {
        const name = commonsFileOf(entry);
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
        const qid = items.get(frwikiTitleOf(entry));
        slug = qid ? slugOf(qid) : `${prefix}-${entry.id}`;
      } else {
        credit = {
          author: entry.source === 'fandom' ? `Fandom — ${entry.wiki ?? '?'}` : 'Wikipédia',
          licence: 'Usage privé',
          sourceUrl: entry.page_url,
        };
        slug = `${prefix}-${entry.id}${target.slugSuffix}`;
      }

      const packId = options.dryRun
        ? (packIds.get(target.pack) ?? (await this.findPack(packSlug)))
        : await this.ensurePack(target.pack, packSlug, ownerId, packIds);
      let remade = false;
      const here = packId
        ? await this.prisma.card.findFirst({
            where: { packId, slug },
            select: { id: true, status: true },
          })
        : null;
      if (here) {
        if (here.status !== 'DRAFT') {
          line('exists');
          continue;
        }
        // Its picture failed: it goes, and is made again.
        if (!options.dryRun) await this.prisma.card.delete({ where: { id: here.id } });
        remade = true;
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

      if (options.dryRun) {
        line(remade ? 'remade' : 'created', credit.licence);
        continue;
      }
      await this.waitForRoom(prefix);
      const card = await this.prisma.card.create({
        data: {
          packId: packId!,
          slug,
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
              { locale: 'fr', text: answer, aliases: [] },
              { locale: 'en', text: answer, aliases: [] },
            ],
          },
        },
        select: { id: true },
      });
      try {
        const incomingKey = storageKeys.incoming(randomUUID());
        await this.storage.put(incomingKey, await readFile(imagePath));
        await this.queue.add(
          MediaJob.ingestImage,
          { cardId: card.id, incomingKey, autoPoints: true, publish: true },
          { attempts: 1 },
        );
      } catch (error) {
        // No card without its picture on the way: a rerun makes it again.
        await this.prisma.card.delete({ where: { id: card.id } });
        throw error;
      }
      line(remade ? 'remade' : 'created', credit.licence);
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

  /** The pack by slug, made with its flags the first time; an existing pack is left as it is. */
  private async ensurePack(
    key: DatasetPackKey,
    slug: string,
    ownerId: string | null,
    cache: Map<DatasetPackKey, string>,
  ): Promise<string> {
    const cached = cache.get(key);
    if (cached) return cached;
    const found = await this.findPack(slug);
    if (found) {
      cache.set(key, found);
      return found;
    }
    const spec = DATASET_PACKS[key];
    const pack = await this.prisma.pack.create({
      data: {
        slug,
        titleFr: spec.titleFr,
        titleEn: spec.titleEn,
        category: spec.category,
        restricted: true,
        publicMatchSafe: false,
        ...(spec.private
          ? { visibility: 'PRIVATE', ownerId, publishable: false }
          : { visibility: 'PUBLIC' }),
      },
      select: { id: true },
    });
    cache.set(key, pack.id);
    return pack.id;
  }

  private async waitForRoom(prefix: string): Promise<void> {
    for (;;) {
      const pending = await this.prisma.card.count({
        where: { status: 'PROCESSING', pack: { slug: { startsWith: `${prefix}-` } } },
      });
      if (pending < PENDING) return;
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
  }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
