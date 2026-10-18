import { describe, expect, it } from 'vitest';
import { characterHint, classHint, personHint } from './build.js';

describe('personHint', () => {
  it('says the occupation and two best-known works, and keeps the works as partial answers', () => {
    expect(
      personHint('Johnny Depp', {
        occupation: 'acteur',
        works: [
          'Pirates des Caraïbes',
          "Edward aux mains d'argent",
          'Johnny Depp: une vie',
          'Ed Wood',
        ],
      }),
    ).toEqual({
      hint: "Acteur — Pirates des Caraïbes, Edward aux mains d'argent",
      secondary: ['Pirates des Caraïbes', "Edward aux mains d'argent", 'Ed Wood'],
    });
  });

  it('never keeps a work that names the person', () => {
    const { hint, secondary } = personHint('Zinédine Zidane', {
      occupation: 'footballeur',
      works: ['Zidane, un portrait du 21e siècle', 'Real Madrid', 'Juventus'],
    });
    expect(hint).toBe('Footballeur — Real Madrid, Juventus');
    expect(secondary).not.toContain('Zidane, un portrait du 21e siècle');
  });

  it('falls back on what it has, and on nothing', () => {
    expect(personHint('Aya Nakamura', { occupation: 'chanteuse', works: [] })).toEqual({
      hint: 'Chanteuse',
      secondary: [],
    });
    expect(personHint('X', { occupation: null, works: [] })).toEqual({ hint: null, secondary: [] });
  });

  it('keeps at most eight partial answers, without duplicates', () => {
    const works = ['A1', 'A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9'];
    expect(personHint('Nom Prénom', { occupation: 'acteur', works }).secondary).toHaveLength(8);
  });
});

describe('personHint, from what Wikidata says of the person', () => {
  it('prefers the description to the most popular occupation', () => {
    expect(
      personHint('Rafael Nadal', {
        description: 'joueur de tennis espagnol',
        occupation: 'mannequin',
        works: [],
      }).hint,
    ).toBe('Joueur de tennis espagnol');
  });

  it('keeps the form of a "joueur ou joueuse" label that fits the person', () => {
    expect(
      personHint('Andy Murray', { occupation: 'joueur ou joueuse de tennis', works: [] }).hint,
    ).toBe('Joueur de tennis');
    expect(
      personHint('Serena Williams', {
        occupation: 'joueur ou joueuse de tennis',
        female: true,
        works: [],
      }).hint,
    ).toBe('Joueuse de tennis');
    expect(personHint('Tyson Fury', { occupation: 'sportif ou sportive', works: [] }).hint).toBe(
      'Sportif',
    );
  });

  it('never ends a cut description or a hint on a dangling word', () => {
    const { hint } = personHint('Omar Sy', {
      description: 'acteur, producteur de cinéma, scénariste et humoriste français',
      occupation: null,
      works: ['Intouchables', 'Lupin, dans l’ombre d’Arsène et ses très longues aventures'],
    });
    expect(hint).not.toMatch(/ et —| et$/);
    expect(hint!.length).toBeLessThanOrEqual(80);
    expect(hint).not.toMatch(/\s\S{1,3}$/);
  });

  it('cuts a long description, and never lets it name the person', () => {
    const long = 'acteur, réalisateur, scénariste et producteur de cinéma américain très connu';
    expect(
      personHint('X Y', { description: long, occupation: null, works: [] }).hint!.length,
    ).toBeLessThanOrEqual(80);
    expect(
      personHint('Zinédine Zidane', {
        description: 'footballeur, père d’Enzo Zidane',
        occupation: 'footballeur',
        works: [],
      }).hint,
    ).toBe('Footballeur');
  });
});

describe('characterHint', () => {
  it('takes the universe from the brackets, else from the Fandom wiki', () => {
    expect(characterHint('Alex (Totally Spies)')).toEqual({
      hint: 'Totally Spies',
      secondary: ['Totally Spies'],
    });
    expect(characterHint('Bibou', 'pyjamasques')).toEqual({
      hint: 'Pyjamasques',
      secondary: ['Pyjamasques'],
    });
    expect(characterHint('Dark Vador', 'starwars')).toEqual({
      hint: 'Star Wars',
      secondary: ['Star Wars'],
    });
    expect(characterHint('Babar')).toEqual({ hint: null, secondary: [] });
  });

  it('gives no universe that names the character', () => {
    expect(characterHint('Shrek', 'shrek')).toEqual({ hint: null, secondary: [] });
  });
});

describe('classHint', () => {
  it('capitalises the class of a thing, and drops one that names it', () => {
    expect(classHint('race de chien', 'Beagle')).toBe('Race de chien');
    expect(classHint('fromage', 'Fromage de Herve')).toBeNull();
    expect(classHint(null, 'Beagle')).toBeNull();
    expect(classHint("type d'instrument de musique", 'balalaïka')).toBe('Instrument de musique');
    expect(classHint('type de fruit', 'figue')).toBe('Fruit');
    expect(classHint("groupe d'organismes connu par un nom commun", 'chien')).toBeNull();
    // Too vague to help.
    expect(classHint('taxon', 'théier')).toBeNull();
    expect(classHint('quartier', 'Santiniketan')).toBeNull();
  });
});
