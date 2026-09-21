import { describe, expect, it } from 'vitest';
import { answerFrom, difficultyFor, judgeFile, plainText, toCandidate } from './candidates.js';
import type { CommonsFile } from './wikimedia.client.js';

/** A picture Commons describes the way it describes most of them: CC BY-SA, JPEG, large. */
const picture = (overrides: Partial<CommonsFile> = {}, metadata: Record<string, string> = {}) => ({
  pageId: 4242,
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Lion.jpg',
  thumbUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Lion.jpg/330px-Lion.jpg',
  width: 3264,
  height: 2448,
  size: 4_000_000,
  mime: 'image/jpeg',
  ...overrides,
  metadata: {
    Artist: '<a href="//commons.wikimedia.org/wiki/User:Someone">Sumit Pamnani</a>',
    License: 'cc-by-sa-4.0',
    LicenseShortName: 'CC BY-SA 4.0',
    AttributionRequired: 'true',
    ...metadata,
  },
});

describe('judgeFile', () => {
  it('credits a free picture with a plain-text author, its licence, and a link by page id', () => {
    expect(judgeFile(picture())).toEqual({
      credit: {
        author: 'Sumit Pamnani',
        licence: 'CC BY-SA 4.0',
        // Not the file name: "Lion.jpg" would give the answer away.
        sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=4242',
      },
    });
  });

  it('accepts public domain, CC0, CC BY and the national ports of CC BY-SA', () => {
    for (const [License, LicenseShortName] of <[string, string][]>[
      ['pd', 'Public domain'],
      ['cc0', 'CC0'],
      ['cc-by-2.0', 'CC BY 2.0'],
      ['cc-by-sa-2.0-de', 'CC BY-SA 2.0 de'],
    ]) {
      expect(judgeFile(picture({}, { License, LicenseShortName }))).toHaveProperty('credit');
    }
  });

  it('reads the licence name when the code is one of Commons’ oddities', () => {
    const migrated = picture(
      {},
      { License: 'cc-by-sa-3.0-migrated', LicenseShortName: 'CC BY-SA 3.0' },
    );
    expect(judgeFile(migrated)).toHaveProperty('credit.licence', 'CC BY-SA 3.0');
  });

  it('refuses what is not free to crop and show', () => {
    for (const [License, LicenseShortName] of <[string, string][]>[
      ['gfdl', 'GFDL'],
      ['cc-by-nc-4.0', 'CC BY-NC 4.0'],
      ['cc-by-nd-4.0', 'CC BY-ND 4.0'],
      ['', ''],
    ]) {
      expect(judgeFile(picture({}, { License, LicenseShortName }))).toEqual({
        rejection: 'LICENCE',
      });
    }
  });

  it('refuses a picture of an identifiable person before anything else', () => {
    const person = picture(
      { mime: 'image/svg+xml' },
      { Restrictions: 'personality', License: 'gfdl' },
    );
    expect(judgeFile(person)).toEqual({ rejection: 'PERSONALITY' });
    expect(judgeFile(picture({}, { Restrictions: 'trademarked' }))).toEqual({
      rejection: 'RESTRICTED',
    });
    expect(judgeFile(picture({}, { Restrictions: 'insignia|personality' }))).toEqual({
      rejection: 'PERSONALITY',
    });
  });

  it('refuses a picture with nobody to credit, even in the public domain', () => {
    expect(judgeFile(picture({}, { Artist: ' <span> </span> ' }))).toEqual({
      rejection: 'NO_AUTHOR',
    });
    expect(
      judgeFile(picture({}, { Artist: '', License: 'pd', LicenseShortName: 'Public domain' })),
    ).toEqual({
      rejection: 'NO_AUTHOR',
    });
  });

  it('refuses drawings, animations and pictures too small to look at from close', () => {
    expect(judgeFile(picture({ mime: 'image/svg+xml' }))).toEqual({ rejection: 'FORMAT' });
    expect(judgeFile(picture({ mime: 'image/gif' }))).toEqual({ rejection: 'FORMAT' });
    expect(judgeFile(picture({ width: 700, height: 951 }))).toEqual({ rejection: 'TOO_SMALL' });
    expect(judgeFile(picture({ width: 1000, height: 1000 }))).toHaveProperty('credit');
  });

  it('shortens an author too long for the editor’s field', () => {
    const long = 'A'.repeat(200);
    const judged = judgeFile(picture({}, { Artist: long })) as { credit: { author: string } };
    expect(judged.credit.author).toHaveLength(120);
    expect(judged.credit.author.endsWith('…')).toBe(true);
  });
});

describe('toCandidate', () => {
  const row = { qid: 'Q140', popularity: 180, file: 'Lion.jpg' };
  const entity = {
    labels: { fr: 'lion', en: 'lion' },
    aliases: { fr: ['Panthera leo', 'Lion'], en: ['Panthera leo'] },
  };

  it('keeps what the admin needs to decide, and the file the worker will fetch', () => {
    expect(toCandidate(row, entity, picture())).toMatchObject({
      qid: 'Q140',
      file: 'Lion.jpg',
      popularity: 180,
      difficulty: 1,
      answers: {
        fr: { text: 'lion', aliases: ['Panthera leo'] },
        en: { text: 'lion', aliases: ['Panthera leo'] },
      },
      thumbUrl: expect.stringContaining('330px-'),
      credit: { author: 'Sumit Pamnani' },
      rejection: null,
      importedIn: [],
    });
  });

  it('says why a subject cannot be imported', () => {
    expect(toCandidate(row, entity, undefined)).toMatchObject({
      rejection: 'NO_FILE',
      credit: null,
    });
    const noFrench = { ...entity, labels: { en: 'lion' } };
    expect(toCandidate(row, noFrench, picture())).toMatchObject({
      rejection: 'NO_FRENCH_NAME',
      answers: { fr: null },
    });
    // The picture's problem comes first: without it there is no card, whatever its name.
    expect(toCandidate(row, noFrench, picture({ width: 600 }))).toMatchObject({
      rejection: 'TOO_SMALL',
    });
  });
});

describe('answerFrom', () => {
  it('drops a disambiguation in brackets', () => {
    expect(answerFrom('Mercure (planète)')).toEqual({ text: 'Mercure', aliases: [] });
  });

  it('keeps each alias once, accents and case aside, and never the label again', () => {
    expect(
      answerFrom('éléphant', ['Éléphant', 'elephant', 'pachyderme', 'Pachyderme ', 'mammouth']),
    ).toEqual({ text: 'éléphant', aliases: ['pachyderme', 'mammouth'] });
  });

  it('stays within the editor’s limits', () => {
    const many = Array.from({ length: 20 }, (_, i) => `alias ${i}`);
    expect(answerFrom('chat', many)?.aliases).toHaveLength(12);
    expect(answerFrom('chat', ['x'.repeat(81)])?.aliases).toEqual([]);
    expect(answerFrom('y'.repeat(81))).toBeNull();
    expect(answerFrom(undefined)).toBeNull();
    expect(answerFrom('  ')).toBeNull();
  });
});

describe('difficultyFor', () => {
  it('makes the best-known subjects the easy ones', () => {
    expect([200, 150, 149, 80, 79, 30].map(difficultyFor)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('plainText', () => {
  it('turns Commons’ HTML into a name', () => {
    expect(plainText('Steinway &amp; Sons, <i>Hamburg</i>')).toBe('Steinway & Sons, Hamburg');
    expect(plainText('O&#39;Brien&nbsp;&#x2014; <a href="x">site</a>')).toBe("O'Brien — site");
    expect(plainText('<b>a</b>\n\n  <br/>b')).toBe('a b');
  });
});
