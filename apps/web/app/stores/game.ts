import {
  type AnswerMode,
  bonusGrantedSchema,
  type BonusItem,
  type BonusType,
  type BonusUseReply,
  brand,
  ClientEvent,
  dealableBonuses,
  type DisplayMode,
  type Hints,
  type Malus,
  matchmakingMatchedSchema,
  type MatchmakingStatus,
  matchmakingStatusSchema,
  roundBlockedSchema,
  roundEffectSchema,
  roundStealSchema,
  type ScoringMode,
  type CataloguePack,
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
  roomScreensSchema,
  roomSettingsEventSchema,
  roomSummarySchema,
  type RoundEnd,
  roundEndSchema,
  roundLevelSchema,
  roundHintSchema,
  type RoundHint,
  roundPlayerAnsweredSchema,
  roundPrepareSchema,
  roundStartSchema,
  ServerEvent,
  DEFAULT_DIFFICULTY,
  DEFAULT_ROUND_SECONDS,
  type Difficulty,
  type RoundSeconds,
} from '@closeup/shared';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import { measureClock } from '~/utils/clock';

type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type Stage = 'connecting' | RoomStateView['phase'] | 'lost' | 'full' | 'kicked';
export type Feedback = 'close' | 'wrong' | 'rate_limited' | null;
export type RoomMode = RoomStateView['mode'];
export type Role = RoomStateView['role'];

/** An announcement for the event feed. Ids are player ids; the component resolves names. */
export interface FeedEntry {
  id: number;
  kind: 'malus' | 'stealBonus' | 'stealPoints' | 'stolenPoints' | 'blocked' | 'granted' | 'partial';
  from?: string;
  to?: string;
  bonus?: BonusType;
  amount?: number;
  reason?: string;
}

interface LiveRound {
  roundId: string;
  index: number;
  startsAt: number;
  /** `null` without a clock. */
  endsAt: number | null;
  options?: McqOption[];
}

const NICKNAME_KEY = `${brand.codename}_nickname`;
const SOLO_NICKNAME = 'Joueur';

