import { z } from 'zod';

/**
 * The mass import (`/api/admin/import/bulk`): a family and a number, and the worker fills
 * "catalogue étendu" packs class by class until the number is met. People and the tale
 * characters go into restricted packs, as every celebrity or character pack does.
 */

export const BULK_FAMILIES = ['nature', 'objects', 'places', 'people', 'kids'] as const;
export const bulkFamilySchema = z.enum(BULK_FAMILIES);
export type BulkFamily = z.infer<typeof bulkFamilySchema>;

export const BULK = {
  maxTarget: 10_000,
  /** Past this a pack "— 2" is opened: one switch never takes thousands of cards away. */
  packSize: 500,
  /** Image jobs waiting at once: pausing is felt within a minute. */
  pendingJobs: 5,
  /** Popularity bands (Wikipedias with an article), the best known first. */
  bands: [150, 80, 40, 25],
  pagesPerBand: 5,
  pageSize: 120,
} as const;

export const bulkStartSchema = z.strictObject({
  family: bulkFamilySchema,
  target: z.int().min(1).max(BULK.maxTarget),
});
export type BulkStartInput = z.infer<typeof bulkStartSchema>;

export const BULK_STATUSES = ['running', 'paused', 'stopped', 'done', 'failed'] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];

/** Why a subject was left out, counted per run and shown to the admin. */
export const BULK_SKIPS = [
  'DUPLICATE',
  'DUPLICATE_ANSWER',
  'GUARD_CLASS',
  'GUARD_WORD',
  'LATIN_NAME',
  'NOT_ELIGIBLE',
] as const;
export type BulkSkip = (typeof BULK_SKIPS)[number];

export interface BulkImportView {
  id: string;
  family: BulkFamily;
  target: number;
  status: BulkStatus;
  /** Cards made so far, whatever the worker did with them since. */
  created: number;
  published: number;
  /** Still with the worker, or waiting for points in the editor. */
  waiting: number;
  skipped: number;
  skipReasons: Record<string, number>;
  /** The next query: which class, which band, which page. Null before the first. */
  cursor: { className: string; band: number; page: number } | null;
  /** What went wrong along the way (a class that would not answer), kept short. */
  note: string | null;
  startedAt: string;
  updatedAt: string;
  perHour: number | null;
  minutesLeft: number | null;
}
