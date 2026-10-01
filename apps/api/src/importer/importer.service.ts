import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IMPORT_SOURCE_CATEGORY,
  type ImportInput,
  type ImportPreset,
  type ImportResult,
  type ImportSearch,
  type ImportSearchInput,
  type ImportSource,
  isPeopleSource,
  type SessionUser,
} from '@closeup/shared';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';
import { MEDIA_QUEUE, MediaJob } from '../pipeline/media-queue.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { PREVIEW_WIDTH, type StoredCandidate, toCandidate } from './candidates.js';
import { SEARCH_LIMIT, searchQueries } from './presets.js';
import {
  type PersonFacts,
  type SparqlRow,
  WIKIMEDIA,
  type WikimediaApi,
} from './wikimedia.client.js';

type StoredSearch = Omit<ImportSearch, 'candidates'> & { candidates: StoredCandidate[] };

/** A finished search is kept this long: the popular subjects of a class do not change by the hour. */
const DONE_TTL_S = 6 * 3600;
/** A search under way, or one that failed, is forgotten sooner, so that it can be run again. */
const PENDING_TTL_S = 10 * 60;
/** Four attempts of 70 s at most, and the pauses between them: past this, it was lost. */
const STALE_MS = 8 * 60_000;
/** Namesakes kept for one line of a name search, the best known first. */
const NAMESAKES = 3;
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

  /** The last search for a source, with the packs where each subject already is. */
  async get(source: ImportSource): Promise<StoredSearch | null> {
    const search = await this.read(source);
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
  async start(input: ImportSearchInput): Promise<StoredSearch | null> {
    const source = input.preset;
    const current = await this.read(source);
    const lost =
      current?.state === 'running' && Date.now() - Date.parse(current.startedAt) > STALE_MS;
    // A new list of names always starts a new search: the last one answered other names.
    if (!current || current.state === 'failed' || lost || source === 'names') {
      const startedAt = new Date().toISOString();
      await this.write(
        {
          preset: source,
          state: 'running',
          startedAt,
          finishedAt: null,
          candidates: [],
          unmatched: [],
        },
        PENDING_TTL_S,
      );
      void this.run(input, startedAt);
    }
    return this.get(source);
  }

  /** What the query service, Wikidata and Commons say about the subjects of one search. */
  async search(
    input: ImportSearchInput,
  ): Promise<{ candidates: StoredCandidate[]; unmatched: string[] }> {
    if (input.preset === 'names') return this.searchNames(input.names);
    const rows = await this.rows(input.preset);
    if (isPeopleSource(input.preset)) {
      return { candidates: await this.candidatesForPeople(rows, new Map()), unmatched: [] };
    }
    const [entities, files] = await Promise.all([
      this.wikimedia.entities(rows.map((row) => row.qid)),
      this.wikimedia.files([...new Set(rows.map((row) => row.file))], PREVIEW_WIDTH),
    ]);
    return {
      candidates: rows.map((row) => toCandidate(row, entities.get(row.qid), files.get(row.file))),
      unmatched: [],
    };
  }

  /**
   * The subjects of a preset, its queries run one after the other (people come in several small
   * queries) and merged, the best known first. One that fails is left out as long as another
   * answered: the search fails only when none did.
   */
  private async rows(preset: ImportPreset): Promise<SparqlRow[]> {
    const best = new Map<string, SparqlRow>();
    let failure: unknown = null;
    let answered = false;
    for (const query of searchQueries(preset)) {
      try {
        for (const row of await this.wikimedia.sparql(query)) {
          if ((best.get(row.qid)?.popularity ?? -1) < row.popularity) best.set(row.qid, row);
        }
        answered = true;
      } catch (error) {
        failure = error;
        this.logger.warn(`Search ${preset}: one query failed: ${String(error)}`);
      }
    }
    if (!answered) throw failure;
    return [...best.values()].sort((a, b) => b.popularity - a.popularity).slice(0, SEARCH_LIMIT);
  }

  /** Each line: the humans that match it, best known first, a few namesakes at most. */
  private async searchNames(
    names: string[],
  ): Promise<{ candidates: StoredCandidate[]; unmatched: string[] }> {
    const lines = [...new Set(names)];
    const hits = await Promise.all(lines.map((name) => this.wikimedia.searchHumans(name)));
    const facts = await this.wikimedia.people([...new Set(hits.flat())]);
    const rows: SparqlRow[] = [];
    const queryOf = new Map<string, string>();
    const unmatched: string[] = [];
    lines.forEach((name, index) => {
      const humans = (hits[index] ?? [])
        .flatMap((qid) => {
          const person = facts.get(qid);
          return person?.human && person.frenchArticle ? [{ qid, person }] : [];
        })
        .sort((a, b) => b.person.popularity - a.person.popularity)
        .slice(0, NAMESAKES);
      if (!humans.length) unmatched.push(name);
      for (const { qid, person } of humans) {
        // The same person under two lines is listed once, under the first.
        if (queryOf.has(qid)) continue;
        queryOf.set(qid, name);
        rows.push({ qid, popularity: person.popularity, file: person.file ?? '' });
      }
    });
    return { candidates: await this.candidatesForPeople(rows, queryOf, facts), unmatched };
  }

  /**
   * People as candidates: their description, their family name as an alias, the line of a name
   * search they answer. A person without a picture is listed, refused for want of a file.
   */
  private async candidatesForPeople(
    rows: SparqlRow[],
    queryOf: Map<string, string>,
    known?: Map<string, PersonFacts>,
  ): Promise<StoredCandidate[]> {
    const facts = known ?? (await this.wikimedia.people(rows.map((row) => row.qid)));
    const familyQids = [
      ...new Set([...facts.values()].flatMap((f) => (f.familyNameQid ? [f.familyNameQid] : []))),
    ];
    const [entities, files, families] = await Promise.all([
      this.wikimedia.entities(rows.map((row) => row.qid)),
      this.wikimedia.files(
        [...new Set(rows.map((row) => row.file).filter(Boolean))],
        PREVIEW_WIDTH,
      ),
      this.wikimedia.entities(familyQids),
    ]);
    return rows.map((row) => {
      const person = facts.get(row.qid);
      const family = person?.familyNameQid ? families.get(person.familyNameQid) : undefined;
      return toCandidate(row, entities.get(row.qid), row.file ? files.get(row.file) : undefined, {
        description: person?.description ?? null,
        familyName: { fr: family?.labels.fr, en: family?.labels.en },
        query: queryOf.get(row.qid) ?? null,
      });
    });
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
    // Real people go into celebrity packs, which are restricted: never into a pack of objects.
    if (isPeopleSource(preset) && pack.category !== 'CELEBRITY') {
      throw new ConflictException({ code: 'PACK_NOT_FOR_PEOPLE' });
    }
    const search = await this.read(preset);
    if (search?.state !== 'done') throw new ConflictException({ code: 'SEARCH_EXPIRED' });

    const found = new Map(search.candidates.map((candidate) => [candidate.qid, candidate]));
    const result: ImportResult = { created: 0, cardIds: [], skipped: [] };
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
      result.cardIds.push(cardId);
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
    preset: ImportSource,
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
          category: IMPORT_SOURCE_CATEGORY[preset],
          difficulty: candidate.difficulty,
          isPerson: isPeopleSource(preset),
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

  private async run(input: ImportSearchInput, startedAt: string): Promise<void> {
    const preset = input.preset;
    let finished: StoredSearch;
    try {
      const { candidates, unmatched } = await this.search(input);
      finished = { preset, state: 'done', startedAt, finishedAt: now(), candidates, unmatched };
      const importable = candidates.filter((candidate) => !candidate.rejection).length;
      this.logger.log(`Search ${preset}: ${candidates.length} found, ${importable} importable`);
    } catch (error) {
      this.logger.warn(`Search ${preset} failed: ${String(error)}`);
      finished = {
        preset,
        state: 'failed',
        startedAt,
        finishedAt: now(),
        candidates: [],
        unmatched: [],
      };
    }
    await this.write(finished, finished.state === 'done' ? DONE_TTL_S : PENDING_TTL_S).catch(
      (error: unknown) => this.logger.error(`Search ${preset} could not be kept: ${String(error)}`),
    );
  }

  private key(preset: ImportSource): string {
    // The queue prefix keeps apart the searches of test runs and of the stack on the same Redis.
    return `closeup:import:${this.config.env.QUEUE_PREFIX}:${preset}`;
  }

  private async read(preset: ImportSource): Promise<StoredSearch | null> {
    const raw = await this.redis.get(this.key(preset));
    return raw ? (JSON.parse(raw) as StoredSearch) : null;
  }

  private async write(search: StoredSearch, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(search.preset), JSON.stringify(search), 'EX', ttlSeconds);
  }
}

const now = () => new Date().toISOString();
