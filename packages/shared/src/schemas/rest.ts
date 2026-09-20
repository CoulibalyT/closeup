import { z } from 'zod';
import { DISPLAY_MODES, SCORING_MODES } from '../constants/game.js';
import { packChoiceSchema } from './packs.js';
import { idSchema, localeSchema, nicknameSchema, roomCodeSchema } from './common.js';
import { answerModeSchema, phaseSchema } from './events.js';

const dependencySchema = z.looseObject({ status: z.enum(['up', 'down']) });

/** `GET /api/health/ready` — same body on 200 and 503. */
export const readinessSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  details: z.record(z.string(), dependencySchema),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** `GET /api/health/worker` — a `ping` job went through the queue and back. */
export const workerHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
});
export type WorkerHealth = z.infer<typeof workerHealthSchema>;

/** `POST /api/identity/guest` — creates the guest on first call, returns them afterwards. */
export const guestRequestSchema = z.object({ nickname: nicknameSchema.optional() });
export type GuestRequest = z.infer<typeof guestRequestSchema>;

export const identitySchema = z.strictObject({ playerId: idSchema, nickname: z.string() });
export type IdentityView = z.infer<typeof identitySchema>;

export const roomSettingsSchema = z.strictObject({
  rounds: z.int().min(1).max(20),
  answerMode: answerModeSchema,
  /** `decay`: 1000 down to 200 over the round. `fixed`: paid by order of arrival, no clock. */
  scoring: z.enum(SCORING_MODES).default('decay'),
  /** The host may still change it in the lobby, like the rest. */
  display: z.enum(DISPLAY_MODES).default('phones'),
  /**
   * Which packs to draw from. Empty: every public pack, as before. A host may also pick their
   * own packs, published or not; the server checks that they are theirs.
   */
  packIds: packChoiceSchema.default([]),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

/** `POST /api/rooms`. The nickname is asked when creating or joining a room with other people. */
export const createRoomSchema = z
  .strictObject({
    mode: z.enum(['solo', 'private']),
    language: localeSchema,
    settings: roomSettingsSchema,
    nickname: nicknameSchema.optional(),
    /**
     * `screen`: the device creating the room is the shared screen, not a player. The room has no
     * host until the first phone joins, and that player becomes the host.
     */
    openedBy: z.enum(['player', 'screen']).default('player'),
  })
  .refine(
    (room) => room.mode === 'solo' || room.openedBy === 'screen' || room.nickname !== undefined,
    { path: ['nickname'], message: 'A nickname is required to play with other people' },
  )
  .refine((room) => room.openedBy === 'player' || room.mode === 'private', {
    path: ['openedBy'],
    message: 'Only a room for several players can be opened from a shared screen',
  });
export type CreateRoom = z.infer<typeof createRoomSchema>;

/** `GET /api/rooms/:code` — what anyone holding the code may see before joining. */
export const roomSummarySchema = z.strictObject({
  code: roomCodeSchema,
  phase: phaseSchema,
  /** Empty while a room opened from a big screen waits for its first player. */
  hostNickname: z.string(),
  display: z.enum(DISPLAY_MODES),
  playerCount: z.int().min(0),
  maxPlayers: z.int().positive(),
  rounds: z.int().positive(),
  answerMode: answerModeSchema,
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const roomCreatedSchema = z.strictObject({ code: roomCodeSchema });
export type RoomCreated = z.infer<typeof roomCreatedSchema>;
