import { normalise } from '../game/engine/matching.js';

/** Words too common to give anything away. */
const STOP = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'the', 'of', 'and']);
const words = (text: string) =>
  normalise(text)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOP.has(word));

/**
 * Whether a hint gives the answer away: it contains a word (three letters or more, not an
 * article) of the answer or of one of its aliases, accents and case aside.
 */
export function givesAnswer(hint: string, answer: { text: string; aliases: string[] }): boolean {
  const said = new Set(words(hint));
  return [answer.text, ...answer.aliases].some((name) => words(name).some((w) => said.has(w)));
}
