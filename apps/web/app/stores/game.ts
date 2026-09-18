import {
  type AnswerMode,
  ClientEvent,
  type Crop,
  type GameEnd,
  gameEndSchema,
  type GuessReply,
  type McqOption,
  type PickReply,
  type RoomSettings,
  type RoomStateView,
  roomCreatedSchema,
  type RoundEnd,
  roundEndSchema,
  roundLevelSchema,
  roundPrepareSchema,
  roundStartSchema,
  ServerEvent,
} from '@closeup/shared';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import { measureClock } from '~/utils/clock';

type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type Stage = 'connecting' | RoomStateView['phase'] | 'lost';
export type Feedback = 'close' | 'wrong' | 'rate_limited' | null;

interface LiveRound {
  roundId: string;
  index: number;
  startsAt: number;
  endsAt: number;
  options?: McqOption[];
}

export const useGameStore = defineStore('game', () => {
  const { apiBase } = useRuntimeConfig().public;

  const stage = ref<Stage>('connecting');
  const code = ref('');
  const you = ref('');
  const answerMode = ref<AnswerMode>('text');
  const totalRounds = ref(0);
  const score = ref(0);
  const round = ref<LiveRound | null>(null);
  /** Crops received so far this round, one per zoom level reached. */
  const crops = ref<Crop[]>([]);
  const answered = ref(false);
  const penalty = ref(0);
  const lockedUntil = ref<number | null>(null);
  const wrongOptionIds = ref<string[]>([]);
  const feedback = ref<Feedback>(null);
  const reveal = ref<RoundEnd | null>(null);
  const end = ref<GameEnd | null>(null);
  const foundCount = ref(0);
  const clockOffsetMs = ref(0);

  let socket: Socket | undefined;
  let listening = false;
  let scoreAtRoundStart = 0;

  const serverNow = () => Date.now() + clockOffsetMs.value;
  const mediaUrl = (path: string) => apiBase + path;

  const post = (path: string, body: unknown) =>
    fetch(apiBase + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Guest first (that sets the device cookie), then the room. Returns the room code. */
  async function createSolo(settings: RoomSettings, language: 'fr' | 'en'): Promise<string> {
    const guest = await post('/api/identity/guest', {});
    if (!guest.ok) throw new Error('identity');
    const room = await post('/api/rooms', { mode: 'solo', language, settings });
    if (!room.ok) throw new Error('room');
    return roomCreatedSchema.parse(await room.json()).code;
  }

  function resetRound(): void {
    crops.value = [];
    answered.value = false;
    penalty.value = 0;
    lockedUntil.value = null;
    wrongOptionIds.value = [];
    feedback.value = null;
  }

  function hydrate(view: RoomStateView): void {
    stage.value = view.phase;
    you.value = view.you;
    answerMode.value = view.answerMode;
    totalRounds.value = view.totalRounds;
    score.value = view.players.find((p) => p.id === view.you)?.score ?? 0;
    reveal.value = view.reveal ?? null;
    if (view.round) {
      const { roundId, index, startsAt, endsAt, options, crop } = view.round;
      if (round.value?.roundId !== roundId) resetRound();
      round.value = { roundId, index, startsAt, endsAt, options };
      if (crop && !crops.value.some((c) => c.level === crop.level)) crops.value.push(crop);
      answered.value = view.round.answered;
      scoreAtRoundStart = score.value - (view.round.points ?? 0);
      penalty.value = view.round.penalty;
      lockedUntil.value = view.round.lockedUntil ?? null;
    }
  }

  function listen(io: Socket): void {
    if (listening) return;
    listening = true;

    io.on(ServerEvent.roundPrepare, (raw) => {
      const payload = roundPrepareSchema.parse(raw);
      resetRound();
      scoreAtRoundStart = score.value;
      reveal.value = null;
      round.value = { ...payload, endsAt: payload.startsAt };
      stage.value = 'countdown';
    });
    io.on(ServerEvent.roundStart, (raw) => {
      const payload = roundStartSchema.parse(raw);
      round.value = { ...payload };
      crops.value = [payload.crop];
      stage.value = 'playing';
    });
    io.on(ServerEvent.roundLevel, (raw) => {
      const payload = roundLevelSchema.parse(raw);
      if (payload.roundId !== round.value?.roundId) return;
      if (!crops.value.some((c) => c.level === payload.level)) crops.value.push(payload.crop);
    });
    io.on(ServerEvent.roundEnd, (raw) => {
      const payload = roundEndSchema.parse(raw);
      reveal.value = payload;
      // The server's ranking is the truth; the local running total was only for display.
      score.value = payload.ranking.find((p) => p.id === you.value)?.score ?? score.value;
      stage.value = 'reveal';
    });
    io.on(ServerEvent.gameEnd, (raw) => {
      end.value = gameEndSchema.parse(raw);
      stage.value = 'ended';
    });
    // Phone locked, tunnel, server restart: on every (re)connection, ask for the whole picture.
    io.on('connect', () => void rejoin(io));
    io.on('disconnect', () => {
      if (stage.value !== 'ended') stage.value = 'connecting';
    });
  }

  async function rejoin(io: Socket): Promise<void> {
    const clock = await measureClock(io).catch(() => null);
    if (clock) clockOffsetMs.value = clock.offsetMs;
    const ack: Ack<RoomStateView> = await io
      .timeout(5_000)
      .emitWithAck(ClientEvent.roomJoin, { code: code.value, nickname: 'Solo', role: 'player' });
    if (!ack.ok) {
      stage.value = 'lost';
      return;
    }
    hydrate(ack.data);
    if (ack.data.phase === 'lobby' && ack.data.hostId === ack.data.you) {
      await io.emitWithAck(ClientEvent.gameStart);
    }
  }

  async function enter(roomCode: string): Promise<void> {
    code.value = roomCode;
    stage.value = 'connecting';
    end.value = null;
    reveal.value = null;
    round.value = null;
    foundCount.value = 0;
    resetRound();

    socket = useGameSocket();
    listen(socket);
    // The socket may predate the device cookie: reconnect so the handshake carries it.
    if (socket.connected) socket.disconnect();
    socket.connect();
  }

  async function guess(text: string): Promise<void> {
    if (!socket || !round.value || answered.value) return;
    const ack: Ack<GuessReply> = await socket.emitWithAck(ClientEvent.roundGuess, {
      roundId: round.value.roundId,
      text,
    });
    if (!ack.ok) return;
    if (ack.data.verdict === 'correct') won(ack.data.points ?? 0);
    else feedback.value = ack.data.verdict;
  }

  async function pick(optionId: string): Promise<void> {
    if (!socket || !round.value || answered.value) return;
    const ack: Ack<PickReply> = await socket.emitWithAck(ClientEvent.roundPick, {
      roundId: round.value.roundId,
      optionId,
    });
    if (!ack.ok) return;
    if (ack.data.verdict === 'correct') return won(ack.data.points ?? 0);
    wrongOptionIds.value.push(optionId);
    penalty.value = ack.data.penalty ?? penalty.value;
    lockedUntil.value = ack.data.lockedUntil ?? null;
    feedback.value = 'wrong';
  }

  /**
   * Set, never add: the server broadcasts `round:end` (with the official ranking) *before* it
   * acknowledges the answer, so an increment here would count the points twice.
   */
  function won(points: number): void {
    answered.value = true;
    feedback.value = null;
    score.value = scoreAtRoundStart + points;
    foundCount.value += 1;
  }

  async function next(): Promise<void> {
    if (!socket || !round.value) return;
    await socket.emitWithAck(ClientEvent.revealSkip, { roundId: round.value.roundId });
  }

  function leave(): void {
    socket?.disconnect();
  }

  return {
    stage,
    code,
    you,
    answerMode,
    totalRounds,
    score,
    round,
    crops,
    answered,
    penalty,
    lockedUntil,
    wrongOptionIds,
    feedback,
    reveal,
    end,
    foundCount,
    serverNow,
    mediaUrl,
    createSolo,
    enter,
    guess,
    pick,
    next,
    leave,
  };
});
