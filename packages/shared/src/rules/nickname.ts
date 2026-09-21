import { NICKNAME } from '../constants/game.js';

/**
 * A nickname is shown to strangers in public games, so it gets a filter. It is deliberately
 * small and blunt: it turns away the obvious, not every idea. What it cannot catch is why a
 * report button exists (phase 7) and why a person reads the reports.
 *
 * Rules of the list, so that it can grow without becoming a minefield:
 *   - only stems, matched inside a word once the name is normalised (accents and spacing gone);
 *   - never a common word a real nickname could contain ("Pascal", "Assane");
 *   - `banned` is for insults and slurs, `reserved` for names that claim to be the house.
 */

const BANNED = [
  // fr
  'connard',
  'encule',
  'salope',
  'pute',
  'putain',
  'batard',
  'nique',
  'ntm',
  'pd',
  'tarlouze',
  'negro',
  'bougnoule',
  'youpin',
  // en
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigg',
  'faggot',
  'rape',
  'nazi',
  'hitler',
];

/** Nobody is the house. These are refused whole, not as fragments. */
const RESERVED = [
  'admin',
  'administrateur',
  'moderateur',
  'moderator',
  'closeup',
  'loupette',
  'systeme',
  'system',
];

/**
 * Lower case, without accents, and with the tricks that hide a word from a plain search:
 * repeated letters, digits and punctuation used as letters, spaces inside a word.
 */
export function flattenNickname(nickname: string): string {
  const swaps: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '@': 'a',
    $: 's',
    '!': 'i',
  };
  return nickname
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9@$!]/g, (character) => swaps[character] ?? '')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

export type NicknameVerdict = 'ok' | 'too_short' | 'too_long' | 'banned' | 'reserved';

/** What is wrong with this nickname, or `ok`. Shape and content in one place. */
export function checkNickname(nickname: string): NicknameVerdict {
  const trimmed = nickname.trim();
  if (trimmed.length < NICKNAME.minLength) return 'too_short';
  if (trimmed.length > NICKNAME.maxLength) return 'too_long';

  const flat = flattenNickname(trimmed);
  if (!flat) return 'too_short';
  // Flattened on both sides, like the banned list: "Loupette" flattens to "loupete", so a
  // reserved word with a double letter would otherwise never match itself.
  if (RESERVED.some((word) => flattenNickname(word) === flat)) return 'reserved';
  // Stems are flattened too: the list is written as people write, not as the filter reads.
  if (BANNED.some((word) => flat.includes(flattenNickname(word)))) return 'banned';
  return 'ok';
}

export const isNicknameAllowed = (nickname: string): boolean => checkNickname(nickname) === 'ok';
