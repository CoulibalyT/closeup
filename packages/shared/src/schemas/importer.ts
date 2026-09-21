import { z } from 'zod';
import { type Category } from './admin.js';
import { idSchema } from './common.js';

/**
 * Back-office contract of the Wikidata + Commons importer (`/api/admin/import/*`). The importer
 * proposes, the admin picks: nothing is imported unseen, and nothing imported plays before it
 * has been through the card editor for its zoom points.
 */

/**
 * What can be searched. Each is a small, targeted Wikidata query sorted by popularity (the
 * number of Wikipedias with an article). None of them brings people: real people's faces are a
 * decision still to be taken, and the queries exclude humans outright.
 */
export const IMPORT_PRESETS = [
  'animals',
  'fruits',
  'dishes',
  'instruments',
  'tools',
  'vehicles',
  'heritage',
] as const;
export const importPresetSchema = z.enum(IMPORT_PRESETS);
export type ImportPreset = z.infer<typeof importPresetSchema>;

export const IMPORT_PRESET_CATEGORY: Record<ImportPreset, Category> = {
  animals: 'ANIMAL',
  fruits: 'FOOD',
  dishes: 'FOOD',
  instruments: 'OBJECT',
  tools: 'OBJECT',
  vehicles: 'VEHICLE',
  heritage: 'LANDMARK',
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
}

export type ImportSearchState = 'running' | 'done' | 'failed';

export interface ImportSearch {
  preset: ImportPreset;
  state: ImportSearchState;
  startedAt: string;
  finishedAt: string | null;
  candidates: ImportCandidate[];
}

export const importSearchInputSchema = z.strictObject({ preset: importPresetSchema });

export const importInputSchema = z.strictObject({
  preset: importPresetSchema,
  packId: idSchema,
  qids: z
    .array(z.string().regex(/^Q\d{1,12}$/))
    .min(1)
    .max(IMPORT.maxPerImport),
});
export type ImportInput = z.infer<typeof importInputSchema>;

export interface ImportResult {
  created: number;
  skipped: { qid: string; reason: 'ALREADY_IN_PACK' | 'NOT_ELIGIBLE' | 'UNKNOWN' }[];
}
