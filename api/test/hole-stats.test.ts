import { describe, expect, it } from 'vitest';
import { holeStats } from '../src/scorecards/hole-stats.js';

const holes = [
  { number: 1, par: 4, strokeIndex: 3 },
  { number: 2, par: 3, strokeIndex: 9 },
  { number: 3, par: 5, strokeIndex: 1 },
];

describe('hole stats (checked by hand)', () => {
  it('averages, over par, the mix of results and the difficulty rank', () => {
    const rows = [
      { layoutId: 'l', playerId: 'a', holeScores: [4, 4, 5] },
      { layoutId: 'l', playerId: 'b', holeScores: [6, 3, 6] },
      { layoutId: 'l', playerId: 'a', holeScores: [5, 2, null] },
      { layoutId: 'l', playerId: 'c', holeScores: [3, 5, 7] },
    ];
    const [h1, h2, h3] = holeStats(holes, rows, 'a');
    // Hole 1 (par 4): 4, 6, 5, 3 -> 18/4 = 4.5, +0.5. Birdie 1, par 1, bogey 1, double 1.
    expect(h1).toMatchObject({
      n: 4,
      avg: 4.5,
      toPar: 0.5,
      mix: { birdie: 0.25, par: 0.25, bogey: 0.25, double: 0.25 },
      mine: { n: 2, avg: 4.5 }, // a: 4, 5
    });
    // Hole 2 (par 3): 4, 3, 2, 5 -> 3.5, +0.5. a: 4, 2 -> 3.
    expect(h2).toMatchObject({ n: 4, avg: 3.5, toPar: 0.5, mine: { n: 2, avg: 3 } });
    // Hole 3 (par 5): 5, 6, 7 (one blank) -> 6, +1. a: 5.
    expect(h3).toMatchObject({ n: 3, avg: 6, toPar: 1, mine: { n: 1, avg: 5 } });
    // Hardest: hole 3 (+1), then +0.5 each: hole 1 (index 3) before hole 2 (index 9).
    expect([h1!.rank, h2!.rank, h3!.rank]).toEqual([2, 3, 1]);
  });

  it('with no scores: nothing to average or rank', () => {
    const [h1] = holeStats(holes, []);
    expect(h1).toMatchObject({ n: 0, avg: null, toPar: null, rank: null, mine: null });
  });
});
