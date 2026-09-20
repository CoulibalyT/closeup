import { z } from 'zod';
import { idSchema } from './common.js';

/** Reports (`POST /api/reports`) and what the back-office does with them (`/api/admin/...`). */

export const REPORT_REASONS = ['nickname', 'cheating', 'harassment', 'other'] as const;
export const reportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof reportReasonSchema>;

/** A player reported from a public game. Phase 8 adds packs, cards and takedown requests. */
export const reportSchema = z.strictObject({
  targetType: z.literal('PLAYER'),
  targetId: idSchema,
  /** The room they were in: the admin needs to know a report is about a real game. */
  roomCode: z.string().min(1).max(8),
  reason: reportReasonSchema,
  message: z.string().trim().max(500).default(''),
});
export type ReportInput = z.infer<typeof reportSchema>;

export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface AdminReport {
  id: string;
  targetType: 'PLAYER' | 'PACK' | 'CARD' | 'TAKEDOWN';
  targetId: string | null;
  targetLabel: string;
  reason: string;
  message: string;
  status: ReportStatus;
  note: string | null;
  createdAt: string;
  /** How many other open reports name the same target. */
  alsoReported: number;
  /** Whether that player is banned right now, and on what. */
  banned: { user: boolean; devices: number } | null;
}

export const reportDecisionSchema = z.strictObject({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  note: z.string().trim().max(500).default(''),
});

/** The moderator's answer to a pack submitted for publication. */
export const packReviewSchema = z.strictObject({
  verdict: z.enum(['PUBLISH', 'REJECT']),
  /** Shown to the author. Saying why a pack came back is the whole point of the queue. */
  note: z.string().trim().max(500).default(''),
});

export const banSchema = z.strictObject({
  playerId: idSchema,
  reason: z.string().trim().min(1).max(200),
  /** The report this ban answers, so the two can be read together. */
  reportId: idSchema.optional(),
});

export const unbanSchema = z.strictObject({ playerId: idSchema });
