import { z } from 'zod';
import { BONUS_TYPES, FREE_TEXT } from '../constants/game.js';
import { idSchema, nicknameSchema, roomCodeSchema } from './common.js';

/**
 * Socket contract, namespace `/game`. Phase 0 only wires `time:ping`; the other client → server
 * payloads are declared now because they are small and stable. Server → client payloads (room
 * snapshot, round events) get their schemas with the phase that first emits them.
 */

export const ClientEvent = {
  timePing: 'time:ping',
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomSettingsUpdate: 'room:settings:update',
  roomKick: 'room:kick',
  gameStart: 'game:start',
  gamePlayAgain: 'game:playAgain',
  roundGuess: 'round:guess',
  roundPick: 'round:pick',
  bonusUse: 'bonus:use',
  revealSkip: 'reveal:skip',
  matchmakingJoin: 'mm:join',
  matchmakingLeave: 'mm:leave',
} as const;

export const ServerEvent = {
  error: 'error',
  sessionReplaced: 'session:replaced',
  roomState: 'room:state',
  roomPlayerJoined: 'room:player:joined',
  roomPlayerLeft: 'room:player:left',
  roomPlayerUpdated: 'room:player:updated',
  roomSettings: 'room:settings',
  roomHostChanged: 'room:host:changed',
  roomClosed: 'room:closed',
  gameStarted: 'game:started',
  roundPrepare: 'round:prepare',
  roundStart: 'round:start',
  roundLevel: 'round:level',
  roundPlayerAnswered: 'round:player:answered',
  roundEffect: 'round:effect',
  roundSteal: 'round:steal',
  roundBlocked: 'round:blocked',
  roundEnd: 'round:end',
  bonusGranted: 'bonus:granted',
  bonusResult: 'bonus:result',
  gameEnd: 'game:end',
  matchmakingStatus: 'mm:status',
  matchmakingMatched: 'mm:matched',
} as const;

export const handshakeAuthSchema = z.object({
  protocolVersion: z.int(),
  /** Device token for clients that cannot rely on the httpOnly cookie (future native app). */
  token: z.string().min(1).optional(),
});
export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>;

export const timePingSchema = z.object({ t0: z.number() });
export const timePongSchema = z.object({ t0: z.number(), t1: z.number() });
export type TimePing = z.infer<typeof timePingSchema>;
export type TimePong = z.infer<typeof timePongSchema>;

export const roomJoinSchema = z.object({
  code: roomCodeSchema,
  nickname: nicknameSchema,
  role: z.enum(['player', 'screen']),
});
export type RoomJoin = z.infer<typeof roomJoinSchema>;

export const roomKickSchema = z.object({ playerId: idSchema });

export const roundGuessSchema = z.object({
  roundId: idSchema,
  text: z.string().trim().min(1).max(FREE_TEXT.maxGuessLength),
});
export type RoundGuess = z.infer<typeof roundGuessSchema>;

export const roundPickSchema = z.object({ roundId: idSchema, optionId: idSchema });
export type RoundPick = z.infer<typeof roundPickSchema>;

export const bonusUseSchema = z.object({
  roundId: idSchema,
  itemId: idSchema,
  targetPlayerId: idSchema.optional(),
});
export type BonusUse = z.infer<typeof bonusUseSchema>;

export const revealSkipSchema = z.object({ roundId: idSchema });

export const matchmakingJoinSchema = z.object({ nickname: nicknameSchema });

export const bonusTypeSchema = z.enum(BONUS_TYPES);
