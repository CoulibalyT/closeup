import { describe, expect, it } from 'vitest';
import { parallelLimit } from './parallel.js';

describe('parallelLimit', () => {
  it('runs at most `limit` at once, in order, and one failure leaves the others alone', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const results = await parallelLimit([0, 1, 2, 3, 4, 5, 6], 2, async (item, index) => {
      expect(index).toBe(item);
      seen.push(item);
      inFlight++;
      peak = Math.max(peak, inFlight);
      // A few turns of the queue: long enough for the other lane to start its item.
      for (let turn = 0; turn < 3; turn++) await Promise.resolve();
      inFlight--;
      if (item === 3) throw new Error('three');
      return item * 10;
    });

    expect(peak).toBe(2);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(results).toHaveLength(7);
    expect(results[3]).toEqual({ status: 'rejected', reason: new Error('three') });
    expect(results.filter((r) => r.status === 'fulfilled').map((r) => r.value)).toEqual([
      0, 10, 20, 40, 50, 60,
    ]);
  });

  it('copes with an empty list and a limit above the count', async () => {
    expect(await parallelLimit([], 3, async () => 1)).toEqual([]);
    const results = await parallelLimit(['a'], 8, async (item) => item.toUpperCase());
    expect(results).toEqual([{ status: 'fulfilled', value: 'A' }]);
  });
});
