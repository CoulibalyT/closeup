import { describe, expect, it } from 'vitest';
import { checkNickname, flattenNickname } from './nickname.js';

describe('flattenNickname', () => {
  it('sees through accents, capitals, digits, punctuation and repeated letters', () => {
    expect(flattenNickname('Mëlissa')).toBe('melisa');
    expect(flattenNickname('C0nn4rd')).toBe('conard');
    expect(flattenNickname('f u c k')).toBe('fuck');
    expect(flattenNickname('$hiiiit')).toBe('shit');
  });

  it('leaves an ordinary nickname recognisable', () => {
    expect(flattenNickname('Awa')).toBe('awa');
    expect(flattenNickname('Moussa 2')).toBe('mousa');
  });
});

describe('checkNickname', () => {
  it('accepts the nicknames people actually pick', () => {
    for (const nickname of ['Awa', 'Moussa 2', 'Théo', 'Inès', 'Pascal', 'Assane', 'Mr Pain']) {
      expect(checkNickname(nickname), nickname).toBe('ok');
    }
  });

  it('checks the shape first', () => {
    expect(checkNickname('A')).toBe('too_short');
    expect(checkNickname('  ')).toBe('too_short');
    expect(checkNickname('x'.repeat(17))).toBe('too_long');
    // Nothing but punctuation: there is no name in there.
    expect(checkNickname('---')).toBe('too_short');
  });

  it('turns away insults, dressed up or not', () => {
    for (const nickname of ['connard', 'C0nn4rd', 'Sal0pe', 'nique ta', 'FUCK', 'f.u.c.k']) {
      expect(checkNickname(nickname), nickname).toBe('banned');
    }
  });

  it('keeps the names of the house for the house', () => {
    expect(checkNickname('Admin')).toBe('reserved');
    expect(checkNickname('modérateur')).toBe('reserved');
    expect(checkNickname('Closeup')).toBe('reserved');
    expect(checkNickname('Loupette')).toBe('reserved');
    // Only whole: a nickname that merely contains it is somebody's name.
    expect(checkNickname('Adminou')).toBe('ok');
  });
});
