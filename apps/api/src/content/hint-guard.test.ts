import { describe, expect, it } from 'vitest';
import { givesAnswer } from './hint-guard.js';

describe('givesAnswer', () => {
  it('lets a hint through when it shares no word with the answer', () => {
    expect(givesAnswer('Acteur — Pirates des Caraïbes', { text: 'Johnny Depp', aliases: [] })).toBe(
      false,
    );
    expect(givesAnswer('Musée à Paris', { text: 'Le Louvre', aliases: [] })).toBe(false);
  });

  it('refuses a hint that names the answer or an alias, as a whole word, accents and case aside', () => {
    expect(givesAnswer('Le DEPP des pirates', { text: 'Johnny Depp', aliases: [] })).toBe(true);
    expect(givesAnswer('Tour célèbre', { text: 'tour Eiffel', aliases: ['La Tour'] })).toBe(true);
    expect(givesAnswer('Un éléphant', { text: 'Elephant', aliases: [] })).toBe(true);
    expect(givesAnswer('La Joconde', { text: 'Mona Lisa', aliases: ['Joconde'] })).toBe(true);
  });

  it('ignores short words and articles', () => {
    expect(givesAnswer('Le roi de la jungle', { text: 'Le Roi Lion', aliases: [] })).toBe(true);
    expect(givesAnswer('Un fruit de la mer', { text: 'la Mer de Glace', aliases: [] })).toBe(true);
    expect(givesAnswer('Une plante de la famille', { text: 'Le Lys', aliases: [] })).toBe(false);
  });
});
