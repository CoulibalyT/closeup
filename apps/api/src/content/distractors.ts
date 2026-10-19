import { normalise } from '../game/engine/matching.js';

export type Random = () => number;

export interface OptionCandidate {
  id: string;
  label: string;
  difficulty: number;
  category: string;
  /** People only, from Wikidata; null when nobody knows. */
  gender?: string | null;
  /** The pack family ("ds-sportif" for "ds-sportif-2"): the answer's domain or universe. */
  family?: string | null;
}

export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function pickWeighted<T extends { weight: number }>(
  items: readonly T[],
  random: Random,
): T | undefined {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Wrong options for a multiple-choice round: same category, and the closer to the answer the
 * better, so that the options do not give it away: same gender first (a man among three women
 * is found at once), then the same domain or universe (footballers with footballers, Pokémon with
 * Pokémon), then a similar difficulty. Never two options that read the same, nor one that reads
 * like the answer.
 */
export function chooseDistractors<T extends OptionCandidate>(
  target: OptionCandidate,
  pool: readonly T[],
  count: number,
  random: Random,
): T[] {
  const taken = new Set([normalise(target.label)]);
  // 0 the same gender, 1 unknown (could be either), 2 the other one. No rank without a target gender.
  const genderRank = (c: OptionCandidate) =>
    !target.gender ? 0 : !c.gender ? 1 : c.gender === target.gender ? 0 : 2;
  const familyRank = (c: OptionCandidate) => (target.family && c.family === target.family ? 0 : 1);
  const candidates = shuffle(
    pool.filter((c) => c.id !== target.id && c.category === target.category),
    random,
  ).sort(
    (a, b) =>
      genderRank(a) - genderRank(b) ||
      familyRank(a) - familyRank(b) ||
      Math.abs(a.difficulty - target.difficulty) - Math.abs(b.difficulty - target.difficulty),
  );

  const chosen: T[] = [];
  for (const candidate of candidates) {
    const key = normalise(candidate.label);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    chosen.push(candidate);
    if (chosen.length === count) break;
  }
  return chosen;
}
