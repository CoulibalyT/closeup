import { describe, expect, it } from 'vitest';
import { estimateClockOffset, sampleFromPing } from './timeSync.js';

describe('sampleFromPing', () => {
  it('assumes the server stamped the message halfway through the round trip', () => {
    // client sent at 1000, got the reply at 1100, server clock said 6050 in between
    expect(sampleFromPing({ t0: 1000, t1: 6050, t2: 1100 })).toEqual({
      rttMs: 100,
      offsetMs: 5000,
    });
  });
});

describe('estimateClockOffset', () => {
  it('returns null without samples', () => {
    expect(estimateClockOffset([])).toBeNull();
  });

  it('takes the median offset of the lowest round trips', () => {
    const result = estimateClockOffset([
      { rttMs: 40, offsetMs: 100 },
      { rttMs: 42, offsetMs: 104 },
      { rttMs: 45, offsetMs: 98 },
      { rttMs: 300, offsetMs: 260 }, // a slow, skewed sample must not move the estimate
      { rttMs: 500, offsetMs: -90 },
    ]);
    expect(result).toEqual({ offsetMs: 100, rttMs: 42 });
  });

  it('works with fewer samples than it would like to keep', () => {
    expect(estimateClockOffset([{ rttMs: 30, offsetMs: 12 }])).toEqual({ offsetMs: 12, rttMs: 30 });
  });

  it('averages the two middle values for an even count', () => {
    const result = estimateClockOffset(
      [
        { rttMs: 10, offsetMs: 10 },
        { rttMs: 11, offsetMs: 20 },
      ],
      2,
    );
    expect(result).toEqual({ offsetMs: 15, rttMs: 10.5 });
  });
});
