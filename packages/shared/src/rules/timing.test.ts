import { describe, expect, it } from 'vitest';
import { roundValueAt } from './scoring.js';
import { roundTiming } from './timing.js';

describe('roundTiming', () => {
  it('keeps the 30-second round of before', () => {
    expect(roundTiming({ roundSeconds: 30 })).toEqual({
      durationMs: 30_000,
      levelAtMs: [0, 10_000, 20_000],
      hintAtMs: 18_000,
      decayMs: 30_000,
      safetyMs: null,
    });
    // A room saved before the setting existed played 30 seconds.
    expect(roundTiming({})).toEqual(roundTiming({ roundSeconds: 30 }));
  });

  it('stretches the zoom, the hint and the value over a longer round', () => {
    expect(roundTiming({ roundSeconds: 60 })).toMatchObject({
      durationMs: 60_000,
      levelAtMs: [0, 20_000, 40_000],
      hintAtMs: 36_000,
      decayMs: 60_000,
    });
  });

  it('has no end without a clock, but a schedule and a safety', () => {
    expect(roundTiming({ roundSeconds: null })).toEqual({
      durationMs: null,
      levelAtMs: [0, 15_000, 30_000],
      hintAtMs: 30_000,
      decayMs: 90_000,
      safetyMs: 600_000,
    });
  });
});

describe('roundValueAt over a room length', () => {
  it('decays over the given length, then stays at the end value', () => {
    expect(roundValueAt(30_000, 0, 60_000)).toBe(600);
    expect(roundValueAt(120_000, 0, 90_000)).toBe(200);
    expect(roundValueAt(15_000)).toBe(600);
  });
});
