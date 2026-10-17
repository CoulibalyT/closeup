import { describe, expect, it } from 'vitest';
import {
  answerOf,
  commonsFileOf,
  type DatasetEntry,
  frwikiTitleOf,
  parseManifest,
  targetsOf,
} from './manifest.js';

const entry = (over: Partial<DatasetEntry>): DatasetEntry => ({
  id: 'x',
  name: 'X',
  category: 'acteur',
  image: 'images/acteur/x.jpg',
  source_url: '',
  page_url: '',
  page_title: 'X',
  ...over,
});

describe('targetsOf', () => {
  it('routes real people, characters, and kids characters twice', () => {
    expect(targetsOf(entry({ category: 'acteur' }))).toEqual([
      { pack: 'acteur', slugSuffix: '', difficulty: 2 },
    ]);
    expect(targetsOf(entry({ category: 'enfants' }))).toEqual([
      { pack: 'enfants', slugSuffix: '', difficulty: 1 },
    ]);
    expect(targetsOf(entry({ category: 'fiction', tags: ['fiction', 'enfants'] }))).toEqual([
      { pack: 'fiction', slugSuffix: '', difficulty: 2 },
      { pack: 'enfants', slugSuffix: '-kids', difficulty: 1 },
    ]);
  });
});

describe('commonsFileOf', () => {
  it('takes `file` first, else the URL, thumb or not', () => {
    expect(
      commonsFileOf(
        entry({
          file: 'A_b.jpg',
          source_url: 'https://upload.wikimedia.org/wikipedia/commons/7/71/Other.jpg',
        }),
      ),
    ).toBe('A_b.jpg');
    expect(
      commonsFileOf(
        entry({
          source_url:
            'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9a/Aaron_Paul_-_AMC.jpg/1280px-Aaron_Paul_-_AMC.jpg?utm_source=x',
        }),
      ),
    ).toBe('Aaron_Paul_-_AMC.jpg');
    expect(
      commonsFileOf(
        entry({
          source_url: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/A%C3%AFssa.jpg?utm=1',
        }),
      ),
    ).toBe('Aïssa.jpg');
    expect(commonsFileOf(entry({ source_url: 'https://static.wikia.nocookie.net/x.png' }))).toBe(
      null,
    );
  });
});

describe('answerOf and frwikiTitleOf', () => {
  it('answers with the name, brackets dropped', () => {
    expect(answerOf(entry({ name: 'Lisa (chanteuse)' }))).toBe('Lisa');
    expect(answerOf(entry({ name: 'Omar Sy' }))).toBe('Omar Sy');
  });

  it('takes the frwiki title from the page, else the page title', () => {
    expect(
      frwikiTitleOf(entry({ page_url: 'https://fr.wikipedia.org/wiki/Ars%C3%A8ne_Lupin' })),
    ).toBe('Arsène Lupin');
    expect(
      frwikiTitleOf(
        entry({
          page_url: 'https://commons.wikimedia.org/wiki/File:X.jpg',
          page_title: 'Charlize Theron',
        }),
      ),
    ).toBe('Charlize Theron');
  });
});

describe('parseManifest', () => {
  it('refuses a malformed manifest and names the entry', () => {
    expect(() => parseManifest([{ id: 'bad' }])).toThrow(/bad/);
    expect(parseManifest([entry({ id: 'ok', wiki: 'w', extra: 1 } as never)])[0]!.id).toBe('ok');
  });
});
