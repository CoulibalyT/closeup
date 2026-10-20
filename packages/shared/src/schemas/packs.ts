import { z } from 'zod';
import {
  categorySchema,
  packAudienceSchema,
  type Category,
  type CardStatus,
  type PackAudience,
  type PackVisibility,
} from './admin.js';
import { idSchema, localeSchema } from './common.js';

/**
 * Packs made by players: their own (`/api/me/packs`), the public catalogue (`/api/packs`) and
 * the credits every published pack owes its images.
 */

export const QUOTA = {
  /** Per account. A pack is cheap; what costs is the images inside it. */
  packs: 10,
  cardsPerPack: 40,
  /** Rolling 24 hours, counted on uploads that reached the worker. */
  uploadsPerDay: 30,
} as const;

export const packDraftSchema = z.strictObject({
  titleFr: z.string().trim().min(1).max(120),
  titleEn: z.string().trim().min(1).max(120),
  descriptionFr: z.string().trim().max(600).default(''),
  descriptionEn: z.string().trim().max(600).default(''),
  category: categorySchema,
  audience: packAudienceSchema.default('FAMILY'),
});
export type PackDraft = z.infer<typeof packDraftSchema>;

/** Sent with a pack when its author asks for it to be published. */
export const packSubmitSchema = z.strictObject({
  /** They confirm again, for the pack as a whole, what each upload already asked. */
  rightsConfirmed: z.literal(true),
});

/** A pack as its author sees it. */
export interface MyPack extends PackDraft {
  id: string;
  visibility: PackVisibility;
  /** Only the owner sees why their pack came back. */
  reviewNote: string | null;
  submittedAt: string | null;
  /** False: private for good, unless the admin confirms the rights. */
  publishable: boolean;
  cards: Partial<Record<CardStatus, number>>;
  playableCards: number;
  updatedAt: string;
}

export interface MyQuota {
  packs: { used: number; max: number };
  uploadsToday: { used: number; max: number };
}

// ---- the public catalogue ----

export const CATALOGUE_SORTS = ['recent', 'name'] as const;
export const catalogueQuerySchema = z.strictObject({
  category: categorySchema.optional(),
  sort: z.enum(CATALOGUE_SORTS).default('recent'),
});

/** One line of the catalogue. Restricted packs are never listed, only reached by their link. */
export interface CataloguePack {
  id: string;
  title: string;
  description: string;
  category: Category;
  audience: PackAudience;
  cards: number;
  /** Made by a player, as opposed to the house's own packs. */
  byPlayer: boolean;
  authorNickname: string | null;
  /** May be drawn in public games between strangers. */
  publicMatchSafe: boolean;
  restricted: boolean;
  /** A crop of one of its cards, as a taste. Absent while nothing is playable. */
  coverUrl: string | null;
}

export interface PackCredits {
  id: string;
  title: string;
  description: string;
  authorNickname: string | null;
  restricted: boolean;
  cards: {
    answer: string;
    author: string;
    licence: string;
    sourceUrl: string | null;
  }[];
}

/** What a room may be told to play. Empty: every public pack, as before. */
export const packChoiceSchema = z.array(idSchema).max(20);

// ---- takedown ----

export const takedownSchema = z.strictObject({
  /** The address of the pack or card page, or a plain description of the image. */
  about: z.string().trim().min(3).max(500),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  message: z.string().trim().min(10).max(2000),
  locale: localeSchema.default('fr'),
});
export type Takedown = z.infer<typeof takedownSchema>;

/** Reporting a pack or a card of the public catalogue. */
export const contentReportSchema = z.strictObject({
  targetType: z.enum(['PACK', 'CARD']),
  targetId: idSchema,
  reason: z.enum(['rights', 'inappropriate', 'wrong_answer', 'bad_zoom', 'other']),
  message: z.string().trim().max(500).default(''),
});
export type ContentReport = z.infer<typeof contentReportSchema>;
