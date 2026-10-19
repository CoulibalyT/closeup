import { BONUS_TYPES, type BonusType, type DisplayMode, SELF_BONUSES } from '../constants/game.js';

/** What decides the bonuses a room deals. */
export interface DealingRoom {
  mode: 'solo' | 'private' | 'public';
  answerMode: 'text' | 'mcq';
  display: DisplayMode;
}

/**
 * The bonus types a room deals, in `BONUS_TYPES` order. The engine draws from these and the
 * how-to pages list them, so the two cannot disagree. Alone there is nobody to attack; removing
 * two options needs options; on a big screen Blur and Flip would blur it for everyone.
 */
export function dealableBonuses(room: DealingRoom): BonusType[] {
  return BONUS_TYPES.filter((type) => {
    if (room.mode === 'solo' && !(SELF_BONUSES as readonly string[]).includes(type)) return false;
    if (type === 'removeTwo') return room.answerMode === 'mcq';
    if (room.display === 'bigscreen' && (type === 'blur' || type === 'flip')) return false;
    return true;
  });
}
