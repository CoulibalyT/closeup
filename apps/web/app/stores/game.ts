import {
  type AnswerMode,
  brand,
  ClientEvent,
  type Crop,
  type GameEnd,
  gameEndSchema,
  gameStartedSchema,
  type GuessReply,
  type McqOption,
  type PickReply,
  type Player,
  type RoomSettings,
  type RoomStateView,
  type RoomSummary,
  roomCreatedSchema,
  roomHostChangedSchema,
  roomLobbySchema,
  roomPlayerLeftSchema,
  roomPlayerSchema,
  roomSettingsEventSchema,
  roomSummarySchema,
  type RoundEnd,
  roundEndSchema,
  roundLevelSchema,
  roundPlayerAnsweredSchema,
  roundPrepareSchema,
  roundStartSchema,
  ServerEvent,
} from '@closeup/shared';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import { measureClock } from '~/utils/clock';

type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type Stage = 'connecting' | RoomStateView['phase'] | 'lost' | 'full' | 'kicked';
export type Feedback = 'close' | 'wrong' | 'rate_limited' | null;
export type RoomMode = RoomStateView['mode'];

interface LiveRound {
  roundId: string;
  index: number;
  startsAt: number;
  endsAt: number;
  options?: McqOption[];
}

const NICKNAME_KEY = `${brand.codename}_nickname`;
const SOLO_NICKNAME = 'Joueur';

