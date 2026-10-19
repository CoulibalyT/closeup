import {
  BONUS,
  type BonusType,
  dealableBonuses,
  type ErrorCode,
  type Malus,
  MALUSES,
  ZOOM,
} from '@closeup/shared';
import type {
  Context,
  Effect,
  EngineEvent,
  Reply,
  RoomState,
  RoundPlayerState,
  RoundState,
} from './types.js';

/**
 * Bonuses are earned by playing, never bought with score. Using a self bonus lowers what the
 * current round is worth for that player; attacks and steals are free. Everything here is pure
 * and works on the draft state owned by `reduce`.
 */

type GrantReason = 'streak' | 'fastest' | 'catchup' | 'stolen';

/** Either the reason a bonus cannot be played, or what playing it does. */
type Play = Reply | (() => void);

const refuse = (code: ErrorCode, message: string): Reply => ({
  ok: false,
  error: { code, message },
});

const emitTo = (effects: Effect[], event: EngineEvent, to?: string) =>
  effects.push({ type: 'emit', event, to });

const isMalus = (type: BonusType): type is Malus => (MALUSES as readonly string[]).includes(type);

export const isFrozen = (mine: RoundPlayerState, now: number): boolean =>
  mine.effect?.type === 'freeze' && mine.effect.until > now;

/** Types that can be drawn in this room: no attacks alone, no "remove two" on typed answers. */
function drawable(state: RoomState): BonusType[] {
  // Once the room's hint is out, initials and category would show what everyone already sees.
  const hintShown = state.round?.hintAt !== undefined;
  return dealableBonuses({
    mode: state.mode,
    answerMode: state.settings.answerMode,
    display: state.settings.display ?? 'phones',
  }).filter((type) => !(hintShown && (type === 'initials' || type === 'category')));
}

export function grant(
  state: RoomState,
  playerId: string,
  reason: GrantReason,
  ctx: Context,
  effects: Effect[],
  forced?: BonusType,
): void {
  const player = state.players[playerId];
  if (!player) return;
  const inventory = (player.inventory ??= []);
  if (inventory.length >= BONUS.inventoryCap) return;

  let type = forced;
  if (!type) {
    const types = drawable(state);
    const total = types.reduce((sum, t) => sum + BONUS.drawWeights[t], 0);
    let roll = (ctx.random ?? Math.random)() * total;
    type = types.find((t) => (roll -= BONUS.drawWeights[t]) < 0) ?? types[types.length - 1];
  }
  if (!type) return;

  const item = { id: ctx.newId(), type };
  inventory.push(item);
  // The item goes to its owner only; the room just sees their count change.
  emitTo(effects, { type: 'bonusGranted', playerId, item, reason }, playerId);
  emitTo(effects, { type: 'playerUpdated', playerId });
}

/** At the end of a round, from the second one: whoever is last, if someone is ahead of them. */
export function grantCatchUp(state: RoomState, ctx: Context, effects: Effect[]): void {
  const round = state.round;
  const playing = Object.values(state.players).filter((p) => !p.gone);
  if (!round || round.index + 1 < BONUS.catchUpFromRound) return;
  if (playing.length < BONUS.minPlayersForCatchUp) return;

  const scores = playing.map((p) => p.score);
  const lowest = Math.min(...scores);
  if (lowest === Math.max(...scores)) return;
  for (const player of playing) {
    if (player.score === lowest) grant(state, player.id, 'catchup', ctx, effects);
  }
}

