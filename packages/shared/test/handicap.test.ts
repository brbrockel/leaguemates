import { describe, expect, it } from 'vitest';
import { computeHandicap, DEFAULT_HANDICAP_RULE as RULE } from '../src/index.js';

describe('computeHandicap', () => {
  it('best 10 of the last 20, 75% over 35, rounded down', () => {
    // 20 rounds: ten 44s (best) and ten 50s; older rounds are ignored.
    const scores = [30, 30, ...Array(10).fill(50), ...Array(10).fill(44)];
    const r = computeHandicap(scores, RULE);
    expect(r.window).toHaveLength(20);
    expect(r.counted).toEqual(Array(10).fill(44));
    expect(r.average).toBe(44);
    expect(r.handicap).toBe(6); // (44 - 35) * 0.75 = 6.75
  });

  it('uses the same share of best rounds when there are fewer', () => {
    const r = computeHandicap([40, 42, 44, 46, 48, 50], RULE);
    expect(r.counted).toEqual([40, 42, 44]); // better half of 6
    expect(r.handicap).toBe(5); // (42 - 35) * 0.75 = 5.25
  });

  it('waits for the minimum number of rounds', () => {
    expect(computeHandicap([45, 46, 47, 48], RULE).handicap).toBeNull();
    expect(computeHandicap([], RULE).handicap).toBeNull();
  });

  it('caps at the maximum and never goes below zero', () => {
    expect(computeHandicap(Array(20).fill(70), RULE).handicap).toBe(18);
    expect(computeHandicap(Array(20).fill(33), RULE).handicap).toBe(0);
  });

  it('can average every round and round to nearest', () => {
    const rule = {
      ...RULE,
      rounds: 5,
      best: 0,
      allowance: 100,
      base: 36,
      rounding: 'nearest' as const,
    };
    expect(computeHandicap([40, 41, 42, 43, 44], rule)).toMatchObject({ average: 42, handicap: 6 });
    expect(computeHandicap([40, 41, 42, 43, 45], { ...rule, allowance: 80 }).handicap).toBe(5); // 6.2*0.8=4.96
  });

  it('rounds 8.0 down to 8 despite floating point', () => {
    // (45.6667 - 35) * 0.75 = 8.0000…
    const r = computeHandicap([45, 46, 46, 50, 51], { ...RULE, rounds: 5, best: 3 });
    expect(r.handicap).toBe(8);
  });
});
