import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { BULK, type BulkFamily, RESTRICTED_CATEGORIES } from '@closeup/shared';
import type { Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config.js';
import type { BulkImport, Prisma } from '../../generated/prisma/client.js';
import { BULK_PRIORITY, MEDIA_QUEUE, MediaJob } from '../../pipeline/media-queue.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import { bandsOf, BULK_CLASSES, type BulkClass, bulkQuery } from '../bulk-families.js';
import { PREVIEW_WIDTH, type StoredCandidate, toCandidate } from '../candidates.js';
import { CardFactory, slugOf } from '../card-factory.js';
import { isDeniedSubject, isLatinName } from '../guards.js';
import { peopleCandidates } from '../people.js';
import { type SubjectFacts, WIKIMEDIA, type WikimediaApi } from '../wikimedia.client.js';

/** Where the walk stands: the page of one class and one popularity band being consumed. */
interface Cursor {
  className: string;
  band: number;
  page: number;
}
/** The end of the walk: no class left. */
const END: Cursor = { className: '', band: 0, page: 0 };

type Queued = { cls: BulkClass; candidate: StoredCandidate; facts: SubjectFacts };
type Skips = Record<string, number>;
type Outcome = 'idle' | 'full' | 'retry' | 'worked' | 'done';

/** A page that will not come is asked again this many times, a minute apart, then its class goes. */
const RETRIES = 3;
/** Between two steps, by what the last one found. */
const PAUSE_MS: Record<Outcome, number> = {
  worked: 2_000,
  full: 5_000,
  retry: 60_000,
  idle: 15_000,
  done: 15_000,
};
const NO_FACTS: SubjectFacts = {
  instanceOf: [],
  subclassOf: [],
  taxonName: null,
  description: { fr: null, en: null },
};

/**
 * The worker's side of a mass import. A `BulkImport` row says what to do and where the walk
 * stands; this loop reads it at every step, so that a pause, a stop or a restart is felt at the
 * next one. One step is: a page of one Wikidata class if nothing is in hand, then a few cards
 * from it, their pictures handed to the image queue behind every other job.
 */
@Injectable()
export class BulkImportRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BulkImport');
  private timer?: NodeJS.Timeout;
  private stopped = false;
  /** The page in hand: its run, what is left of it, and where the walk goes after it. */
  private buffer: { runId: string; items: Queued[]; next: Cursor } | null = null;
  /** A page that keeps failing, and how many times. */
  private failing: { key: string; count: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
    private readonly cards: CardFactory,
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.env.BULK_RUNNER === 'off') return;
    const loop = async () => {
      if (this.stopped) return;
      let outcome: Outcome = 'idle';
      try {
        outcome = await this.tick();
      } catch (error) {
        this.logger.error(`A step failed: ${String(error)}`);
      }
      if (!this.stopped) this.timer = setTimeout(() => void loop(), PAUSE_MS[outcome]);
    };
    void loop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** What a restart does: the page in hand is forgotten; the row remembers which one it was. */
  forget(): void {
    this.buffer = null;
    this.failing = null;
  }

  /** One step of the run in progress, if any. */
  async tick(): Promise<Outcome> {
    const run = await this.prisma.bulkImport.findFirst({
      where: { queuePrefix: this.config.env.QUEUE_PREFIX, status: 'running' },
      orderBy: { startedAt: 'asc' },
    });
    if (!run) return 'idle';
    const created = await this.prisma.card.count({ where: { bulkImportId: run.id } });
    if (created >= run.target) return this.finish(run, 'done');

    const counts = await this.queue.getCountsPerPriority([BULK_PRIORITY]);
    const pending = counts[String(BULK_PRIORITY)] ?? 0;
    if (pending >= BULK.pendingJobs) return 'full';

    const skips: Skips = { ...(run.skipReasons as Skips) };
    let note = run.note;
    if (this.buffer?.runId !== run.id || !this.buffer.items.length) {
      // The page in hand is spent: the row moves on to the next one, then it is fetched. After a
      // restart the same page is fetched again; what it already gave skips as a duplicate.
      let cursor = (run.cursor as Cursor | null) ?? this.firstCursor(run.family as BulkFamily);
      if (this.buffer?.runId === run.id) cursor = this.buffer.next;
      if (cursor.className === '') return this.finish(run, 'done', 'every class walked');

      let page: { items: Queued[]; next: Cursor };
      try {
        page = await this.fetchPage(run.family as BulkFamily, cursor, skips, false);
        this.failing = null;
      } catch (error) {
        const key = `${run.id}:${cursor.className}:${cursor.band}:${cursor.page}`;
        const count = this.failing?.key === key ? this.failing.count + 1 : 1;
        this.failing = { key, count };
        if (count < RETRIES) {
          this.logger.warn(`${cursor.className}: ${String(error)} (try ${count})`);
          return 'retry';
        }
        // Three times is enough: this class is left out, said so, and the walk goes on.
        note = [note, `${cursor.className}: ${String(error)}`].filter(Boolean).join(' · ');
        page = await this.fetchPage(run.family as BulkFamily, cursor, skips, true);
        this.failing = null;
      }
      this.buffer = { runId: run.id, items: page.items, next: page.next };
      await this.prisma.bulkImport.update({
        where: { id: run.id },
        data: {
          cursor: cursor as unknown as Prisma.InputJsonValue,
          note,
          skipped: total(skips),
          skipReasons: skips,
        },
      });
      if (!page.items.length) return 'worked';
    }

    const room = Math.min(BULK.pendingJobs - pending, run.target - created);
    const packs = new Map<string, string>();
    let made = 0;
    while (made < room && this.buffer.items.length) {
      const next = this.buffer.items.shift()!;
      const skip = await this.whySkip(next);
      if (skip) {
        skips[skip] = (skips[skip] ?? 0) + 1;
        continue;
      }
      const packId = await this.packFor(next.cls, packs);
      const cardId = await this.cards.fromCandidate(packId, next.candidate, {
        category: next.cls.pack.category,
        isPerson: Boolean(next.cls.people),
        difficulty: next.cls.difficulty,
        bulkImportId: run.id,
      });
      if (!cardId) {
        skips.DUPLICATE = (skips.DUPLICATE ?? 0) + 1;
        continue;
      }
      await this.queue.add(
        MediaJob.importImage,
        { cardId, file: next.candidate.file, publish: true },
        { priority: BULK_PRIORITY, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
      );
      made++;
    }
    await this.prisma.bulkImport.update({
      where: { id: run.id },
      data: { skipped: total(skips), skipReasons: skips },
    });
    return 'worked';
  }

  private firstCursor(family: BulkFamily): Cursor {
    const first = BULK_CLASSES[family][0];
    return first ? { className: first.key, band: 0, page: 0 } : END;
  }

  /**
   * One page of subjects, judged: the candidates the admin would have seen, minus what the
   * guards, the Latin rule and the file checks leave out (counted in `skips`). With `skipClass`,
   * nothing is asked: the walk only moves to the next class.
   */
  private async fetchPage(
    family: BulkFamily,
    cursor: Cursor,
    skips: Skips,
    skipClass: boolean,
  ): Promise<{ items: Queued[]; next: Cursor }> {
    const classes = BULK_CLASSES[family];
    const index = classes.findIndex((cls) => cls.key === cursor.className);
    if (index < 0) return { items: [], next: END };
    const cls = classes[index]!;
    const bands = bandsOf(cls);
    const nextClass = (): Cursor => {
      const following = classes[index + 1];
      return following ? { className: following.key, band: 0, page: 0 } : END;
    };
    const after = (full: boolean): Cursor => {
      if (full && cursor.page + 1 < BULK.pagesPerBand) return { ...cursor, page: cursor.page + 1 };
      if (cursor.band + 1 < bands.length) {
        return { className: cls.key, band: cursor.band + 1, page: 0 };
      }
      return nextClass();
    };
    if (skipClass) return { items: [], next: nextClass() };

    const rows = await this.wikimedia.sparql(bulkQuery(cls, bands[cursor.band]!, cursor.page));
    const qids = rows.map((row) => row.qid);
    let candidates: StoredCandidate[];
    if (cls.people) {
      candidates = await peopleCandidates(this.wikimedia, rows);
    } else {
      const [entities, files] = await Promise.all([
        this.wikimedia.entities(qids),
        this.wikimedia.files([...new Set(rows.map((row) => row.file))], PREVIEW_WIDTH),
      ]);
      candidates = rows.map((row) => toCandidate(row, entities.get(row.qid), files.get(row.file)));
    }
    const facts = await this.wikimedia.subjects(qids);

    const items: Queued[] = [];
    const count = (reason: string) => (skips[reason] = (skips[reason] ?? 0) + 1);
    for (const candidate of candidates) {
      const subject = facts.get(candidate.qid) ?? NO_FACTS;
      const denied = isDeniedSubject({
        instanceOf: subject.instanceOf,
        subclassOf: subject.subclassOf,
        labels: [candidate.answers.fr?.text, candidate.answers.en?.text].filter(
          (text): text is string => Boolean(text),
        ),
        descriptions: [subject.description.fr, subject.description.en].filter(
          (text): text is string => Boolean(text),
        ),
      });
      if (denied) {
        count(denied);
        continue;
      }
      if (
        !cls.people &&
        candidate.answers.fr &&
        isLatinName(candidate.answers.fr.text, subject.taxonName)
      ) {
        count('LATIN_NAME');
        continue;
      }
      if (candidate.rejection || !candidate.credit || !candidate.answers.fr) {
        count('NOT_ELIGIBLE');
        continue;
      }
      items.push({ cls, candidate, facts: subject });
    }
    this.logger.log(
      `${cls.key} band ${cursor.band} page ${cursor.page}: ${rows.length} rows, ${items.length} kept`,
    );
    return { items, next: after(rows.length >= BULK.pageSize) };
  }

  /** A subject already in any pack, or an answer a live card already gives, is not made again. */
  private async whySkip(item: Queued): Promise<string | null> {
    const exists = await this.prisma.card.findFirst({
      where: { slug: slugOf(item.candidate.qid) },
      select: { id: true },
    });
    if (exists) return 'DUPLICATE';
    const text = item.candidate.answers.fr?.text;
    if (!text) return null;
    const sameAnswer = await this.prisma.cardAnswer.findFirst({
      where: {
        locale: 'fr',
        text: { equals: text, mode: 'insensitive' },
        card: { status: 'LIVE' },
      },
      select: { id: true },
    });
    return sameAnswer ? 'DUPLICATE_ANSWER' : null;
  }

  /**
   * The pack a class fills: the first "bulk-<key>-<n>" that is neither switched off nor full;
   * else a new one, numbered after the last. Switching a pack off is how the owner takes its
   * cards out of the game; the run then goes on in the next one.
   */
  private async packFor(cls: BulkClass, cache: Map<string, string>): Promise<string> {
    const { key, titleFr, titleEn, category } = cls.pack;
    const cached = cache.get(key);
    if (cached) return cached;
    const prefix = `bulk-${key}-`;
    const packs = await this.prisma.pack.findMany({
      where: { slug: { startsWith: prefix } },
      include: { _count: { select: { cards: true } } },
    });
    const numbered = packs
      .map((pack) => ({ pack, n: Number(pack.slug!.slice(prefix.length)) }))
      .filter(({ n }) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a.n - b.n);
    const open = numbered.find(
      ({ pack }) => pack.visibility !== 'DISABLED' && pack._count.cards < BULK.packSize,
    );
    if (open) {
      cache.set(key, open.pack.id);
      return open.pack.id;
    }
    const n = (numbered.at(-1)?.n ?? 0) + 1;
    const pack = await this.prisma.pack.create({
      data: {
        slug: `${prefix}${n}`,
        titleFr: n === 1 ? titleFr : `${titleFr} — ${n}`,
        titleEn: n === 1 ? titleEn : `${titleEn} — ${n}`,
        category,
        visibility: 'PUBLIC',
        restricted: RESTRICTED_CATEGORIES.includes(category),
      },
    });
    this.logger.log(`Pack ${pack.slug} opened`);
    cache.set(key, pack.id);
    return pack.id;
  }

  /** The run is over; what the row already noted stays, the reason is added after it. */
  private async finish(run: BulkImport, status: 'done' | 'failed', note?: string): Promise<'done'> {
    await this.prisma.bulkImport.update({
      where: { id: run.id },
      data: { status, note: [run.note, note].filter(Boolean).join(' · ') || null },
    });
    this.buffer = null;
    this.logger.log(`Run ${run.family} × ${run.target}: ${status}`);
    return 'done';
  }
}

const total = (skips: Skips) => Object.values(skips).reduce((sum, n) => sum + n, 0);

/** Kept for the row's type: the model is what the service and the runner share. */
export type { BulkImport };