/** Zoom out, second zone, initials, category, remove two options, shield. */
export function selfBonus(
  state: RoomState,
  round: RoundState,
  playerId: string,
  type: BonusType,
  ctx: Context,
  effects: Effect[],
): Play {
  const player = state.players[playerId]!;
  const mine = round.perPlayer[playerId]!;
  const cost = BONUS.roundCost[type];
  const revealed = (mine.revealed ??= {});

  if (type === 'shield') {
    if (player.shielded) return refuse('BAD_PHASE', 'Your shield is already up');
    return () => {
      player.shielded = true;
    };
  }
  // Everything else helps to find the answer: pointless, so refused, once it is found.
  if (mine.answeredAt !== undefined) return refuse('BAD_PHASE', 'You already found the answer');

  switch (type) {
    case 'zoomOut': {
      const level = round.level + (mine.bonusLevels ?? 0);
      if (level >= ZOOM.maxLevel) return refuse('BAD_PHASE', 'You already see the widest view');
      return () => {
        mine.bonusLevels = (mine.bonusLevels ?? 0) + 1;
        mine.penalty += cost;
        emitTo(effects, { type: 'personalLevel', playerId, level: level + 1 }, playerId);
      };
    }
    case 'secondZone':
      if (!round.card.secondZone || revealed.secondZone) {
        return refuse('BAD_PHASE', 'There is no other zone to show');
      }
      return () => {
        revealed.secondZone = true;
        mine.penalty += cost;
      };
    case 'initials':
    case 'category':
      if (round.hintAt !== undefined) return refuse('ALREADY_SHOWN', 'The room hint is showing');
      if (revealed[type] || (type === 'category' && !round.card.category)) {
        return refuse('BAD_PHASE', 'Nothing more to reveal');
      }
      return () => {
        revealed[type] = true;
        mine.penalty += cost;
      };
    case 'removeTwo': {
      const removed = mine.removedOptionIds ?? [];
      const wrong = (round.card.options ?? []).filter(
        (option) => option.id !== round.card.correctOptionId && !removed.includes(option.id),
      );
      if (state.settings.answerMode !== 'mcq' || wrong.length < 2) {
        return refuse('BAD_PHASE', 'There are no two options to remove');
      }
      return () => {
        const random = ctx.random ?? Math.random;
        const first = wrong.splice(Math.floor(random() * wrong.length), 1)[0]!;
        const second = wrong.splice(Math.floor(random() * wrong.length), 1)[0]!;
        mine.removedOptionIds = [...removed, first.id, second.id];
        mine.penalty += cost;
      };
    }
    default:
      return refuse('BAD_PHASE', 'This bonus needs a target');
  }
}

/** Blur, flip, freeze, steal a bonus, steal points: all of them need a victim. */
export function attack(
  state: RoomState,
  round: RoundState,
  playerId: string,
  type: BonusType,
  targetId: string | undefined,
  ctx: Context,
  effects: Effect[],
): Play {
  const target = targetId ? state.players[targetId] : undefined;
  const theirs = targetId ? round.perPlayer[targetId] : undefined;
  if (!target || !theirs || target.id === playerId || !target.connected) {
    return refuse('TARGET_INVALID', 'Pick another player of this round');
  }

  if (type === 'stealBonus') {
    if (!target.inventory?.length) return refuse('TARGET_INVALID', 'They have nothing to steal');
  } else {
    // A malus or a points steal only makes sense on someone who is still looking.
    if (theirs.answeredAt !== undefined) {
      return refuse('TARGET_INVALID', 'They already found the answer');
    }
    const busy = isMalus(type)
      ? theirs.effect !== undefined && theirs.effect.until > ctx.now
      : theirs.pointsThief !== undefined;
    if (busy) return refuse('TARGET_BUSY', 'Someone is already on them');
  }

  return () => {
    if (target.shielded) {
      target.shielded = false;
      emitTo(effects, { type: 'blocked', from: playerId, to: target.id, what: type });
      return;
    }
    if (isMalus(type)) {
      const until = ctx.now + BONUS.effectMs[type];
      theirs.effect = { type, from: playerId, until };
      emitTo(effects, { type: 'malus', malus: type, from: playerId, to: target.id, until });
    } else if (type === 'stealPoints') {
      theirs.pointsThief = playerId;
      emitTo(effects, { type: 'steal', kind: 'points', from: playerId, to: target.id });
    } else {
      const loot = target.inventory ?? [];
      const random = ctx.random ?? Math.random;
      const [stolen] = loot.splice(Math.floor(random() * loot.length), 1);
      if (!stolen) return;
      emitTo(effects, {
        type: 'steal',
        kind: 'bonus',
        from: playerId,
        to: target.id,
        bonusType: stolen.type,
      });
      emitTo(effects, { type: 'playerUpdated', playerId: target.id });
      grant(state, playerId, 'stolen', ctx, effects, stolen.type);
    }
  };
}
