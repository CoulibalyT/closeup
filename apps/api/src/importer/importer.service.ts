import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IMPORT_PRESET_CATEGORY,
  type ImportInput,
  type ImportPreset,
  type ImportResult,
  type ImportSearch,
  type SessionUser,
} from '@closeup/shared';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';
import { MEDIA_QUEUE, MediaJob } from '../pipeline/media-queue.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { PREVIEW_WIDTH, type StoredCandidate, toCandidate } from './candidates.js';
import { searchQuery } from './presets.js';
import { WIKIMEDIA, type WikimediaApi } from './wikimedia.client.js';

type StoredSearch = Omit<ImportSearch, 'candidates'> & { candidates: StoredCandidate[] };

/** A finished search is kept this long: the popular subjects of a class do not change by the hour. */
const DONE_TTL_S = 6 * 3600;
/** A search under way, or one that failed, is forgotten sooner, so that it can be run again. */
const PENDING_TTL_S = 10 * 60;
/** Four attempts of 70 s at most, and the pauses between them: past this, it was lost. */
const STALE_MS = 8 * 60_000;
/** A download that failed is tried again later: Commons, too, has its moments. */
const IMPORT_JOB = { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } } as const;

/** Imported cards are known by their Wikidata item, so that a subject is never imported twice. */
export const slugOf = (qid: string) => `wd-${qid}`;

/**
 * The importer is one more producer of cards: it creates them with their answers and credit,
 * then hands their picture to the worker, like an upload. A search runs in the background and
 * is kept in Redis (the query service can take minutes on a bad day); the admin polls it.
 */
