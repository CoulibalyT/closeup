import { z } from 'zod';
import { type Category } from './admin.js';
import { idSchema } from './common.js';

/**
 * Back-office contract of the Wikidata + Commons importer (`/api/admin/import/*`). The importer
 * proposes, the admin picks: nothing is imported unseen, and nothing imported plays before it
 * has been through the card editor for its zoom points.
 */

/**
 * What can be searched. Each preset is a small, targeted Wikidata query sorted by popularity
 * (the number of Wikipedias with an article). The people presets bring real people: their cards
 * are celebrities, isolated from default games, and the owner accepted the image-rights risk of
 * Commons files flagged "personality" (see the README).
 */
export const PEOPLE_PRESETS = ['actors', 'musicians', 'sports', 'historical'] as const;
export const IMPORT_PRESETS = [
  'animals',
  'fruits',
  'dishes',
  'instruments',
  'tools',
  'vehicles',
  'heritage',
  ...PEOPLE_PRESETS,
] as const;
export const importPresetSchema = z.enum(IMPORT_PRESETS);
export type ImportPreset = z.infer<typeof importPresetSchema>;

/** A preset, or a list of names pasted by the admin. */
export const IMPORT_SOURCES = [...IMPORT_PRESETS, 'names'] as const;
export const importSourceSchema = z.enum(IMPORT_SOURCES);
export type ImportSource = z.infer<typeof importSourceSchema>;

export const isPeopleSource = (source: ImportSource): boolean =>
  source === 'names' || (PEOPLE_PRESETS as readonly string[]).includes(source);

export const IMPORT_SOURCE_CATEGORY: Record<ImportSource, Category> = {
  animals: 'ANIMAL',
  fruits: 'FOOD',
  dishes: 'FOOD',
  instruments: 'OBJECT',
  tools: 'OBJECT',
  vehicles: 'VEHICLE',
  heritage: 'LANDMARK',
  actors: 'CELEBRITY',
  musicians: 'CELEBRITY',
  sports: 'CELEBRITY',
  historical: 'CELEBRITY',
  names: 'CELEBRITY',
};

export const IMPORT = {
  /** The shorter side. Sharper than an upload's floor: every card is looked at from very close. */
  minSidePx: 1000,
  /** Picked at once: each one is a download and a job for the worker, one after the other. */
  maxPerImport: 40,
} as const;

/** Why a candidate cannot be imported. Shown next to it, so that the choice stays informed. */
export const IMPORT_REJECTIONS = [
  /** Not public domain, CC0, CC BY or CC BY-SA. */
  'LICENCE',
  /** An attribution licence with nobody to attribute it to. */
  'NO_AUTHOR',
  /** Commons flags an identifiable person (personality rights). */
  'PERSONALITY',
  /** Commons flags a trademark or an official insignia. */
  'RESTRICTED',
  /** Neither JPEG nor PNG (drawings in SVG, animations, TIFF scans). */
  'FORMAT',
  /** Shorter side under `IMPORT.minSidePx`. */
  'TOO_SMALL',
  /** No French name on Wikidata: a card cannot be published without a French answer. */
  'NO_FRENCH_NAME',
  /** Commons did not describe the picture (deleted, renamed). */
  'NO_FILE',
] as const;
export type ImportRejection = (typeof IMPORT_REJECTIONS)[number];

export interface ImportAnswer {
  text: string;
  aliases: string[];
}

export interface ImportCandidate {
  /** The Wikidata item, e.g. "Q140". */
  qid: string;
  popularity: number;
  difficulty: 1 | 2 | 3;
  answers: { fr: ImportAnswer | null; en: ImportAnswer | null };
  /** A small preview from Wikimedia's servers, for the admin's eyes only. */
  thumbUrl: string | null;
  width: number;
  height: number;
  credit: { author: string; licence: string; sourceUrl: string } | null;
  rejection: ImportRejection | null;
  /** Titles of the packs that already hold this subject. */
  importedIn: string[];
  /** For a name search: the line it answers. Several candidates may share one (namesakes). */
  query: string | null;
  /** Wikidata's short description ("footballeur français"): tells namesakes apart. */
  description: string | null;
}

export type ImportSearchState = 'running' | 'done' | 'failed';

export interface ImportSearch {
  preset: ImportSource;
  state: ImportSearchState;
  startedAt: string;
  finishedAt: string | null;
  candidates: ImportCandidate[];
  /** For a name search: the lines that matched no person at all. */
  unmatched: string[];
}

const nameLine = z.string().trim().min(2).max(80);

export const importSearchInputSchema = z.union([
  z.strictObject({ preset: importPresetSchema }),
  z.strictObject({
    preset: z.literal('names'),
    names: z.array(nameLine).min(1).max(IMPORT.maxPerImport),
  }),
]);
export type ImportSearchInput = z.infer<typeof importSearchInputSchema>;

export const importInputSchema = z.strictObject({
  preset: importSourceSchema,
  packId: idSchema,
  qids: z
    .array(z.string().regex(/^Q\d{1,12}$/))
    .min(1)
    .max(IMPORT.maxPerImport),
});
export type ImportInput = z.infer<typeof importInputSchema>;

export interface ImportResult {
  created: number;
  /** The cards created, so that the page can say how many came out ready. */
  cardIds: string[];
  skipped: { qid: string; reason: 'ALREADY_IN_PACK' | 'NOT_ELIGIBLE' | 'UNKNOWN' }[];
}
