import { describe, expect, it } from 'vitest';
import { isDeniedSubject, isLatinName, isVagueSubject } from './guards.js';

const subject = (over: Partial<Parameters<typeof isDeniedSubject>[0]> = {}) => ({
  instanceOf: [],
  subclassOf: [],
  labels: ['lion'],
  descriptions: ['grand félin'],
  ...over,
});

describe('isDeniedSubject', () => {
  it('refuses a denied class, as instance or as subclass', () => {
    // cemetery
    expect(isDeniedSubject(subject({ instanceOf: ['Q39614'] }))).toBe('GUARD_CLASS');
    // weapon
    expect(isDeniedSubject(subject({ subclassOf: ['Q728'] }))).toBe('GUARD_CLASS');
  });

  it('refuses a denied word as a whole word, accents and case aside', () => {
    expect(isDeniedSubject(subject({ labels: ['Arme blanche'] }))).toBe('GUARD_WORD');
    expect(isDeniedSubject(subject({ descriptions: ['Camp de concentration nazi'] }))).toBe(
      'GUARD_WORD',
    );
    expect(isDeniedSubject(subject({ labels: ['Lac Nu'] }))).toBe('GUARD_WORD');
  });

  it('refuses what a microscope or a dig shows', () => {
    expect(isDeniedSubject(subject({ labels: ['Virus de la grippe'] }))).toBe('GUARD_WORD');
    expect(isDeniedSubject(subject({ descriptions: ['champignon unicellulaire'] }))).toBe(
      'GUARD_WORD',
    );
    expect(
      isDeniedSubject(
        subject({ labels: ['Homme de Cro-Magnon'], descriptions: ['crâne fossile'] }),
      ),
    ).toBe('GUARD_WORD');
  });

  it('lets substrings through', () => {
    expect(isDeniedSubject(subject({ labels: ['Armée de terre'] }))).toBeNull();
    expect(isDeniedSubject(subject({ labels: ['Nuage'] }))).toBeNull();
    expect(isDeniedSubject(subject())).toBeNull();
  });
});

describe('isVagueSubject', () => {
  it('spots a description that names a group rather than one thing', () => {
    expect(isVagueSubject(['terme désignant plusieurs espèces de mammifères marins'])).toBe(true);
    expect(isVagueSubject([null, 'informal group of freshwater fish'])).toBe(true);
    expect(isVagueSubject(['grand félin', 'large cat'])).toBe(false);
    expect(isVagueSubject([null, undefined])).toBe(false);
  });
});

describe('isLatinName', () => {
  it('spots an organism whose French name is its scientific name', () => {
    expect(isLatinName('Bos taurus', 'Bos taurus')).toBe(true);
    expect(isLatinName('vache', 'Bos taurus')).toBe(false);
    expect(isLatinName(undefined, 'Bos taurus')).toBe(true);
    expect(isLatinName('lion', null)).toBe(false);
  });
});