@Injectable()
export class ImporterService {
  private readonly logger = new Logger('Importer');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue,
  ) {}

  /** The last search for a preset, with the packs where each subject already is. */
  async get(preset: ImportPreset): Promise<StoredSearch | null> {
    const search = await this.read(preset);
    if (!search?.candidates.length) return search;

    const cards = await this.prisma.card.findMany({
      where: { slug: { in: search.candidates.map((candidate) => slugOf(candidate.qid)) } },
      select: { slug: true, pack: { select: { titleFr: true } } },
    });
    const packsOf = new Map<string, string[]>();
    for (const card of cards) {
      packsOf.set(card.slug!, [...(packsOf.get(card.slug!) ?? []), card.pack.titleFr]);
    }
    return {
      ...search,
      candidates: search.candidates.map((candidate) => ({
        ...candidate,
        importedIn: packsOf.get(slugOf(candidate.qid)) ?? [],
      })),
    };
  }

  /** Starts a search unless one is under way or recent. Answers at once; the admin polls. */
  async start(preset: ImportPreset): Promise<StoredSearch | null> {
    const current = await this.read(preset);
    const lost =
      current?.state === 'running' && Date.now() - Date.parse(current.startedAt) > STALE_MS;
    if (!current || current.state === 'failed' || lost) {
      const startedAt = new Date().toISOString();
      await this.write(
        { preset, state: 'running', startedAt, finishedAt: null, candidates: [] },
        PENDING_TTL_S,
      );
      void this.run(preset, startedAt);
    }
    return this.get(preset);
  }

  /** What the query service, Wikidata and Commons say about the subjects of one preset. */
  async search(preset: ImportPreset): Promise<StoredCandidate[]> {
    const rows = await this.wikimedia.sparql(searchQuery(preset));
    const [entities, files] = await Promise.all([
      this.wikimedia.entities(rows.map((row) => row.qid)),
      this.wikimedia.files([...new Set(rows.map((row) => row.file))], PREVIEW_WIDTH),
    ]);
    return rows.map((row) => toCandidate(row, entities.get(row.qid), files.get(row.file)));
  }

  /**
   * Cards for the subjects picked, in one of the house packs. Only what the server found is
   * imported, as it found it: the browser names subjects, it never supplies an answer, a credit
   * or a file. Each card starts in PROCESSING and waits for its zoom points in the editor.
   */
  async import({ preset, packId, qids }: ImportInput, actor: SessionUser): Promise<ImportResult> {
    // A player's pack holds pictures its owner confirmed the rights to: not the place for these.
    const pack = await this.prisma.pack.findUnique({ where: { id: packId } });
    if (!pack || pack.ownerId) throw new NotFoundException({ code: 'PACK_NOT_FOUND' });
    const search = await this.read(preset);
    if (search?.state !== 'done') throw new ConflictException({ code: 'SEARCH_EXPIRED' });

    const found = new Map(search.candidates.map((candidate) => [candidate.qid, candidate]));
    const result: ImportResult = { created: 0, skipped: [] };
    for (const qid of new Set(qids)) {
      const candidate = found.get(qid);
      if (!candidate) {
        result.skipped.push({ qid, reason: 'UNKNOWN' });
        continue;
      }
      if (candidate.rejection || !candidate.credit || !candidate.answers.fr) {
        result.skipped.push({ qid, reason: 'NOT_ELIGIBLE' });
        continue;
      }
      const cardId = await this.createCard(packId, preset, candidate);
      if (!cardId) {
        result.skipped.push({ qid, reason: 'ALREADY_IN_PACK' });
        continue;
      }
      await this.queue.add(MediaJob.importImage, { cardId, file: candidate.file }, IMPORT_JOB);
      result.created += 1;
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'pack.import',
        targetType: 'pack',
        targetId: packId,
        note: `Wikimedia, ${preset}: ${result.created} imported, ${result.skipped.length} skipped`,
      },
    });
    return result;
  }

  private async createCard(
    packId: string,
    preset: ImportPreset,
    candidate: StoredCandidate,
  ): Promise<string | null> {
    const slug = slugOf(candidate.qid);
    const existing = await this.prisma.card.findFirst({
      where: { packId, slug },
      select: { id: true },
    });
    if (existing) return null;
    const answers = (['fr', 'en'] as const).flatMap((locale) => {
      const answer = candidate.answers[locale];
      return answer ? [{ locale, text: answer.text, aliases: answer.aliases }] : [];
    });
    try {
      const card = await this.prisma.card.create({
        data: {
          packId,
          slug,
          source: 'WIKIMEDIA',
          status: 'PROCESSING',
          category: IMPORT_PRESET_CATEGORY[preset],
          difficulty: candidate.difficulty,
          isPerson: false,
          creditAuthor: candidate.credit!.author,
          creditLicence: candidate.credit!.licence,
          creditSourceUrl: candidate.credit!.sourceUrl,
          answers: { create: answers },
        },
        select: { id: true },
      });
      return card.id;
    } catch (error) {
      // Two imports of the same subject at once: the second one finds the first one's card.
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    }
  }

  private async run(preset: ImportPreset, startedAt: string): Promise<void> {
    let finished: StoredSearch;
    try {
      const candidates = await this.search(preset);
      finished = { preset, state: 'done', startedAt, finishedAt: now(), candidates };
      const importable = candidates.filter((candidate) => !candidate.rejection).length;
      this.logger.log(`Search ${preset}: ${candidates.length} found, ${importable} importable`);
    } catch (error) {
      this.logger.warn(`Search ${preset} failed: ${String(error)}`);
      finished = { preset, state: 'failed', startedAt, finishedAt: now(), candidates: [] };
    }
    await this.write(finished, finished.state === 'done' ? DONE_TTL_S : PENDING_TTL_S).catch(
      (error: unknown) => this.logger.error(`Search ${preset} could not be kept: ${String(error)}`),
    );
  }

  private key(preset: ImportPreset): string {
    // The queue prefix keeps apart the searches of test runs and of the stack on the same Redis.
    return `closeup:import:${this.config.env.QUEUE_PREFIX}:${preset}`;
  }

  private async read(preset: ImportPreset): Promise<StoredSearch | null> {
    const raw = await this.redis.get(this.key(preset));
    return raw ? (JSON.parse(raw) as StoredSearch) : null;
  }

  private async write(search: StoredSearch, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(search.preset), JSON.stringify(search), 'EX', ttlSeconds);
  }
}

const now = () => new Date().toISOString();
