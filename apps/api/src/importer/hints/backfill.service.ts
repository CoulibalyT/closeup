import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { givesAnswer } from '../../content/hint-guard.js';
import { PrismaService } from '../../prisma/prisma.module.js';
import { WIKIMEDIA, type WikimediaApi } from '../wikimedia.client.js';
import { characterHint, classHint, personHint } from './build.js';

export interface HintOptions {
  /** Decide and report, write nothing. */
  dryRun?: boolean;
  /** Where the dataset's manifest is, for the characters' universes. */
  datasetDir?: string;
  /** Only these packs (tests); every pack otherwise. */
  packIds?: string[];
}

export interface HintLine {
  slug: string;
  answer: string;
  hint: string | null;
  secondary: number;
}

type Proposal = {
  fr: { hint: string | null; secondary: string[] };
  en: { hint: string | null; secondary: string[] };
};
const NONE = { hint: null, secondary: [] };

/**
 * Fills the empty hint and partial answers of the imported cards: people from Wikidata (what
 * they are known for), the dataset's characters from their universe, things from their class.
 * What the owner wrote is never touched; a hint that names the answer is dropped.
 */
@Injectable()
export class HintBackfill {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
  ) {}

  async run(
    options: HintOptions,
    onLine: (line: HintLine) => void,
  ): Promise<{ filled: number; skipped: number }> {
    const cards = await this.prisma.card.findMany({
      where: {
        status: { in: ['LIVE', 'READY', 'NEEDS_POINTS'] },
        OR: [{ slug: { startsWith: 'wd-' } }, { slug: { startsWith: 'ds-' } }],
        ...(options.packIds ? { packId: { in: options.packIds } } : {}),
      },
      select: { id: true, slug: true, isPerson: true, category: true, answers: true },
      orderBy: { slug: 'asc' },
    });
    // Only what still lacks something: a hint, or (for people and characters) partial answers.
    const todo = cards.filter((card) =>
      card.answers.some(
        (a) => !a.hint?.trim() || (!a.secondary.length && card.category !== 'OTHER'),
      ),
    );
    const qidOf = (slug: string | null) => /^wd-(Q\d+)$/.exec(slug ?? '')?.[1];
    const people = todo.filter((c) => c.isPerson && qidOf(c.slug));
    const things = todo.filter((c) => !c.isPerson && qidOf(c.slug));
    const characters = todo.filter((c) => !qidOf(c.slug) && c.category === 'CHARACTER');

    const proposals = new Map<string, Proposal>();
    if (people.length) {
      const qids = people.map((c) => qidOf(c.slug)!);
      const [fr, en] = await Promise.all([
        this.wikimedia.personFacts(qids, 'fr'),
        this.wikimedia.personFacts(qids, 'en'),
      ]);
      for (const card of people) {
        const qid = qidOf(card.slug)!;
        const name = (locale: string) => card.answers.find((a) => a.locale === locale)?.text ?? '';
        proposals.set(card.id, {
          fr: personHint(name('fr'), fr.get(qid) ?? { occupation: null, works: [] }),
          en: personHint(name('en') || name('fr'), en.get(qid) ?? { occupation: null, works: [] }),
        });
      }
    }
    if (things.length) {
      const subjects = await this.wikimedia.subjects(things.map((c) => qidOf(c.slug)!));
      const classes = [...new Set([...subjects.values()].flatMap((s) => s.instanceOf.slice(0, 1)))];
      const labels = classes.length
        ? await this.wikimedia.entities(classes, { mul: false })
        : new Map();
      for (const card of things) {
        const cls = subjects.get(qidOf(card.slug)!)?.instanceOf[0];
        const label = cls ? labels.get(cls)?.labels : undefined;
        const answer = (locale: string) =>
          card.answers.find((a) => a.locale === locale)?.text ?? '';
        proposals.set(card.id, {
          fr: { hint: classHint(label?.fr ?? null, answer('fr')), secondary: [] },
          en: { hint: classHint(label?.en ?? null, answer('en') || answer('fr')), secondary: [] },
        });
      }
    }
    if (characters.length && options.datasetDir) {
      // Read leniently: only the id, the name and the wiki matter here, and the dataset grows
      // outside the app (new categories and sources) faster than the import command.
      const raw = JSON.parse(
        await readFile(join(options.datasetDir, 'manifest.json'), 'utf8'),
      ) as unknown;
      const manifest = (Array.isArray(raw) ? raw : []).flatMap(
        (e: { id?: unknown; name?: unknown; wiki?: unknown; universe?: unknown }) =>
          typeof e?.id === 'string' && typeof e.name === 'string'
            ? [
                {
                  id: e.id,
                  name: e.name,
                  wiki: typeof e.wiki === 'string' ? e.wiki : undefined,
                  universe: typeof e.universe === 'string' ? e.universe.trim() : '',
                },
              ]
            : [],
      );
      const byId = new Map(manifest.map((entry) => [entry.id, entry]));
      for (const card of characters) {
        const id = card.slug!.replace(/^ds-/, '').replace(/-kids$/, '');
        const entry = byId.get(id);
        if (!entry) continue;
        // The dataset's own universe when it gives one; else guessed from the name or the wiki.
        const proposal = entry.universe
          ? { hint: entry.universe, secondary: [entry.universe] }
          : characterHint(entry.name, entry.wiki);
        proposals.set(card.id, { fr: proposal, en: proposal });
      }
    }

    let filled = 0;
    let skipped = 0;
    for (const card of todo) {
      const proposal = proposals.get(card.id);
      const answers = {
        fr: card.answers.find((a) => a.locale === 'fr'),
        en: card.answers.find((a) => a.locale === 'en'),
      };
      const sets = (['fr', 'en'] as const).flatMap((l) =>
        answers[l] ? [{ text: answers[l]!.text, aliases: answers[l]!.aliases }] : [],
      );
      let changed = false;
      for (const locale of ['fr', 'en'] as const) {
        const row = answers[locale];
        const wanted = proposal?.[locale] ?? NONE;
        if (!row) continue;
        const hint =
          !row.hint?.trim() && wanted.hint && !sets.some((set) => givesAnswer(wanted.hint!, set))
            ? wanted.hint
            : null;
        const secondary =
          !row.secondary.length && wanted.secondary.length ? wanted.secondary : null;
        if (!hint && !secondary) continue;
        changed = true;
        if (!options.dryRun) {
          await this.prisma.cardAnswer.update({
            where: { id: row.id },
            data: { ...(hint ? { hint } : {}), ...(secondary ? { secondary } : {}) },
          });
        }
      }
      if (changed) filled++;
      else skipped++;
      onLine({
        slug: card.slug ?? card.id,
        answer: answers.fr?.text ?? '',
        hint: proposal?.fr.hint ?? null,
        secondary: proposal?.fr.secondary.length ?? 0,
      });
    }
    return { filled, skipped };
  }
}