export const useGameStore = defineStore('game', () => {
  const { apiBase } = useRuntimeConfig().public;

  const stage = ref<Stage>('connecting');
  const code = ref('');
  const mode = ref<RoomMode>('solo');
  /** `screen`: this device is the shared screen of a big-screen room. It watches, it never plays. */
  const role = ref<Role>('player');
  /** `bigscreen`: the image is on the shared screen and this phone is a controller. */
  const display = ref<DisplayMode>('phones');
  /** How many shared screens the room has right now. */
  const screens = ref(0);
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
  const scoring = ref<ScoringMode>('decay');
  /** Length of a round in seconds, `null` without a clock. */
  const roundSeconds = ref<RoundSeconds | null>(DEFAULT_ROUND_SECONDS);
  /** The room setting: a hint for everyone when nobody found late in the round. */
  const hintsOn = ref(true);
  const difficulty = ref<Difficulty>(DEFAULT_DIFFICULTY);
  /** The room's hint, once shown this round. */
  const roundHint = ref<RoundHint | null>(null);
  /** Who answered with a partial answer this round (a film of the person…). */
  const partialIds = ref<string[]>([]);
  /** The viewer's own answer was a partial one, worth this many points. */
  const partialPoints = ref<number | null>(null);
  /** Packs the host picked. Empty: every public pack. */
  const packIds = ref<string[]>([]);
  /** The viewer's own bonuses. Other players only ever show a count. */
  const inventory = ref<BonusItem[]>([]);
  const shielded = ref(false);
  /** What the viewer's self bonuses revealed this round. */
  const hints = ref<Hints>({ removedOptionIds: [] });
  /** The malus currently hitting the viewer. */
  const effect = ref<{ type: Malus; from: string; until: number } | null>(null);
  /** Who did what to whom: the last few announcements, newest last. */
  const feed = ref<FeedEntry[]>([]);
  const penalty = ref(0);
  const lockedUntil = ref<number | null>(null);
  const wrongOptionIds = ref<string[]>([]);
  /** The option this phone picked and got right, and what its answer earned this round. */
  const pickedOptionId = ref<string | null>(null);
  const myRoundPoints = ref<number | null>(null);
  const feedback = ref<Feedback>(null);
  const reveal = ref<RoundEnd | null>(null);
  const end = ref<GameEnd | null>(null);
  const foundCount = ref(0);
  const clockOffsetMs = ref(0);
  /** The public queue: how many are waiting, and the code once a room is found. */
  const queue = ref<MatchmakingStatus | null>(null);
  const matchedCode = ref('');

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

  /**
   * Guest first, then the room. Returns the room code. `openedBy: 'screen'` opens a big-screen
   * room from the screen itself: this device will not play, the first phone to join is the host.
   */
  async function createRoom(
    roomMode: 'solo' | 'private',
    settings: RoomSettings,
    language: 'fr' | 'en',
    openedBy: Role = 'player',
  ): Promise<string> {
    await ensureGuest();
    const asPlayer = roomMode === 'private' && openedBy === 'player';
    const room = await post('/api/rooms', {
      mode: roomMode,
      language,
      settings,
      openedBy,
      nickname: asPlayer ? rememberedNickname() : undefined,
    });
    if (!room.ok) throw new Error('room');
    return roomCreatedSchema.parse(await room.json()).code;
  }

  /** What a room may be told to play: the catalogue, plus the host's own packs. */
  async function playablePacks(): Promise<CataloguePack[]> {
    const response = await fetch(`${apiBase}/api/playable-packs`, { credentials: 'include' });
    if (!response.ok) throw new Error('packs');
    return (await response.json()) as CataloguePack[];
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
    hints.value = { removedOptionIds: [] };
    effect.value = null;
    penalty.value = 0;
    lockedUntil.value = null;
    wrongOptionIds.value = [];
    pickedOptionId.value = null;
    myRoundPoints.value = null;
    feedback.value = null;
    roundHint.value = null;
    partialIds.value = [];
    partialPoints.value = null;
  }

  /**
   * Kept sorted: the lens shows the widest view received. A zoom-out bonus puts the player a
   * level ahead, and the room's own (narrower) level still arrives afterwards.
   */
  function addCrop(crop: Crop): void {
    if (crops.value.some((c) => c.level === crop.level)) return;
    crops.value = [...crops.value, crop].sort((a, b) => a.level - b.level);
  }

  let feedId = 0;
  function announce(entry: Omit<FeedEntry, 'id'>): void {
    feed.value = [...feed.value, { ...entry, id: ++feedId }].slice(-4);
  }

  function upsertPlayer(player: Player): void {
    const index = players.value.findIndex((p) => p.id === player.id);
    if (index === -1) players.value.push(player);
    else players.value[index] = player;
  }

  function hydrate(view: RoomStateView): void {
    stage.value = view.phase;
    mode.value = view.mode;
    role.value = view.role;
    display.value = view.display;
    screens.value = view.screens;
    you.value = view.you ?? '';
    hostId.value = view.hostId ?? '';
    players.value = view.players;
    answerMode.value = view.answerMode;
    scoring.value = view.scoring;
    roundSeconds.value = view.roundSeconds as RoundSeconds | null;
    hintsOn.value = view.hints;
    difficulty.value = view.difficulty;
    inventory.value = view.inventory;
    shielded.value = view.shielded;
    totalRounds.value = view.totalRounds;
    score.value = view.players.find((p) => p.id === view.you)?.score ?? 0;
    reveal.value = view.reveal ?? null;
    if (view.round) {
      const { roundId, index, startsAt, endsAt, options, crop } = view.round;
      if (round.value?.roundId !== roundId) resetRound();
      round.value = { roundId, index, startsAt, endsAt, options };
      if (crop) addCrop(crop);
      answeredIds.value = view.round.foundIds;
      hints.value = view.round.hints;
      effect.value = view.round.effect ?? null;
      seated.value = view.round.seated;
      answered.value = view.round.answered;
      roundHint.value = view.round.hint ?? null;
      partialPoints.value = view.round.partial ? (view.round.points ?? 0) : null;
      // A phone that reloads after answering still shows what its answer earned.
      myRoundPoints.value = view.round.answered ? (view.round.points ?? null) : null;
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
      scoring.value = settings.scoring;
      roundSeconds.value = settings.roundSeconds as RoundSeconds | null;
      hintsOn.value = settings.hints;
      difficulty.value = settings.difficulty;
      display.value = settings.display;
      packIds.value = settings.packIds;
      totalRounds.value = settings.rounds;
    });
    io.on(ServerEvent.roomScreens, (raw) => {
      screens.value = roomScreensSchema.parse(raw).count;
    });
    // Everyone left, or nobody ever came. A shared screen offers to open another room.
    io.on(ServerEvent.roomClosed, () => {
      stage.value = 'lost';
      io.disconnect();
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
      display.value = started.display;
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
      // No crop on a phone in big-screen mode: the image is on the shared screen.
      crops.value = payload.crop ? [payload.crop] : [];
      stage.value = 'playing';
    });
    io.on(ServerEvent.roundHint, (raw) => {
      roundHint.value = roundHintSchema.parse(raw);
    });
    io.on(ServerEvent.roundLevel, (raw) => {
      const payload = roundLevelSchema.parse(raw);
      if (payload.roundId !== round.value?.roundId) return;
      if (payload.crop) addCrop(payload.crop);
    });

    // Private: only the owner hears what they were given.
    io.on(ServerEvent.bonusGranted, (raw) => {
      const { item, reason } = bonusGrantedSchema.parse(raw);
      if (reason === 'swap') {
        // A bonus this room does not deal was swapped for this one, at the start of the game.
        const dealt = dealableBonuses({
          mode: mode.value,
          answerMode: answerMode.value,
          display: display.value,
        });
        inventory.value = inventory.value.filter((owned) => dealt.includes(owned.type));
      }
      if (!inventory.value.some((owned) => owned.id === item.id)) {
        inventory.value = [...inventory.value, item];
      }
      if (reason !== 'stolen' && reason !== 'swap') {
        announce({ kind: 'granted', bonus: item.type, reason });
      }
    });
    // Public: everyone sees who did what to whom. That is the fun part.
    io.on(ServerEvent.roundEffect, (raw) => {
      const malus = roundEffectSchema.parse(raw);
      if (malus.to === you.value) effect.value = malus;
      announce({ kind: 'malus', from: malus.from, to: malus.to, bonus: malus.type });
    });
    io.on(ServerEvent.roundSteal, (raw) => {
      const steal = roundStealSchema.parse(raw);
      const { from, to, amount, bonusType } = steal;
      if (steal.kind === 'bonus') {
        if (to === you.value && bonusType) {
          const index = inventory.value.findIndex((owned) => owned.type === bonusType);
          if (index !== -1) inventory.value = inventory.value.filter((_, i) => i !== index);
        }
        announce({ kind: 'stealBonus', from, to, bonus: bonusType });
      } else if (amount === undefined) announce({ kind: 'stealPoints', from, to });
      else {
        // The thief's own total moves now, like the ranking does; still set again at round end.
        if (from === you.value) {
          score.value += amount;
          scoreAtRoundStart += amount;
        }
        announce({ kind: 'stolenPoints', from, to, amount });
      }
    });
    io.on(ServerEvent.roundBlocked, (raw) => {
      const blocked = roundBlockedSchema.parse(raw);
      if (blocked.to === you.value) shielded.value = false;
      announce({ kind: 'blocked', from: blocked.from, to: blocked.to, bonus: blocked.what });
    });
    io.on(ServerEvent.roundPlayerAnswered, (raw) => {
      const found = roundPlayerAnsweredSchema.parse(raw);
      if (found.roundId !== round.value?.roundId) return;
      if (found.partial) {
        // A partial answer takes no rank: it does not count among those who found.
        if (!partialIds.value.includes(found.playerId)) partialIds.value.push(found.playerId);
        announce({ kind: 'partial', from: found.playerId, amount: found.points });
      } else if (!answeredIds.value.includes(found.playerId)) {
        answeredIds.value.push(found.playerId);
      }
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
    io.on(ServerEvent.matchmakingStatus, (raw) => {
      queue.value = matchmakingStatusSchema.parse(raw);
    });
    io.on(ServerEvent.matchmakingMatched, (raw) => {
      matchedCode.value = matchmakingMatchedSchema.parse(raw).code;
      queue.value = null;
    });
    // Phone locked, tunnel, server restart: on every (re)connection, ask for the whole picture.
    io.on('connect', () => void rejoin(io));
    io.on('disconnect', () => {
      if (!['ended', 'kicked', 'lost', 'full'].includes(stage.value)) stage.value = 'connecting';
    });
  }

  /**
   * The public queue lives on the socket, not on a room: waiting is this connection waiting.
   * `null` on success, otherwise the error code (NICKNAME_REJECTED and why, in the message).
   */
  async function joinQueue(wanted: string, language: 'fr' | 'en'): Promise<string | null> {
    setNickname(wanted);
    matchedCode.value = '';
    socket = useGameSocket();
    listen(socket);
    if (!socket.connected) {
      socket.connect();
      await new Promise<void>((resolve) => socket!.once('connect', () => resolve()));
    }
    const ack = await send(ClientEvent.matchmakingJoin, { nickname: wanted, language });
    if (!ack) return 'INTERNAL';
    if (!ack.ok) return ack.error.message || ack.error.code;
    queue.value = { waiting: 1, startsAt: null };
    return null;
  }

  async function leaveQueue(): Promise<void> {
    await send(ClientEvent.matchmakingLeave).catch(() => null);
    queue.value = null;
    socket?.disconnect();
  }

  /** Reporting somebody from a public game. `true` when the report was taken. */
  async function report(targetId: string, reason: string, message: string): Promise<boolean> {
    const response = await post('/api/reports', {
      targetType: 'PLAYER',
      targetId,
      roomCode: code.value,
      reason,
      message,
    });
    return response.ok;
  }

  async function rejoin(io: Socket): Promise<void> {
    const clock = await measureClock(io).catch(() => null);
    if (clock) clockOffsetMs.value = clock.offsetMs;
    const ack: Ack<RoomStateView> = await io
      .timeout(5_000)
      .emitWithAck(
        ClientEvent.roomJoin,
        role.value === 'screen'
          ? { code: code.value, role: 'screen' }
          : { code: code.value, nickname: rememberedNickname() || SOLO_NICKNAME, role: 'player' },
      );
    if (!ack.ok) {
      stage.value = ack.error.code === 'ROOM_FULL' ? 'full' : 'lost';
      return;
    }
    hydrate(ack.data);
  }

  async function enter(roomCode: string, as: Role = 'player'): Promise<void> {
    code.value = roomCode;
    role.value = as;
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
    else if (ack.data.verdict === 'partial') {
      won(ack.data.points ?? 0, false);
      partialPoints.value = ack.data.points ?? 0;
    } else feedback.value = ack.data.verdict;
  }

  async function pick(optionId: string): Promise<void> {
    if (!round.value || answered.value) return;
    const ack = await send<PickReply>(ClientEvent.roundPick, {
      roundId: round.value.roundId,
      optionId,
    });
    if (!ack?.ok) return;
    if (ack.data.verdict === 'correct') {
      pickedOptionId.value = optionId;
      return won(ack.data.points ?? 0);
    }
    wrongOptionIds.value.push(optionId);
    penalty.value = ack.data.penalty ?? penalty.value;
    lockedUntil.value = ack.data.lockedUntil ?? null;
    feedback.value = 'wrong';
  }

  /**
   * Set, never add: the server broadcasts `round:end` (with the official ranking) *before* it
   * acknowledges the answer, so an increment here would count the points twice.
   */
  function won(points: number, found = true): void {
    answered.value = true;
    feedback.value = null;
    myRoundPoints.value = points;
    score.value = scoreAtRoundStart + points;
    if (found) foundCount.value += 1;
  }

  /** `null` on success, otherwise the error code (TARGET_BUSY, TARGET_INVALID, BAD_PHASE…). */
  async function useBonus(itemId: string, targetPlayerId?: string): Promise<string | null> {
    if (!round.value) return 'BAD_PHASE';
    const ack = await send<BonusUseReply>(ClientEvent.bonusUse, {
      roundId: round.value.roundId,
      itemId,
      targetPlayerId,
    });
    if (!ack) return 'INTERNAL';
    if (!ack.ok) return ack.error.code;
    inventory.value = ack.data.inventory;
    penalty.value = ack.data.penalty;
    shielded.value = ack.data.shielded;
    hints.value = ack.data.hints;
    return null;
  }

  /** "Gros plan raté": tells the admin the close-ups of the round just played were unplayable. */
  async function reportZoom(roundId: string): Promise<boolean> {
    const ack = await send(ClientEvent.roundReport, { roundId });
    return Boolean(ack?.ok);
  }

  /** A round without a clock ends when the host says so (solo: when the player gives up). */
  async function skipRound(): Promise<void> {
    if (round.value) await send(ClientEvent.roundSkip, { roundId: round.value.roundId });
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
  const makeHost = (playerId: string) => send(ClientEvent.roomHostTransfer, { playerId });
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
    role,
    display,
    screens,
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
    scoring,
    roundSeconds,
    skipRound,
    reportZoom,
    hintsOn,
    difficulty,
    roundHint,
    partialIds,
    partialPoints,
    packIds,
    playablePacks,
    inventory,
    shielded,
    hints,
    effect,
    feed,
    useBonus,
    penalty,
    lockedUntil,
    wrongOptionIds,
    pickedOptionId,
    myRoundPoints,
    feedback,
    reveal,
    end,
    foundCount,
    queue,
    matchedCode,
    joinQueue,
    leaveQueue,
    report,
    apiBase,
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
    makeHost,
    playAgain,
    leaveRoom,
    leave,
  };
});
