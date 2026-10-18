/**
 * Every tunable number of the game lives here so that the API and the web app read the same values.
 * The API is the only authority; the web app uses these for display (timer ring, live round value).
 */

export const ROUND = {
  durationMs: 30_000,
  countdownMs: 3_000,
  /** Multiplayer reveal auto-advances after this; the host can skip, solo waits for the player. */
  revealMs: 8_000,
  /** Delay between the last connected player answering and the early reveal. */
  earlyEndGraceMs: 1_500,
} as const;

/** The lengths a host can choose for a round, in seconds; or none (`null`, "Sans chrono"). */
export const ROUND_SECONDS = [30, 45, 60, 90] as const;
export type RoundSeconds = (typeof ROUND_SECONDS)[number];
/** Rooms a host makes: long enough for a table to think. Public matchmaking keeps 30. */
export const DEFAULT_ROUND_SECONDS: RoundSeconds = 60;

/** A round without a clock: zoom and hint on a fixed schedule, points still reward speed. */
export const UNTIMED = {
  levelAtMs: [0, 15_000, 30_000, 45_000],
  hintAtMs: 30_000,
  /** The value goes from 1000 to 200 over this, then stays at 200. */
  decayMs: 90_000,
  safetyMs: 600_000,
} as const;

export const ZOOM = {
  /**
   * Crop side = 2 × baseRadius × multiplier. For people baseRadius is half the distance between
   * the eyes, which reproduces the prototype's 0.75 / 1.35 / 2.4 / 4.2 × eye distance.
   */
  levelMultipliers: [0.75, 1.35, 2.4, 4.2],
  /** Elapsed time at which each automatic level starts (a 30-second round, in quarters). */
  autoLevelAtMs: [0, 7_500, 15_000, 22_500],
  maxLevel: 3,
  /** Below this eye distance the first level is too blurry: the pipeline warns. */
  minEyeDistancePx: 70,
  cropSizesPx: [640, 1280],
} as const;

export const SCORING = {
  startValue: 1000,
  endValue: 200,
  step: 10,
  /** Penalties (bonus costs, wrong picks) never push a round below this. */
  floorValue: 100,
  /**
   * "Fixed points" rooms ignore the clock: what counts is the order in which players find.
   * First, second, third; the last value is for everyone after that.
   */
  fixedByRank: [1000, 800, 600, 500],
} as const;

/** The hint shown to the room when nobody found: an answer after it is worth `cost` less. */
export const HINT = { cost: 150 } as const;
/** A partial answer (a film, a club, a song of the person) is worth this share of a full one. */
export const PARTIAL = { share: 0.3 } as const;

export const SCORING_MODES = ['decay', 'fixed'] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];

/**
 * `phones`: everyone sees the image on their own phone. `bigscreen`: one shared screen shows it
 * (`/screen/:code`) and phones are controllers, with the answer input and the bonuses only.
 */
export const DISPLAY_MODES = ['phones', 'bigscreen'] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const FREE_TEXT = {
  minGuessIntervalMs: 700,
  maxGuessLength: 80,
} as const;

export const MULTIPLE_CHOICE = {
  optionCount: 4,
  wrongPickPenalty: 100,
  lockMs: 3_000,
} as const;

export const SELF_BONUSES = [
  'zoomOut',
  'secondZone',
  'initials',
  'category',
  'removeTwo',
  'shield',
] as const;
export const MALUSES = ['blur', 'flip', 'freeze'] as const;
export const STEALS = ['stealBonus', 'stealPoints'] as const;
export const BONUS_TYPES = [...SELF_BONUSES, ...MALUSES, ...STEALS] as const;

export type SelfBonus = (typeof SELF_BONUSES)[number];
export type Malus = (typeof MALUSES)[number];
export type Steal = (typeof STEALS)[number];
export type BonusType = (typeof BONUS_TYPES)[number];

export const BONUS = {
  inventoryCap: 3,
  /** One bonus every N correct answers in a row. */
  streakLength: 3,
  minPlayersForFastest: 3,
  minPlayersForCatchUp: 3,
  catchUpFromRound: 2,
  /**
   * Bonuses are earned, never bought with score. Using a self bonus still lowers what the current
   * round is worth for that player only; points already scored are never touched.
   */
  roundCost: {
    zoomOut: 150,
    secondZone: 100,
    initials: 200,
    category: 100,
    removeTwo: 150,
    shield: 0,
    blur: 0,
    flip: 0,
    freeze: 0,
    stealBonus: 0,
    stealPoints: 0,
  } satisfies Record<BonusType, number>,
  effectMs: { blur: 4_000, flip: 5_000, freeze: 3_000 } satisfies Record<Malus, number>,
  /** Share of the victim's points for the round that moves to the thief. */
  stealPointsShare: 0.3,
  /**
   * Relative odds when a bonus is drawn. Types that make no sense in the room are left out of
   * the draw: attacks and steals in solo training, `removeTwo` when answers are typed.
   */
  drawWeights: {
    zoomOut: 3,
    secondZone: 3,
    initials: 2,
    category: 2,
    removeTwo: 2,
    shield: 2,
    blur: 3,
    flip: 3,
    freeze: 2,
    stealBonus: 2,
    stealPoints: 2,
  } satisfies Record<BonusType, number>,
} as const;

export const ROOM = {
  codeLength: 5,
  /** No 0/O, 1/I/L: codes are read aloud and typed on phones. */
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  minPlayers: 2,
  maxPlayers: 12,
  reconnectGraceMs: 60_000,
  /** Shared screens are spectators, not players. A few are allowed (a TV and a laptop). */
  maxScreens: 4,
  /** A room opened from a big screen waits this long for its first player. */
  emptyRoomTtlMs: 15 * 60_000,
  roundsOptions: [5, 10, 15],
  defaultRounds: 10,
} as const;

export const MATCHMAKING = {
  maxPlayers: 8,
  startAtPlayers: 3,
  minPlayers: 2,
  timeoutMs: 20_000,
} as const;

/**
 * Games with strangers. Closed in v1: the game plays real people and characters only, which are
 * never dealt to strangers. Reopened with the v2 catalogue (objects, places, animals).
 */
export const PUBLIC_GAMES = { open: false } as const;

/** How hard a room's close-ups are: where a face's round may open. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';
export type StartZone = 'eye' | 'nose' | 'mouth';
export const DIFFICULTY_STARTS: Record<Difficulty, readonly StartZone[]> = {
  easy: ['eye'],
  normal: ['eye', 'nose'],
  hard: ['eye', 'nose', 'mouth'],
};

export const NICKNAME = { minLength: 2, maxLength: 16 } as const;

export const TIME_SYNC = {
  samples: 5,
  /** The offset is the median of the samples with the lowest round-trip time. */
  keepLowestRtt: 3,
} as const;
