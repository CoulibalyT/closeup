import { describe, expect, it } from 'vitest';
import { chooseDistractors, pickWeighted, shuffle } from './distractors.js';

const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

const card = (id: string, label: string, difficulty: number, category = 'FOOD') => ({
  id,
  label,
  difficulty,
  category,
});

describe('chooseDistractors', () => {
  const target = card('orange', 'orange', 1);

  it('takes three cards of the same category', () => {
    const pool = [
      card('kiwi', 'kiwi', 1),
      card('pizza', 'pizza', 1),
      card('donut', 'donut', 1),
      card('owl', 'hibou', 1, 'ANIMAL'),
    ];
    const chosen = chooseDistractors(target, pool, 3, Math.random);
    expect(chosen.map((c) => c.id).sort()).toEqual(['donut', 'kiwi', 'pizza']);
  });

  it('prefers a similar difficulty and only widens when it has to', () => {
    const pool = [
      card('a', 'abricot', 3),
      card('b', 'banane', 1),
      card('c', 'cerise', 1),
      card('d', 'datte', 2),
      card('e', 'figue', 3),
    ];
    const chosen = chooseDistractors(target, pool, 3, Math.random).map((c) => c.id);
    expect(chosen).toContain('b');
    expect(chosen).toContain('c');
    expect(chosen).toContain('d');
  });

  it('never offers the answer itself, nor two options that read the same', () => {
    const pool = [
      card('orange-2', 'Orange', 1),
      card('k1', 'kiwi', 1),
      card('k2', 'Kiwi ', 1),
      card('p', 'pizza', 1),
      card('d', 'donut', 1),
    ];
    const labels = chooseDistractors(target, pool, 3, Math.random).map((c) =>
      c.label.trim().toLowerCase(),
    );
    expect(labels).not.toContain('orange');
    expect(new Set(labels).size).toBe(3);
  });

  it('returns what it can when the category is too small', () => {
    expect(chooseDistractors(target, [card('kiwi', 'kiwi', 1)], 3, Math.random)).toHaveLength(1);
  });
});

describe('pickWeighted', () => {
  const points = [
    { id: 'eye', weight: 4 },
    { id: 'nose', weight: 1 },
  ];

  it('follows the weights', () => {
    expect(pickWeighted(points, () => 0.79)?.id).toBe('eye');
    expect(pickWeighted(points, () => 0.81)?.id).toBe('nose');
  });

  it('handles an empty list', () => {
    expect(pickWeighted([], Math.random)).toBeUndefined();
  });
});

describe('shuffle', () => {
  it('keeps every element and does not touch the input', () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffle(input, sequence([0.9, 0.1, 0.5, 0.3]));
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...output].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(output).not.toEqual(input);
  });
});
