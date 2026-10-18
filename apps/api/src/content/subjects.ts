import { normalise } from '../game/engine/matching.js';

/**
 * Who or what a card shows. Several cards may show the same subject: a person's other photos
 * (`…-p2`, `…-p3`), a character's copy in the kids pack (`…-kids`), or the same answer from two
 * imports. A game must never deal two of them.
 */
function subjectKeys(card: { slug: string | null; answers: { text: string }[] }): string[] {
  const keys: string[] = [];
  if (card.slug) keys.push(`slug:${card.slug.replace(/-kids$/, '').replace(/-p\d+$/, '')}`);
  const answer = card.answers[0]?.text;
  if (answer) keys.push(`answer:${normalise(answer)}`);
  return keys;
}

/** The first card of each subject, in the given order. */
export function oneCardPerSubject<T extends { slug: string | null; answers: { text: string }[] }>(
  cards: T[],
): T[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const keys = subjectKeys(card);
    if (keys.some((key) => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  });
}
