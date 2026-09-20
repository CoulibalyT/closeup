import { z } from 'zod';
import type { ZoomPointProposal } from '../rules/face.js';
import { idSchema } from './common.js';

/**
 * Back-office contract (`/api/auth/*`, `/api/admin/*`). What comes in is validated with zod on
 * the server; what goes out is described by plain types, the admin is the only reader.
 */

export const CATEGORIES = [
  'CELEBRITY',
  'CHARACTER',
  'OBJECT',
  'ANIMAL',
  'LANDMARK',
  'FOOD',
  'VEHICLE',
  'OTHER',
] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

/** Real people and fictional characters: kept off the landing page, previews, SEO and anything paid. */
export const RESTRICTED_CATEGORIES: readonly Category[] = ['CELEBRITY', 'CHARACTER'];

export const PACK_VISIBILITIES = ['PRIVATE', 'PENDING_REVIEW', 'PUBLIC', 'DISABLED'] as const;
export const packVisibilitySchema = z.enum(PACK_VISIBILITIES);
export type PackVisibility = z.infer<typeof packVisibilitySchema>;

export const CARD_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'NEEDS_POINTS',
  'READY',
  'LIVE',
  'DISABLED',
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const UPLOAD = {
  maxBytes: 15 * 1024 * 1024,
  /** Sniffed from the bytes, never taken from the file name or the browser's word. */
  formats: ['jpeg', 'png', 'webp'],
  /** The shorter side. Below it even the widest zoom level is mush. */
  minSidePx: 600,
  /** The stored original is resized down to this: nothing downstream needs more. */
  maxSidePx: 4096,
} as const;

export const ZOOM_POINTS = { min: 2, max: 5 } as const;

export const PASSWORD = { minLength: 12, maxLength: 200 } as const;

// ---- auth ----

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(PASSWORD.maxLength),
});
export type Login = z.infer<typeof loginSchema>;

export interface SessionUser {
  id: string;
  email: string;
  role: 'PLAYER' | 'ADMIN';
}

// ---- packs ----

const shortText = z.string().trim().max(120);
const longText = z.string().trim().max(600);

export const packInputSchema = z.strictObject({
  titleFr: shortText.min(1),
  titleEn: shortText.min(1),
  descriptionFr: longText.default(''),
  descriptionEn: longText.default(''),
  category: categorySchema,
  publicMatchSafe: z.boolean().default(false),
});
export type PackInput = z.infer<typeof packInputSchema>;

/** PENDING_REVIEW belongs to player packs (phase 8); the admin moves between the other three. */
export const packVisibilityInputSchema = z.strictObject({
  visibility: z.enum(['PRIVATE', 'PUBLIC', 'DISABLED']),
});

export interface AdminPack extends PackInput {
  id: string;
  slug: string | null;
  visibility: PackVisibility;
  restricted: boolean;
  /** How many cards per status, e.g. `{ LIVE: 8, NEEDS_POINTS: 1 }`. */
  cards: Partial<Record<CardStatus, number>>;
  updatedAt: string;
}

// ---- cards ----

const answerSchema = z.strictObject({
  text: z.string().trim().max(80),
  aliases: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});

export const cardInputSchema = z.strictObject({
  category: categorySchema,
  difficulty: z.int().min(1).max(3),
  /** Authoring hint: run face landmark detection on the image. The game never reads it. */
  isPerson: z.boolean(),
  answers: z.strictObject({ fr: answerSchema, en: answerSchema }),
  credit: z.strictObject({
    author: shortText,
    licence: shortText,
    sourceUrl: z.union([z.literal(''), z.url().max(500)]),
  }),
});
export type CardInput = z.infer<typeof cardInputSchema>;

export const newCardSchema = z.strictObject({
  category: categorySchema,
  isPerson: z.boolean().default(false),
});

export const zoomPointInputSchema = z.strictObject({
  /** Pixels of the stored original. */
  x: z.number().min(0),
  y: z.number().min(0),
  baseRadius: z.number().min(4),
  labelFr: z.string().trim().max(40).default(''),
  labelEn: z.string().trim().max(40).default(''),
  weight: z.int().min(1).max(9).default(1),
  origin: z.enum(['AUTO', 'MANUAL']).default('MANUAL'),
});
export type ZoomPointInput = z.infer<typeof zoomPointInputSchema>;

/** The whole set at once: crops are cut again from it. Fewer than two is a draft, not an error. */
export const zoomPointsInputSchema = z.strictObject({
  points: z.array(zoomPointInputSchema).max(ZOOM_POINTS.max),
});

export const publishInputSchema = z.strictObject({ live: z.boolean() });

/** Why a card cannot go live. The admin shows one sentence per code. */
export const PUBLISH_BLOCKERS = [
  'NO_IMAGE',
  'PROCESSING',
  'RIGHTS_NOT_CONFIRMED',
  'CREDIT_MISSING',
  'ANSWER_FR_MISSING',
  'ANSWER_EN_MISSING',
  'TOO_FEW_POINTS',
  'CROPS_MISSING',
] as const;
export type PublishBlocker = (typeof PUBLISH_BLOCKERS)[number];

/** What the worker found on the image of a card marked as a person. */
export interface FaceDetection {
  /** `unavailable`: the detector could not run; placing points by hand always works. */
  verdict: 'ok' | 'none' | 'several' | 'small' | 'unavailable';
  faces: number;
  /** Of the face the proposals are for (the largest one), in pixels of the original. */
  eyeDistancePx: number | null;
  proposals: ZoomPointProposal[];
}

export interface AdminZoomPoint extends ZoomPointInput {
  id: string;
  /** Every zoom level has been cut. */
  cropsReady: boolean;
}

export interface AdminCard extends CardInput {
  id: string;
  packId: string;
  status: CardStatus;
  source: 'SEED' | 'UPLOAD' | 'WIKIMEDIA';
  rightsConfirmed: boolean;
  /** Size of the stored original, and a short-lived URL of its downscaled rendition. */
  image: { width: number; height: number; url: string } | null;
  zoomPoints: AdminZoomPoint[];
  detection: FaceDetection | null;
  /** Why the last image was refused, as a code (`UPLOAD_ERRORS`). */
  processingError: string | null;
  blockers: PublishBlocker[];
  updatedAt: string;
}

/** A line of the pack page: enough to find a card and see what it is waiting for. */
export interface AdminCardSummary {
  id: string;
  status: CardStatus;
  answerFr: string;
  answerEn: string;
  difficulty: number;
  points: number;
  thumbnailUrl: string | null;
  blockers: PublishBlocker[];
}

export const UPLOAD_ERRORS = [
  'TOO_LARGE',
  'UNSUPPORTED_TYPE',
  'UNREADABLE',
  'ANIMATED',
  'TOO_SMALL',
  'RIGHTS_NOT_CONFIRMED',
  /** The worker gave up (crash, lost file). Nothing about the picture itself. */
  'FAILED',
] as const;
export type UploadError = (typeof UPLOAD_ERRORS)[number];

export const cardIdParamSchema = idSchema;
