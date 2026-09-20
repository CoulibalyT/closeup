import { z } from 'zod';
import { localeSchema } from './common.js';
import { PASSWORD } from './admin.js';

/**
 * Optional accounts (`/api/auth/*`, `/api/me/*`, `/api/rankings`). Playing never needs one: an
 * account only makes a player's history follow them from one device to the next.
 */

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const newPasswordSchema = z.string().min(PASSWORD.minLength).max(PASSWORD.maxLength);

export const registerSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  /** Language of the e-mails (password reset). */
  locale: localeSchema.default('fr'),
});
export type Register = z.infer<typeof registerSchema>;

export const passwordChangeSchema = z.strictObject({
  current: z.string().min(1).max(PASSWORD.maxLength),
  next: newPasswordSchema,
});

export const passwordForgotSchema = z.strictObject({ email: emailSchema });

export const passwordResetSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});

export const accountDeleteSchema = z.strictObject({
  password: z.string().min(1).max(PASSWORD.maxLength),
});

export const ACCOUNT_ERRORS = ['EMAIL_TAKEN', 'WRONG_PASSWORD', 'RESET_INVALID'] as const;
export type AccountError = (typeof ACCOUNT_ERRORS)[number];

// ---- statistics: of the player behind this device, account or not ----

export interface GameSummary {
  gameId: string;
  endedAt: string;
  mode: 'solo' | 'private' | 'public';
  score: number;
  rank: number;
  playerCount: number;
  correctCount: number;
  roundsSeated: number;
}

export interface PlayerStats {
  nickname: string;
  /** False for a guest: these numbers live on this device only. */
  hasAccount: boolean;
  games: number;
  /** Games with other people, and how many of them were won (rank 1, not alone). */
  multiplayerGames: number;
  wins: number;
  totalScore: number;
  bestScore: number;
  roundsSeated: number;
  correctCount: number;
  bestStreak: number;
  /** Average time to find, over the rounds that were found. `null` before the first one. */
  averageFoundMs: number | null;
  soloBests: { configKey: string; score: number; achievedAt: string }[];
  recent: GameSummary[];
}

// ---- rankings: accounts only, games with other people only ----

export const RANKING_PERIODS = ['week', 'all'] as const;
export const rankingPeriodSchema = z.enum(RANKING_PERIODS);
export type RankingPeriod = z.infer<typeof rankingPeriodSchema>;

export const RANKINGS = { size: 50, weekMs: 7 * 24 * 60 * 60 * 1000 } as const;

export interface RankingRow {
  rank: number;
  nickname: string;
  score: number;
  games: number;
  wins: number;
  you: boolean;
}

export interface Rankings {
  period: RankingPeriod;
  rows: RankingRow[];
  /** The viewer's own line when they have an account and are not in the top. */
  you: RankingRow | null;
}
