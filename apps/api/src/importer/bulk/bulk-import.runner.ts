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
import { answerTaken } from '../answer-taken.js';
import { isDeniedSubject, isLatinName, isVagueSubject } from '../guards.js';
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

/**
 * A page that will not come is asked again this many times, a minute apart. Then a trivial query
 * says whether the service is down (wait, longer each time) or only this band is bad (skip it).
 */
const RETRIES = 3;
/** The longest wait between two tries while the query service is down. */
const MAX_BACKOFF_MS = 30 * 60_000;
/** A query any healthy service answers at once. */
const HEALTH_QUERY = 'SELECT ?ok WHERE { BIND(1 AS ?ok) }';
/** A picture whose job vanished (a restart between the card and its job) is given up after this. */
const ORPHAN_AFTER_MS = 30 * 60_000;
/** This many failed pictures within the window pause the run: Commons is refusing, not a file. */
const FAILURE_BREAKER = { count: 10, windowMs: 15 * 60_000 };
const jobIdOf = (cardId: string) => `bulk-${cardId}`;
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
  /** While the query service is down: since when, and how long the next wait is. */
  private outage: { since: Date; waitMs: number } | null = null;
  /** The wait the loop takes after a 'retry': a minute, or longer during an outage. */
  backoffMs = PAUSE_MS.retry;

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
      const pause = outcome === 'retry' ? this.backoffMs : PAUSE_MS[outcome];
      if (!this.stopped) this.timer = setTimeout(() => void loop(), pause);
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
    this.outage = null;
    this.backoffMs = PAUSE_MS.retry;
  }

  /** One step of the run in progress, if any. */
  async tick(): Promise<Outcome> {
    const run = await this.prisma.bulkImport.findFirst({
      where: { queuePrefix: this.config.env.QUEUE_PREFIX, status: 'running' },
      orderBy: { startedAt: 'asc' },
    });
    if (!run) return 'idle';
    await this.sweepOrphans(run.id);
    if (await this.picturesKeepFailing(run)) return 'idle';
    // A card whose picture failed does not count: the target is cards that can be played.
    const created = await this.prisma.card.count({
      where: { bulkImportId: run.id, status: { not: 'DRAFT' } },
    });
    if (created >= run.target) return this.finish(run, 'done');

    // In flight, from the cards themselves: waiting, active and retrying jobs alike.
    const pending = await this.prisma.card.count({
      where: { bulkImportId: run.id, status: 'PROCESSING' },
    });
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
        if (this.outage) note = await this.endOutage(run);
      } catch (error) {
        const key = `${run.id}:${cursor.className}:${cursor.band}:${cursor.page}`;
        const count = this.failing?.key === key ? this.failing.count + 1 : 1;
        this.failing = { key, count };
        if (count < RETRIES) {
          this.logger.warn(`${cursor.className}: ${String(error)} (try ${count})`);
          this.backoffMs = this.outage?.waitMs ?? PAUSE_MS.retry;
          return 'retry';
        }
        if (!(await this.serviceAnswers())) {
          // The service is down, not this band: the walk stays where it is and waits it out.
          await this.startOrExtendOutage(run);
          return 'retry';
        }
        if (this.outage) note = await this.endOutage(run);
        // This band alone will not come: it is left out, said so, and the walk goes on.
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
    try {
      await this.makeCards(run, room, packs, skips);
    } finally {
      // What this step skipped is kept even when a card could not be made.
      await this.prisma.bulkImport.update({
        where: { id: run.id },
        data: { skipped: total(skips), skipReasons: skips },
      });
    }
    return 'worked';
  }

  private async makeCards(
    run: BulkImport,
    room: number,
    packs: Map<string, string>,
    skips: Skips,
  ): Promise<number> {
    let made = 0;
    while (made < room && this.buffer?.items.length) {
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
      try {
        await this.queue.add(
          MediaJob.importImage,
          { cardId, file: next.candidate.file, publish: true },
          {
            jobId: jobIdOf(cardId),
            priority: BULK_PRIORITY,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
          },
        );
      } catch (error) {
        // A card with no job would wait for ever and keep its subject out: it goes, and the
        // subject is tried again at the next step.
        await this.prisma.card.delete({ where: { id: cardId } });
        this.buffer?.items.unshift(next);
        throw error;
      }
      made++;
    }
    return made;
  }

  /** A card left PROCESSING with no job (a restart between the two) is given up after a while. */
  private async sweepOrphans(runId: string): Promise<void> {
    const stale = await this.prisma.card.findMany({
      where: {
        bulkImportId: runId,
        status: 'PROCESSING',
        updatedAt: { lt: new Date(Date.now() - ORPHAN_AFTER_MS) },
      },
      select: { id: true },
    });
    for (const { id } of stale) {
      const job = await this.queue.getJob(jobIdOf(id));
      const state = job ? await job.getState() : 'missing';
      if (state === 'missing' || state === 'failed' || state === 'unknown') {
        await this.prisma.card.update({
          where: { id },
          data: { status: 'DRAFT', processingError: 'FAILED' },
        });
        this.logger.warn(`Card ${id}: its picture job is gone, given up`);
      }
    }
  }

  /** Pictures failing in a row mean Commons is refusing: the run pauses and says so. */
  private async picturesKeepFailing(run: BulkImport): Promise<boolean> {
    const failed = await this.prisma.card.count({
      where: {
        bulkImportId: run.id,
        status: 'DRAFT',
        processingError: { not: null },
        updatedAt: { gte: new Date(Date.now() - FAILURE_BREAKER.windowMs) },
      },
    });
    if (failed < FAILURE_BREAKER.count) return false;
    const why = `${failed} images refused in the last 15 min (Wikimedia Commons?): paused, resume when it answers again`;
    await this.prisma.bulkImport.update({
      where: { id: run.id },
      data: { status: 'paused', note: [run.note, why].filter(Boolean).join(' · ') },
    });
    this.buffer = null;
    this.logger.warn(`Run ${run.family}: ${why}`);
    return true;
  }

  /** Whether the query service answers at all. */
  private async serviceAnswers(): Promise<boolean> {
    try {
      await this.wikimedia.sparql(HEALTH_QUERY);
      return true;
    } catch {
      return false;
    }
  }

  private outageNote(): string {
    return `Wikidata unreachable since ${this.outage!.since.toISOString().slice(11, 16)} UTC, waiting`;
  }

  private async startOrExtendOutage(run: BulkImport): Promise<void> {
    const first = !this.outage;
    this.outage = first
      ? { since: new Date(), waitMs: 2 * PAUSE_MS.retry }
      : { ...this.outage!, waitMs: Math.min(this.outage!.waitMs * 2, MAX_BACKOFF_MS) };
    this.backoffMs = this.outage.waitMs;
    // The page is tried again after the wait, from its first try.
    this.failing = { key: this.failing!.key, count: RETRIES - 1 };
    if (first) {
      await this.prisma.bulkImport.update({
        where: { id: run.id },
        data: { note: [run.note, this.outageNote()].filter(Boolean).join(' · ') },
      });
      this.logger.warn(this.outageNote());
    }
  }

  /** The service answers again: the outage line leaves the note. */
  private async endOutage(run: BulkImport): Promise<string | null> {
    const line = this.outageNote();
    this.outage = null;
    this.backoffMs = PAUSE_MS.retry;
    const note =
      (run.note ?? '')
        .split(' · ')
        .filter((part) => part && part !== line)
        .join(' · ') || null;
    await this.prisma.bulkImport.update({ where: { id: run.id }, data: { note } });
    this.logger.log('Wikidata answers again');
    return note;
  }

  private firstCursor(family: BulkFamily): Cursor {
    const first = BULK_CLASSES[family][0];
    return first ? { className: first.key, band: 0, page: 0 } : END;
  }

  /**
   * One page of subjects, judged: the candidates the admin would have seen, minus what the
   * guards, the Latin rule and the file checks leave out (counted in `skips`). With `skipBand`,
   * nothing is asked: the walk only moves to the next band, or the next class after the last.
   */
  private async fetchPage(
    family: BulkFamily,
    cursor: Cursor,
    skips: Skips,
    skipBand: boolean,
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
    if (skipBand) return { items: [], next: after(false) };

    const rows = await this.wikimedia.sparql(bulkQuery(cls, bands[cursor.band]!, cursor.page));
    const qids = rows.map((row) => row.qid);
    let candidates: StoredCandidate[];
    if (cls.people) {
      candidates = await peopleCandidates(this.wikimedia, rows);
    } else {
      // No `mul` label for a thing: it is usually the scientific name, not an answer.
      const [entities, files] = await Promise.all([
        this.wikimedia.entities(qids, { mul: false }),
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
      if (!cls.people && isVagueSubject([subject.description.fr, subject.description.en])) {
        count('VAGUE');
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

  /**
   * A subject already in any pack is not made again; nor is an answer a catalogue card already
   * gives or is about to give (house packs only: a player's private card blocks nothing), case
   * and accents aside.
   */
  private async whySkip(item: Queued): Promise<string | null> {
    const exists = await this.prisma.card.findFirst({
      where: { slug: slugOf(item.candidate.qid) },
      select: { id: true },
    });
    if (exists) return 'DUPLICATE';
    const text = item.candidate.answers.fr?.text;
    if (!text) return null;
    return (await answerTaken(this.prisma, text)) ? 'DUPLICATE_ANSWER' : null;
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
