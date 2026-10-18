import { describe, expect, it } from 'vitest';
import { oneCardPerSubject } from './subjects.js';

const card = (id: string, slug: string | null, answer: string) => ({
  id,
  slug,
  answers: [{ text: answer, aliases: [] }],
});

describe('oneCardPerSubject', () => {
  it('keeps the first card of each subject, in order', () => {
    const cards = [
      card('a', 'ds-omar-sy-p2', 'Omar Sy'),
      card('b', 'wd-Q140', 'lion'),
      card('c', 'ds-omar-sy', 'Omar Sy'),
      card('d', 'ds-omar-sy-p3', 'Omar Sy'),
      card('e', 'ds-alex-kids', 'Alex'),
      card('f', 'ds-alex', 'Alex'),
      card('g', 'wd-Q2', 'Zinédine Zidane'),
      card('h', 'wd-Q2-p2', 'Zinedine Zidane'),
      card('i', null, 'Tour Eiffel'),
      card('j', null, 'tour eiffel'),
    ];
    expect(oneCardPerSubject(cards).map((c) => c.id)).toEqual(['a', 'b', 'e', 'g', 'i']);
  });

  it('does not merge different subjects whose slugs only look alike', () => {
    const cards = [card('a', 'ds-apollo-11', 'Apollo 11'), card('b', 'ds-apollo-13', 'Apollo 13')];
    expect(oneCardPerSubject(cards)).toHaveLength(2);
  });
});
