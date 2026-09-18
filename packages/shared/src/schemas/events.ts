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
  roomLobby: 'room:lobby',
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

// ---------------------------------------------------------------------------------------------
// Server → client payloads (phase 1: what a solo game needs). These are `z.strictObject`s on
// purpose: a field that is not declared here cannot reach a client, which is what keeps answers
// and card ids on the server.
// ---------------------------------------------------------------------------------------------

export const answerModeSchema = z.enum(['text', 'mcq']);
export type AnswerMode = z.infer<typeof answerModeSchema>;

export const phaseSchema = z.enum(['lobby', 'countdown', 'playing', 'reveal', 'ended']);

/** One zoom level of the current image, behind an opaque, short-lived URL. */
export const cropSchema = z.strictObject({
  url: z.string().min(1),
  level: z.int().min(0).max(3),
  /** Where the zoom point sits inside this crop (0..1), the origin of the zoom-out animation. */
  focus: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  /** How much wider this crop is than the previous level. `null` on the first level. */
  scaleFromPrev: z.number().positive().nullable(),
});
export type Crop = z.infer<typeof cropSchema>;

export const mcqOptionSchema = z.strictObject({ id: idSchema, label: z.string().min(1) });
export type McqOption = z.infer<typeof mcqOptionSchema>;

export const playerSchema = z.strictObject({
  id: idSchema,
  nickname: z.string(),
  score: z.int(),
  connected: z.boolean(),
});
export type Player = z.infer<typeof playerSchema>;

export const roundPrepareSchema = z.strictObject({
  roundId: idSchema,
  index: z.int().min(0),
  total: z.int().positive(),
  startsAt: z.number(),
});
export type RoundPrepare = z.infer<typeof roundPrepareSchema>;

export const roundStartSchema = z.strictObject({
  roundId: idSchema,
  index: z.int().min(0),
  total: z.int().positive(),
  startsAt: z.number(),
  endsAt: z.number(),
  /** Server times of the automatic zoom-outs. */
  levelAt: z.array(z.number()),
  answerMode: answerModeSchema,
  crop: cropSchema,
  options: z.array(mcqOptionSchema).optional(),
});
export type RoundStart = z.infer<typeof roundStartSchema>;

export const roundLevelSchema = z.strictObject({
  roundId: idSchema,
  level: z.int().min(0).max(3),
  crop: cropSchema,
  at: z.number(),
});
export type RoundLevel = z.infer<typeof roundLevelSchema>;

export const roundPlayerAnsweredSchema = z.strictObject({
  roundId: idSchema,
  playerId: idSchema,
  points: z.int(),
  order: z.int().positive(),
});
export type RoundPlayerAnswered = z.infer<typeof roundPlayerAnsweredSchema>;

export const creditSchema = z.strictObject({
  author: z.string(),
  licence: z.string(),
  sourceUrl: z.string().optional(),
});

export const revealSchema = z.strictObject({
  imageUrl: z.string().min(1),
  /** The zone that was shown first, in fractions of the image side. */
  zone: z.strictObject({ cx: z.number(), cy: z.number(), r: z.number() }),
  zoneLabel: z.string().optional(),
  answer: z.string(),
  credit: creditSchema,
});
export type Reveal = z.infer<typeof revealSchema>;

export const roundResultSchema = z.strictObject({
  playerId: idSchema,
  points: z.int(),
  elapsedMs: z.number().nullable(),
});

export const roundEndSchema = z.strictObject({
  roundId: idSchema,
  reveal: revealSchema,
  results: z.array(roundResultSchema),
  ranking: z.array(playerSchema),
  /** When the next round is prepared. `null` waits for the host (solo: the player). */
  nextAt: z.number().nullable(),
  isLast: z.boolean(),
});
export type RoundEnd = z.infer<typeof roundEndSchema>;

export const gameStartedSchema = z.strictObject({
  totalRounds: z.int().positive(),
  answerMode: answerModeSchema,
});

export const gameEndSchema = z.strictObject({
  ranking: z.array(playerSchema),
  /** Solo only. */
  personalBest: z.strictObject({ score: z.int(), isNew: z.boolean() }).optional(),
});
export type GameEnd = z.infer<typeof gameEndSchema>;

/** Full picture for a client that joins or reconnects, already stripped of every secret. */
export const roomStateSchema = z.strictObject({
  code: z.string(),
  mode: z.enum(['solo', 'private', 'public']),
  answerMode: answerModeSchema,
  phase: phaseSchema,
  hostId: idSchema,
  you: idSchema,
  players: z.array(playerSchema),
  totalRounds: z.int().positive(),
  round: z
    .strictObject({
      roundId: idSchema,
      index: z.int().min(0),
      startsAt: z.number(),
      endsAt: z.number(),
      levelAt: z.array(z.number()),
      crop: cropSchema.optional(),
      options: z.array(mcqOptionSchema).optional(),
      /** False for someone who joined mid-round: they play from the next one. */
      seated: z.boolean(),
      answered: z.boolean(),
      points: z.int().optional(),
      penalty: z.int(),
      lockedUntil: z.number().optional(),
    })
    .optional(),
  reveal: roundEndSchema.optional(),
});
export type RoomStateView = z.infer<typeof roomStateSchema>;

export const guessReplySchema = z.strictObject({
  verdict: z.enum(['correct', 'close', 'wrong', 'rate_limited']),
  points: z.int().optional(),
});
export type GuessReply = z.infer<typeof guessReplySchema>;

export const pickReplySchema = z.strictObject({
  verdict: z.enum(['correct', 'wrong']),
  points: z.int().optional(),
  lockedUntil: z.number().optional(),
  penalty: z.int().optional(),
});
export type PickReply = z.infer<typeof pickReplySchema>;

// ---- room presence (phase 2) ----

export const roomPlayerSchema = z.strictObject({ player: playerSchema });
export type RoomPlayer = z.infer<typeof roomPlayerSchema>;

export const roomPlayerLeftSchema = z.strictObject({
  playerId: idSchema,
  reason: z.enum(['left', 'kicked', 'timeout']),
  /** False when a game is running: they keep their line in the ranking, marked offline. */
  removed: z.boolean(),
});
export type RoomPlayerLeft = z.infer<typeof roomPlayerLeftSchema>;

export const roomHostChangedSchema = z.strictObject({ hostId: idSchema });

export const roomSettingsEventSchema = z.strictObject({
  rounds: z.int().positive(),
  answerMode: answerModeSchema,
});
export type RoomSettingsEvent = z.infer<typeof roomSettingsEventSchema>;

/** The host asked to play again: same players, scores back to zero. */
export const roomLobbySchema = z.strictObject({ players: z.array(playerSchema) });
