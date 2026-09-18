import { TIME_SYNC } from '../constants/game.js';

export interface ClockSample {
  rttMs: number;
  /** Add this to the local clock to get server time. */
  offsetMs: number;
}

/** `t0`/`t2`: local send and receive times. `t1`: server time stamped on the reply. */
export function sampleFromPing({
  t0,
  t1,
  t2,
}: {
  t0: number;
  t1: number;
  t2: number;
}): ClockSample {
  const rttMs = t2 - t0;
  return { rttMs, offsetMs: t1 - (t0 + rttMs / 2) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? upper) + upper) / 2 : upper;
}

/**
 * A slow round trip is an asymmetric one, so its offset is the least trustworthy: keep the
 * fastest samples only, then take the median so a single outlier cannot move the estimate.
 */
export function estimateClockOffset(
  samples: ClockSample[],
  keep: number = TIME_SYNC.keepLowestRtt,
): ClockSample | null {
  if (samples.length === 0) return null;
  const fastest = [...samples].sort((a, b) => a.rttMs - b.rttMs).slice(0, Math.max(1, keep));
  return {
    offsetMs: median(fastest.map((s) => s.offsetMs)),
    rttMs: median(fastest.map((s) => s.rttMs)),
  };
}
