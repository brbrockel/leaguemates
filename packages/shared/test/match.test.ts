import { describe, expect, it } from 'vitest';
import { pointsFor, scoreMatch, type MatchPlayer } from '../src/index.js';
import { TIMBERLIN_FRONT } from './layouts.js';

const played = (id: string, handicap: number, gross: number): MatchPlayer => ({
  id,
  handicap,
  attendance: 'played',
  gross,
});
const absent = (id: string, handicap: number): MatchPlayer => ({
  id,
  handicap,
  attendance: 'absent',
});

describe('scoreMatch: both played', () => {
  it('lower net wins (July 15 2026, Jerry 43 v Brian 53 off 7 strokes)', () => {
    const r = scoreMatch(played('Jerry', 7, 43), played('Brian', 14, 53), TIMBERLIN_FRONT);
    expect(r).toMatchObject({
      outcome: 'A',
      decidedBy: 'net',
      net: { A: 43, B: 46 },
      strokes: { A: 0, B: 7 },
    });
  });

  it('scores July 15 2026 Match 1 as a Mike B win when both played (54 v 56)', () => {
    const r = scoreMatch(played('Keith', 13, 56), played('Mike B', 15, 56), TIMBERLIN_FRONT);
    expect(r.outcome).toBe('B');
    expect(r.net).toEqual({ A: 56, B: 54 });
  });

  it('equal nets tie', () => {
    expect(
      scoreMatch(played('Rich', 6, 44), played('Jarrod', 6, 44), TIMBERLIN_FRONT).outcome,
    ).toBe('T');
  });

  it('works from hole scores', () => {
    const a: MatchPlayer = {
      id: 'a',
      handicap: 4,
      attendance: 'played',
      holeScores: [5, 4, 4, 3, 5, 6, 3, 4, 5],
    };
    const b: MatchPlayer = {
      id: 'b',
      handicap: 10,
      attendance: 'played',
      holeScores: [6, 5, 5, 4, 5, 6, 4, 5, 5],
    };
    // a: 39 gross; b: 45 gross − 6 strokes = 39 net.
    expect(scoreMatch(a, b, TIMBERLIN_FRONT)).toMatchObject({
      outcome: 'T',
      net: { A: 39, B: 39 },
    });
  });
});

describe('scoreMatch: absences', () => {
  it('present player wins by beating par + the absent handicap', () => {
    // Baseline 36 + 13 = 49. Mike B (15) gets 2 strokes: 48 net beats 49.
    const r = scoreMatch(absent('Keith', 13), played('Mike B', 15, 50), TIMBERLIN_FRONT);
    expect(r).toMatchObject({
      outcome: 'B',
      decidedBy: 'absence',
      baseline: 49,
      net: { A: null, B: 48 },
    });
  });

  it('is a tie when the present player does not beat the baseline', () => {
    // Baseline 36 + 13 = 49. 51 − 2 = 49 net does not beat it.
    expect(scoreMatch(absent('Keith', 13), played('Mike B', 15, 51), TIMBERLIN_FRONT).outcome).toBe(
      'T',
    );
  });

  it('the present player can never lose', () => {
    expect(scoreMatch(played('Jerry', 7, 70), absent('Brian', 14), TIMBERLIN_FRONT).outcome).toBe(
      'T',
    );
  });

  it('ignores any score entered for the absent player (a sub)', () => {
    const sub: MatchPlayer = { id: 'Brian', handicap: 14, attendance: 'absent', gross: 30 };
    expect(scoreMatch(played('Jerry', 7, 45), sub, TIMBERLIN_FRONT).outcome).toBe('A');
  });

  it('both absent is a tie', () => {
    expect(scoreMatch(absent('Paul', 6), absent('Doc', 10), TIMBERLIN_FRONT)).toMatchObject({
      outcome: 'T',
      decidedBy: 'both_absent',
    });
  });

  it('needs a score for a player who played', () => {
    expect(() =>
      scoreMatch({ id: 'x', handicap: 5, attendance: 'played' }, absent('y', 5), TIMBERLIN_FRONT),
    ).toThrow(/No score/);
  });
});

describe('pointsFor', () => {
  it('awards 3 / 1 / 0', () => {
    expect(pointsFor('A', 'A')).toBe(3);
    expect(pointsFor('A', 'B')).toBe(0);
    expect(pointsFor('T', 'B')).toBe(1);
  });
});
