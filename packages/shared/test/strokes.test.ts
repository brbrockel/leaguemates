import { describe, expect, it } from 'vitest';
import { allocateStrokes, matchStrokes, netHoleScores } from '../src/index.js';
import { TIMBERLIN_BACK, TIMBERLIN_FRONT } from './layouts.js';

describe('matchStrokes', () => {
  it('gives the full difference to the higher handicap', () => {
    expect(matchStrokes(6, 13)).toEqual({ A: 0, B: 7 });
    expect(matchStrokes(15, 13)).toEqual({ A: 2, B: 0 });
    expect(matchStrokes(6, 6)).toEqual({ A: 0, B: 0 });
  });
});

describe('allocateStrokes', () => {
  it('puts strokes on the hardest holes first (front nine: 6, 1, 2, 9, 5, 3, 8, 7, 4)', () => {
    // 6 strokes land on holes 6, 1, 2, 9, 5 and 3.
    expect(allocateStrokes(6, TIMBERLIN_FRONT)).toEqual([1, 1, 1, 0, 1, 1, 0, 0, 1]);
  });

  it('goes round again when there are more strokes than holes', () => {
    // 11 strokes: one on every hole, plus a second on the two hardest (6 and 1).
    expect(allocateStrokes(11, TIMBERLIN_FRONT)).toEqual([2, 1, 1, 1, 1, 2, 1, 1, 1]);
  });

  it('uses the back nine stroke index', () => {
    // Hardest on the back: 13 (2), 14 (4), 15 (6).
    expect(allocateStrokes(3, TIMBERLIN_BACK)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
  });

  it('always hands out exactly the strokes given', () => {
    for (let s = 0; s <= 30; s++) {
      expect(allocateStrokes(s, TIMBERLIN_FRONT).reduce((a, b) => a + b, 0)).toBe(s);
    }
  });
});

describe('netHoleScores', () => {
  it('subtracts the allocated strokes hole by hole', () => {
    const gross = [6, 5, 5, 4, 5, 6, 4, 5, 5];
    expect(netHoleScores(gross, 2, TIMBERLIN_FRONT)).toEqual([5, 5, 5, 4, 5, 5, 4, 5, 5]);
  });
});
