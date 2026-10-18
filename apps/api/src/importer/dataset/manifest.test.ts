import { describe, expect, it } from 'vitest';
import {
  answerOf,
  commonsFileOf,
  type DatasetEntry,
  frwikiTitleOf,
  isRealPerson,
  parseManifest,
  photosOf,
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
    // A French Wikipedia local file is not on Commons; a broken escape is no file, not a crash.
    expect(
      commonsFileOf(
        entry({ source_url: 'https://upload.wikimedia.org/wikipedia/fr/a/ab/Logo.png' }),
      ),
    ).toBe(null);
    expect(
      commonsFileOf(
        entry({
          source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Bad%E0%A4%A.jpg',
        }),
      ),
    ).toBe(null);
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

describe('the 2026-10-18 dataset', () => {
  it('takes the new categories and the wikipedia source as real people', () => {
    const [tv, culture] = parseManifest([
      entry({ id: 'tv', category: 'tele' as never, source: 'wikipedia' as never }),
      entry({ id: 'cu', category: 'culture' as never }),
    ]);
    expect(isRealPerson(tv!)).toBe(true);
    expect(targetsOf(culture!)).toEqual([{ pack: 'culture', slugSuffix: '', difficulty: 2 }]);
  });

  it('gives one photo per picture of a person, the main one first, and one for a character', () => {
    const omar = entry({
      id: 'omar-sy',
      image: 'images/acteur/omar-sy.jpg',
      file: 'Omar_Sy_2019.jpg',
      face_px: 410,
      images: [
        {
          file: 'images/acteur/omar-sy.jpg',
          face_px: 410,
          source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Omar_Sy_2019.jpg',
        },
        {
          file: 'images/acteur/omar-sy-2.jpg',
          face_px: 300,
          source_url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Omar_Sy_Cannes.jpg',
        },
        {
          file: 'images/acteur/omar-sy-3.jpg',
          face_px: 120,
          source_url: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Omar_Sy_far.jpg',
        },
      ],
    } as never);
    expect(photosOf(omar)).toEqual([
      {
        suffix: '',
        path: 'images/acteur/omar-sy.jpg',
        commonsFile: 'Omar_Sy_2019.jpg',
        facePx: 410,
      },
      {
        suffix: '-p2',
        path: 'images/acteur/omar-sy-2.jpg',
        commonsFile: 'Omar_Sy_Cannes.jpg',
        facePx: 300,
      },
      {
        suffix: '-p3',
        path: 'images/acteur/omar-sy-3.jpg',
        commonsFile: 'Omar_Sy_far.jpg',
        facePx: 120,
      },
    ]);
    const alone = entry({
      id: 'x',
      image: 'images/acteur/x.jpg',
      source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',
    });
    expect(photosOf(alone)).toEqual([
      { suffix: '', path: 'images/acteur/x.jpg', commonsFile: 'X.jpg', facePx: undefined },
    ]);
    const character = entry({
      id: 'c',
      category: 'fiction',
      image: 'images/fiction/c.jpg',
      images: [{ file: 'images/fiction/c-2.jpg' }],
    } as never);
    expect(photosOf(character)).toHaveLength(1);
  });
});