export const useGameStore = defineStore('game', () => {
  const { apiBase } = useRuntimeConfig().public;

  const stage = ref<Stage>('connecting');
  const code = ref('');
  const mode = ref<RoomMode>('solo');
  const you = ref('');
  const hostId = ref('');
  const players = ref<Player[]>([]);
  const nickname = ref('');
  const answerMode = ref<AnswerMode>('text');
  const totalRounds = ref(0);
  const score = ref(0);
  const round = ref<LiveRound | null>(null);
  /** Crops received so far this round, one per zoom level reached. */
  const crops = ref<Crop[]>([]);
  /** False for someone who joined mid-round: they watch it and play from the next one. */
  const seated = ref(true);
  const answered = ref(false);
  /** Who found the answer this round, in order. Names only: never what they typed. */
  const answeredIds = ref<string[]>([]);
  /** Points each of them scored this round, as announced by the server. */
  const roundGains = ref<Record<string, number>>({});
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

  const isHost = computed(() => you.value !== '' && you.value === hostId.value);
  const presentCount = computed(() => players.value.filter((p) => p.connected).length);

  const serverNow = () => Date.now() + clockOffsetMs.value;
  const mediaUrl = (path: string) => apiBase + path;

  function rememberedNickname(): string {
    if (nickname.value || import.meta.server) return nickname.value;
    try {
      nickname.value = localStorage.getItem(NICKNAME_KEY) ?? '';
    } catch {
      // Private browsing may refuse storage; the nickname is then asked again, nothing breaks.
    }
    return nickname.value;
  }

  function setNickname(value: string): void {
    nickname.value = value.trim();
    try {
      localStorage.setItem(NICKNAME_KEY, nickname.value);
    } catch {
      // See rememberedNickname().
    }
  }

  const post = (path: string, body: unknown) =>
    fetch(apiBase + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Creates the guest on first call (that sets the device cookie), a no-op afterwards. */
  async function ensureGuest(): Promise<void> {
    const guest = await post('/api/identity/guest', {});
    if (!guest.ok) throw new Error('identity');
  }

  /** Guest first, then the room. Returns the room code. */
  async function createRoom(
    roomMode: 'solo' | 'private',
    settings: RoomSettings,
    language: 'fr' | 'en',
  ): Promise<string> {
    await ensureGuest();
    const room = await post('/api/rooms', {
      mode: roomMode,
      language,
      settings,
      nickname: roomMode === 'private' ? rememberedNickname() : undefined,
    });
    if (!room.ok) throw new Error('room');
    return roomCreatedSchema.parse(await room.json()).code;
  }

  /** What the join screen shows before asking for a nickname. `null`: no such room. */
  async function fetchSummary(roomCode: string): Promise<RoomSummary | null> {
    const response = await fetch(`${apiBase}/api/rooms/${roomCode}`);
    return response.ok ? roomSummarySchema.parse(await response.json()) : null;
  }

  function resetRound(): void {
    crops.value = [];
    seated.value = true;
    answered.value = false;
    answeredIds.value = [];
    roundGains.value = {};
    penalty.value = 0;
    lockedUntil.value = null;
    wrongOptionIds.value = [];
    feedback.value = null;
  }

  function upsertPlayer(player: Player): void {
    const index = players.value.findIndex((p) => p.id === player.id);
    if (index === -1) players.value.push(player);
    else players.value[index] = player;
  }

  function hydrate(view: RoomStateView): void {
    stage.value = view.phase;
    mode.value = view.mode;
    you.value = view.you;
    hostId.value = view.hostId;
    players.value = view.players;
    answerMode.value = view.answerMode;
    totalRounds.value = view.totalRounds;
    score.value = view.players.find((p) => p.id === view.you)?.score ?? 0;
    reveal.value = view.reveal ?? null;
    if (view.round) {
      const { roundId, index, startsAt, endsAt, options, crop } = view.round;
      if (round.value?.roundId !== roundId) resetRound();
      round.value = { roundId, index, startsAt, endsAt, options };
      if (crop && !crops.value.some((c) => c.level === crop.level)) crops.value.push(crop);
      seated.value = view.round.seated;
      answered.value = view.round.answered;
      scoreAtRoundStart = score.value - (view.round.points ?? 0);
      penalty.value = view.round.penalty;
      lockedUntil.value = view.round.lockedUntil ?? null;
    }
  }

  function listen(io: Socket): void {
    if (listening) return;
    listening = true;

    io.on(ServerEvent.roomPlayerJoined, (raw) => upsertPlayer(roomPlayerSchema.parse(raw).player));
    io.on(ServerEvent.roomPlayerUpdated, (raw) => upsertPlayer(roomPlayerSchema.parse(raw).player));
    io.on(ServerEvent.roomPlayerLeft, (raw) => {
      const left = roomPlayerLeftSchema.parse(raw);
      if (left.playerId === you.value && left.reason === 'kicked') {
        stage.value = 'kicked';
        io.disconnect();
        return;
      }
      // In the lobby the seat is freed; during a game they stay in the ranking, offline.
      if (left.removed) players.value = players.value.filter((p) => p.id !== left.playerId);
      else {
        const gone = players.value.find((p) => p.id === left.playerId);
        if (gone) gone.connected = false;
      }
    });
    io.on(ServerEvent.roomHostChanged, (raw) => {
      hostId.value = roomHostChangedSchema.parse(raw).hostId;
    });
    io.on(ServerEvent.roomSettings, (raw) => {
      const settings = roomSettingsEventSchema.parse(raw);
      answerMode.value = settings.answerMode;
      totalRounds.value = settings.rounds;
    });
    io.on(ServerEvent.roomLobby, (raw) => {
      players.value = roomLobbySchema.parse(raw).players;
      score.value = 0;
      foundCount.value = 0;
      round.value = null;
      reveal.value = null;
      end.value = null;
      resetRound();
      stage.value = 'lobby';
    });
    io.on(ServerEvent.gameStarted, (raw) => {
      const started = gameStartedSchema.parse(raw);
      totalRounds.value = started.totalRounds;
      answerMode.value = started.answerMode;
    });

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
    io.on(ServerEvent.roundPlayerAnswered, (raw) => {
      const found = roundPlayerAnsweredSchema.parse(raw);
      if (found.roundId !== round.value?.roundId) return;
      if (!answeredIds.value.includes(found.playerId)) answeredIds.value.push(found.playerId);
      // Shown next to the name. Totals only ever come from the server's ranking.
      roundGains.value = { ...roundGains.value, [found.playerId]: found.points };
    });
    io.on(ServerEvent.roundEnd, (raw) => {
      const payload = roundEndSchema.parse(raw);
      reveal.value = payload;
      // The server's ranking is the truth; the local running total was only for display.
      players.value = payload.ranking;
      score.value = payload.ranking.find((p) => p.id === you.value)?.score ?? score.value;
      stage.value = 'reveal';
    });
    io.on(ServerEvent.gameEnd, (raw) => {
      end.value = gameEndSchema.parse(raw);
      players.value = end.value.ranking;
      stage.value = 'ended';
    });
    // Phone locked, tunnel, server restart: on every (re)connection, ask for the whole picture.
    io.on('connect', () => void rejoin(io));
    io.on('disconnect', () => {
      if (!['ended', 'kicked', 'lost', 'full'].includes(stage.value)) stage.value = 'connecting';
    });
  }

  async function rejoin(io: Socket): Promise<void> {
    const clock = await measureClock(io).catch(() => null);
    if (clock) clockOffsetMs.value = clock.offsetMs;
    const ack: Ack<RoomStateView> = await io.timeout(5_000).emitWithAck(ClientEvent.roomJoin, {
      code: code.value,
      nickname: rememberedNickname() || SOLO_NICKNAME,
      role: 'player',
    });
    if (!ack.ok) {
      stage.value = ack.error.code === 'ROOM_FULL' ? 'full' : 'lost';
      return;
    }
    hydrate(ack.data);
    // Solo training has no lobby to wait in: it starts as soon as the player is there.
    if (ack.data.mode === 'solo' && ack.data.phase === 'lobby') {
      await io.emitWithAck(ClientEvent.gameStart);
    }
  }

  async function enter(roomCode: string): Promise<void> {
    code.value = roomCode;
    stage.value = 'connecting';
    end.value = null;
    reveal.value = null;
    round.value = null;
    players.value = [];
    foundCount.value = 0;
    resetRound();

    socket = useGameSocket();
    listen(socket);
    // The socket may predate the device cookie: reconnect so the handshake carries it.
    if (socket.connected) socket.disconnect();
    socket.connect();
  }

  const send = async <T>(event: string, payload?: unknown): Promise<Ack<T> | null> =>
    socket ? socket.timeout(8_000).emitWithAck(event, payload) : null;

  async function guess(text: string): Promise<void> {
    if (!round.value || answered.value) return;
    const ack = await send<GuessReply>(ClientEvent.roundGuess, {
      roundId: round.value.roundId,
      text,
    });
    if (!ack?.ok) return;
    if (ack.data.verdict === 'correct') won(ack.data.points ?? 0);
    else feedback.value = ack.data.verdict;
  }

  async function pick(optionId: string): Promise<void> {
    if (!round.value || answered.value) return;
    const ack = await send<PickReply>(ClientEvent.roundPick, {
      roundId: round.value.roundId,
      optionId,
    });
    if (!ack?.ok) return;
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
    if (round.value) await send(ClientEvent.revealSkip, { roundId: round.value.roundId });
  }

  /** `null` on success, otherwise the error code (for instance NOT_ENOUGH_PLAYERS). */
  async function start(): Promise<string | null> {
    const ack = await send(ClientEvent.gameStart);
    return !ack || ack.ok ? null : ack.error.code;
  }

  const updateSettings = (settings: RoomSettings) => send(ClientEvent.roomSettingsUpdate, settings);
  const kick = (playerId: string) => send(ClientEvent.roomKick, { playerId });
  const playAgain = () => send(ClientEvent.gamePlayAgain);

  /** Leaving on purpose frees the seat at once; closing the tab keeps it for 60 seconds. */
  async function leaveRoom(): Promise<void> {
    await send(ClientEvent.roomLeave).catch(() => null);
    socket?.disconnect();
  }

  function leave(): void {
    socket?.disconnect();
  }

  return {
    stage,
    code,
    mode,
    you,
    hostId,
    isHost,
    players,
    presentCount,
    nickname,
    answerMode,
    totalRounds,
    score,
    round,
    crops,
    seated,
    answered,
    answeredIds,
    roundGains,
    penalty,
    lockedUntil,
    wrongOptionIds,
    feedback,
    reveal,
    end,
    foundCount,
    serverNow,
    mediaUrl,
    rememberedNickname,
    setNickname,
    ensureGuest,
    createRoom,
    fetchSummary,
    enter,
    guess,
    pick,
    next,
    start,
    updateSettings,
    kick,
    playAgain,
    leaveRoom,
    leave,
  };
});
