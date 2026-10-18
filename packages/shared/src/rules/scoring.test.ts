import { describe, expect, it } from 'vitest';
import { fixedRoundValue, roundValue, partialValue, roundValueAt } from './scoring.js';

describe('fixedRoundValue', () => {
  it('pays by order of arrival, not by the clock', () => {
    expect([0, 1, 2, 3, 4, 11].map((before) => fixedRoundValue(before))).toEqual([
      1000, 800, 600, 500, 500, 500,
    ]);
  });

  it('still takes penalties off, down to the floor', () => {
    expect(fixedRoundValue(0, 150)).toBe(850);
    expect(fixedRoundValue(3, 450)).toBe(100);
    expect(fixedRoundValue(0, -50)).toBe(1000);
  });
});

describe('roundValue', () => {
  it('follows the scoring mode of the room', () => {
    const late = { elapsedMs: 29_000, foundBefore: 0, penalty: 100, decayMs: 30_000 };
    expect(roundValue({ scoring: 'fixed', ...late })).toBe(900);
    expect(roundValue({ scoring: 'decay', ...late })).toBe(130);
  });
});

describe('roundValueAt', () => {
  it('starts at 1000 and ends at 200', () => {
    expect(roundValueAt(0)).toBe(1000);
    expect(roundValueAt(30_000)).toBe(200);
  });

  it('decays linearly, rounded to the nearest 10', () => {
    expect(roundValueAt(15_000)).toBe(600);
    expect(roundValueAt(10_000)).toBe(730); // 733.3
    expect(roundValueAt(1_000)).toBe(970); // 973.3
  });

  it('clamps time outside the round', () => {
    expect(roundValueAt(-500)).toBe(1000);
    expect(roundValueAt(45_000)).toBe(200);
  });

  it('subtracts penalties from the current value', () => {
    expect(roundValueAt(0, 150)).toBe(850);
    expect(roundValueAt(15_000, 250)).toBe(350);
  });

  it('never drops below the floor, even with heavy penalties', () => {
    expect(roundValueAt(30_000, 150)).toBe(100);
    expect(roundValueAt(30_000, 5_000)).toBe(100);
  });

  it('ignores negative penalties', () => {
    expect(roundValueAt(0, -300)).toBe(1000);
  });
});

describe('hints and partial answers', () => {
  it('lowers the value after the hint, in both modes, never below the floor', () => {
    const at = { elapsedMs: 0, foundBefore: 0, decayMs: 30_000, afterHint: true };
    expect(roundValue({ scoring: 'decay', ...at })).toBe(850);
    expect(roundValue({ scoring: 'fixed', ...at, foundBefore: 1 })).toBe(650);
    expect(roundValue({ scoring: 'fixed', ...at, foundBefore: 9, penalty: 400 })).toBe(100);
  });

  it('gives 30 % for a partial answer, on the step, never below the floor', () => {
    expect(partialValue(1000)).toBe(300);
    expect(partialValue(570)).toBe(170);
    expect(partialValue(200)).toBe(100);
  });
});
