import {
  IMPORT,
  type ImportAnswer,
  type ImportCandidate,
  type ImportRejection,
  licenceTerms,
} from '@closeup/shared';
import type { CommonsFile, SparqlRow, WikidataEntity } from './wikimedia.client.js';

/** The limits of the card editor's own form: an imported card must save as it is. */
const ANSWER_MAX = 80;
const ALIASES_MAX = 12;
const CREDIT_MAX = 120;

/** The width of the preview the admin sees. 330 px is one of Wikimedia's standard steps. */
export const PREVIEW_WIDTH = 330;

/** A candidate as the server keeps it: what the admin sees, plus the file to download. */
export type StoredCandidate = ImportCandidate & { file: string };

/** What the importer knows of a person, beyond their item: given only for the people sources. */
export interface PersonCandidateFacts {
  description: string | null;
  familyName: { fr?: string; en?: string };
  /** The line of a name search this person answers, if any. */
  query: string | null;
}

/**
 * One subject found by a search, turned into what the admin decides on. Whether it can be
 * imported is decided here, once, from what Wikimedia said; the reasons are shown to the admin.
 */
export function toCandidate(
  row: SparqlRow,
  entity: WikidataEntity | undefined,
  file: CommonsFile | undefined,
  person?: PersonCandidateFacts,
): StoredCandidate {
  const answer = (locale: 'fr' | 'en') => {
    const label = entity?.labels[locale];
    const extra = person && label ? familyAlias(label, person.familyName[locale]) : null;
    return answerFrom(label, [...(entity?.aliases[locale] ?? []), ...(extra ? [extra] : [])]);
  };
  const answers = { fr: answer('fr'), en: answer('en') };
  const judged = file
    ? judgeFile(file, { people: Boolean(person) })
    : { rejection: 'NO_FILE' as const };
  const rejection = 'rejection' in judged ? judged.rejection : answers.fr ? null : 'NO_FRENCH_NAME';
  return {
    qid: row.qid,
    file: row.file,
    popularity: row.popularity,
    difficulty: difficultyFor(row.popularity),
    answers,
    thumbUrl: file?.thumbUrl ?? null,
    width: file?.width ?? 0,
    height: file?.height ?? 0,
    credit: 'credit' in judged ? judged.credit : null,
    rejection,
    importedIn: [],
    query: person?.query ?? null,
    description: person?.description ?? null,
  };
}

/**
 * Whether a picture can be shown in the game, and how to credit it. The first reason found is
 * the one given: rights before format, because a picture nobody may use is not worth resizing.
 */
export function judgeFile(
  file: CommonsFile,
  options: { people?: boolean } = {},
): { credit: NonNullable<ImportCandidate['credit']> } | { rejection: ImportRejection } {
  const restrictions = (file.metadata.Restrictions ?? '').toLowerCase().split('|');
  // People: the owner accepted the image-rights risk of identifiable persons (see the README).
  if (restrictions.includes('personality') && !options.people) return { rejection: 'PERSONALITY' };
  if (restrictions.some((flag) => flag === 'trademarked' || flag === 'insignia')) {
    return { rejection: 'RESTRICTED' };
  }

  // Commons has a code ("cc-by-sa-3.0-migrated") and a name ("CC BY-SA 3.0"): either will do.
  const licence = (file.metadata.LicenseShortName ?? '').trim() || file.metadata.License || '';
  const free = [file.metadata.License ?? '', licence].some((text) => licenceTerms(text).free);
  if (!free) return { rejection: 'LICENCE' };

  // Even a public domain picture gets a name: a card is only published with a full credit.
  const author = clip(plainText(file.metadata.Artist ?? ''), CREDIT_MAX);
  if (!author) return { rejection: 'NO_AUTHOR' };

  if (file.mime !== 'image/jpeg' && file.mime !== 'image/png') return { rejection: 'FORMAT' };
  if (Math.min(file.width, file.height) < IMPORT.minSidePx) return { rejection: 'TOO_SMALL' };

  return {
    credit: {
      author,
      licence: clip(licence, CREDIT_MAX),
      // The page id, not the file name: shorter, stable, and a file name can give the answer away.
      sourceUrl: `https://commons.wikimedia.org/w/index.php?curid=${file.pageId}`,
    },
  };
}

/**
 * A Wikidata label as an answer. "Mercure (planète)" loses its brackets; aliases that say the
 * same thing as the label, or as each other, once accents and case are set aside, go.
 */
export function answerFrom(label: string | undefined, aliases: string[] = []): ImportAnswer | null {
  const text = tidy(label ?? '');
  if (!text || text.length > ANSWER_MAX) return null;
  const seen = new Set([sameness(text)]);
  const kept: string[] = [];
  for (const alias of aliases) {
    const cleaned = tidy(alias);
    if (!cleaned || cleaned.length > ANSWER_MAX || seen.has(sameness(cleaned))) continue;
    seen.add(sameness(cleaned));
    kept.push(cleaned);
    if (kept.length === ALIASES_MAX) break;
  }
  return { text, aliases: kept };
}

/** "1er", "Ier", "XIV", "Jr": the end of a name that is not a family name. */
const NOT_A_FAMILY_NAME = /^(?:[IVXLC]+|\d+|\d*(?:er|re|e|ème)|Ier|Ire|Jr\.?|Sr\.?)$/i;

/**
 * The family name alone, accepted as an answer for a person (the brief). Wikidata's family name
 * when it has one; otherwise the last word, unless the name is one word or ends with a numeral
 * ("Louis XIV" is not "XIV").
 */
export function familyAlias(name: string, familyName: string | undefined): string | null {
  const whole = tidy(name);
  const given = familyName ? tidy(familyName) : '';
  if (given) return sameness(given) === sameness(whole) ? null : given;
  const words = whole.split(' ');
  const last = words.at(-1) ?? '';
  if (words.length < 2 || last.length < 2 || NOT_A_FAMILY_NAME.test(last)) return null;
  return last;
}

/** The better known, the easier: a first guess the admin can change in the editor. */
export function difficultyFor(popularity: number): 1 | 2 | 3 {
  if (popularity >= 150) return 1;
  if (popularity >= 80) return 2;
  return 3;
}

/** Commons gives the author as HTML: links to user pages, "&amp;" and the like. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const tidy = (text: string) =>
  text
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const sameness = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
