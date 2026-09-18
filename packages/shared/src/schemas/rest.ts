import { z } from 'zod';
import { idSchema, localeSchema, nicknameSchema, roomCodeSchema } from './common.js';
import { answerModeSchema } from './events.js';

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
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

/** `POST /api/rooms`. Only solo training exists so far; private rooms arrive with phase 2. */
export const createRoomSchema = z.strictObject({
  mode: z.literal('solo'),
  language: localeSchema,
  settings: roomSettingsSchema,
});
export type CreateRoom = z.infer<typeof createRoomSchema>;

export const roomCreatedSchema = z.strictObject({ code: roomCodeSchema });
export type RoomCreated = z.infer<typeof roomCreatedSchema>;
