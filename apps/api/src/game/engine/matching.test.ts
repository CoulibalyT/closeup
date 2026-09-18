import { describe, expect, it } from 'vitest';
import { editDistance, matchAnswer, normalise } from './matching.js';

const orange = { primary: { text: 'orange', aliases: [] } };
const chat = {
  primary: { text: 'chat', aliases: ['matou'] },
  fallback: { text: 'cat', aliases: [] },
};
const curie = { primary: { text: 'Marie Curie', aliases: ['Curie', 'Maria Skłodowska'] } };
const eiffel = { primary: { text: 'tour Eiffel', aliases: [] } };

describe('normalise', () => {
  it('lowercases, strips accents and punctuation, collapses spaces', () => {
    expect(normalise("  L'Élan   du-Canada ! ")).toBe('elan du canada');
  });

  it('expands ligatures and handles letters NFD cannot decompose', () => {
    expect(normalise('Œil de bœuf')).toBe('oeil de boeuf');
    expect(normalise('Skłodowska')).toBe('sklodowska');
  });

  it.each([
    ['une orange', 'orange'],
    ["l'orange", 'orange'],
    ['les oranges', 'oranges'],
    ['the orange', 'orange'],
    ['an orange', 'orange'],
    ['de la confiture', 'confiture'],
  ])('drops the leading article of "%s"', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('keeps an article that is the whole answer', () => {
    expect(normalise('Un')).toBe('un');
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('orange', 'orange')).toBe(0);
    expect(editDistance('orange', 'orang')).toBe(1);
    expect(editDistance('orange', 'oranje')).toBe(1);
    expect(editDistance('chat', 'chien')).toBe(3);
  });

  it('counts two swapped neighbours as a single typo', () => {
    expect(editDistance('orange', 'oragne')).toBe(1);
  });
});

describe('matchAnswer', () => {
  it('accepts the answer whatever the case, accents or article', () => {
    expect(matchAnswer('Orange', orange)).toBe('correct');
    expect(matchAnswer("l'orange", orange)).toBe('correct');
    expect(matchAnswer('marie curie', curie)).toBe('correct');
  });

  it('treats a blank guess as empty, not wrong', () => {
    expect(matchAnswer('   ', orange)).toBe('empty');
    expect(matchAnswer('?!', orange)).toBe('empty');
  });

  describe('tolerance grows with the length of the answer', () => {
    it('demands an exact match up to 4 letters', () => {
      expect(matchAnswer('chat', chat)).toBe('correct');
      expect(matchAnswer('char', chat)).toBe('wrong');
      expect(matchAnswer('chats', chat)).toBe('wrong');
    });

    it('forgives one typo from 5 to 8 letters', () => {
      expect(matchAnswer('oranje', orange)).toBe('correct');
      expect(matchAnswer('oragne', orange)).toBe('correct');
      expect(matchAnswer('oranjes', orange)).not.toBe('correct');
    });

    it('forgives two typos beyond 8 letters', () => {
      expect(matchAnswer('mari curi', curie)).toBe('correct');
      expect(matchAnswer('mary kuri', curie)).not.toBe('correct');
    });
  });

  it('accepts listed aliases, which is how a family name alone is allowed', () => {
    expect(matchAnswer('Curie', curie)).toBe('correct');
    expect(matchAnswer('matou', chat)).toBe('correct');
    expect(matchAnswer('Maria Sklodowska', curie)).toBe('correct');
  });

  it("falls back to the other language's answers", () => {
    expect(matchAnswer('cat', chat)).toBe('correct');
  });

  describe('close', () => {
    it('says so when the guess is a few letters off a long enough answer', () => {
      expect(matchAnswer('oranjes', orange)).toBe('close');
      expect(matchAnswer('mary kuri', curie)).toBe('close');
    });

    it('says so when one word of a longer answer is right', () => {
      expect(matchAnswer('eiffel', eiffel)).toBe('close');
      expect(matchAnswer('marie', curie)).toBe('close');
    });

    it('never says close for short answers, where everything is a few letters off', () => {
      expect(matchAnswer('chou', chat)).toBe('wrong');
      expect(matchAnswer('rat', chat)).toBe('wrong');
    });

    it('stays wrong for something unrelated', () => {
      expect(matchAnswer('banane', orange)).toBe('wrong');
    });
  });

  describe('lexicon of the other cards in play', () => {
    const poule = { primary: { text: 'poule', aliases: [] } };
    const others = new Set(['boule', 'moule']);

    it('refuses a guess that is exactly another card, even one letter away', () => {
      expect(matchAnswer('boule', poule)).toBe('correct'); // without a lexicon it is a typo
      expect(matchAnswer('boule', poule, others)).toBe('wrong');
    });

    it('still forgives real typos', () => {
      expect(matchAnswer('poulle', poule, others)).toBe('correct');
    });

    it('never blocks the right answer', () => {
      expect(matchAnswer('poule', poule, new Set(['poule']))).toBe('correct');
    });
  });
});
