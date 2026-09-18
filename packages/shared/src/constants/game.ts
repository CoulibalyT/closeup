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

export const ZOOM = {
  /**
   * Crop side = 2 × baseRadius × multiplier. For people baseRadius is half the distance between
   * the eyes, which reproduces the prototype's 0.75 / 1.35 / 2.4 / 4.2 × eye distance.
   */
  levelMultipliers: [0.75, 1.35, 2.4, 4.2],
  /** Elapsed time at which each automatic level starts. The last level needs a bonus. */
  autoLevelAtMs: [0, 10_000, 20_000],
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
} as const;

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
} as const;

export const ROOM = {
  codeLength: 5,
  /** No 0/O, 1/I/L: codes are read aloud and typed on phones. */
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  minPlayers: 2,
  maxPlayers: 12,
  reconnectGraceMs: 60_000,
  roundsOptions: [5, 10, 15],
  defaultRounds: 10,
} as const;

export const MATCHMAKING = {
  maxPlayers: 8,
  startAtPlayers: 3,
  minPlayers: 2,
  timeoutMs: 20_000,
} as const;

export const NICKNAME = { minLength: 2, maxLength: 16 } as const;

export const TIME_SYNC = {
  samples: 5,
  /** The offset is the median of the samples with the lowest round-trip time. */
  keepLowestRtt: 3,
} as const;
