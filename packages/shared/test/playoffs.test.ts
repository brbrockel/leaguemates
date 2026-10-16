import { describe, expect, it } from 'vitest';
import {
  firstRoundSeeds,
  matchingCards,
  nextRoundPairs,
  par5sFirst,
  scoreFoursome,
  scoreKnockout,
  STANDARD_MATCHING_CARDS,
  type SeededPlayer,
} from '../src/index.js';
import { TIMBERLIN_BACK, TIMBERLIN_FRONT } from './layouts.js';

const player = (
  id: string,
  seed: number,
  handicap: number,
  holeScores?: number[],
): SeededPlayer => ({
  id,
  seed,
  handicap,
  attendance: holeScores ? 'played' : 'absent',
  ...(holeScores ? { holeScores } : {}),
});

describe('matchingCards', () => {
  it('decides on the last 6 holes', () => {
    const r = matchingCards(
      { A: [4, 4, 4, 4, 4, 4, 4, 4, 4], B: [3, 3, 3, 5, 4, 4, 4, 4, 5] },
      TIMBERLIN_FRONT,
    );
    expect(r).toEqual({ leaders: ['A'], decidedAtStep: 0 });
  });

  it('falls through to the last hole, then counts back', () => {
    const same = [4, 4, 4, 4, 4, 4, 4, 4, 4];
    expect(matchingCards({ A: same, B: [4, 4, 4, 4, 4, 4, 5, 3, 4] }, TIMBERLIN_FRONT)).toEqual({
      leaders: ['B'],
      decidedAtStep: 3, // last 6, last 3 and last hole all tie; hole 8 decides
    });
  });

  it('reports a tie that never breaks', () => {
    const same = [4, 4, 4, 4, 4, 4, 4, 4, 4];
    expect(matchingCards({ A: same, B: [...same] }, TIMBERLIN_FRONT).leaders).toEqual(['A', 'B']);
  });

  it('par 5s first uses holes 1 and 6 on the front, 10 and 13 on the back', () => {
    expect(par5sFirst(TIMBERLIN_FRONT)[0]).toEqual({ kind: 'holes', numbers: [1, 6] });
    expect(par5sFirst(TIMBERLIN_BACK)[0]).toEqual({ kind: 'holes', numbers: [10, 13] });
    expect(par5sFirst(TIMBERLIN_FRONT).slice(1)).toEqual(STANDARD_MATCHING_CARDS);
  });
});

describe('scoreKnockout', () => {
  // Spec example: a 4 handicap v a 10 handicap tied on net; the 10 gets strokes on 6, 1, 2, 9, 5, 3.
  const low = [5, 4, 4, 3, 5, 6, 3, 4, 5]; // 39 gross
  const high = [6, 5, 5, 4, 5, 6, 4, 5, 5]; // 45 gross, 39 net

  it('breaks a net tie with matching cards', () => {
    const r = scoreKnockout(
      player('low', 1, 4, low),
      player('high', 16, 10, high),
      TIMBERLIN_FRONT,
    );
    // Last 6 (holes 4-9) tie at 26 net; last 3 (holes 7-9): low 12, high 14 − 1 stroke = 13.
    expect(r).toEqual({ winner: 'A', decidedBy: 'card_match', net: { A: 39, B: 39 } });
  });

  it('an absent player loses (2026 round 2: Jerry absent, Mike M advanced)', () => {
    const r = scoreKnockout(player('Jerry', 2, 7), player('Mike M', 16, 8, high), TIMBERLIN_FRONT);
    expect(r.winner).toBe('B');
    expect(r.decidedBy).toBe('forfeit');
  });

  it('the higher seed advances if the cards match exactly', () => {
    const r = scoreKnockout(player('x', 9, 6, low), player('y', 8, 6, [...low]), TIMBERLIN_FRONT);
    expect(r).toMatchObject({ winner: 'B', decidedBy: 'seed' });
  });

  it('both absent goes to the commissioner', () => {
    expect(scoreKnockout(player('x', 1, 6), player('y', 2, 6), TIMBERLIN_FRONT).decidedBy).toBe(
      'commissioner',
    );
  });
});

describe('bracket', () => {
  it('seeds round 1 as 1 v 16, 2 v 15, ... like 2026', () => {
    expect(firstRoundSeeds(16)).toEqual([
      [1, 16],
      [2, 15],
      [3, 14],
      [4, 13],
      [5, 12],
      [6, 11],
      [7, 10],
      [8, 9],
    ]);
  });

  it('pairs winners of consecutive matches (2026 round 2)', () => {
    const round1Winners = ['Mike M', 'Jerry', 'Rick H', 'Doc', 'Rich', 'Jason', 'Todd', 'Don'];
    expect(nextRoundPairs(round1Winners)).toEqual([
      ['Mike M', 'Jerry'],
      ['Rick H', 'Doc'],
      ['Rich', 'Jason'],
      ['Todd', 'Don'],
    ]);
  });
});

describe('scoreFoursome', () => {
  it('gives strokes from the lowest handicap and ranks by net', () => {
    const r = scoreFoursome(
      [
        player('Rich', 1, 4, [5, 4, 4, 3, 5, 6, 3, 4, 5]), // 39, 0 strokes
        player('Mike M', 2, 8, [6, 5, 4, 3, 5, 6, 4, 4, 5]), // 42 − 4 = 38
        player('Rick H', 3, 10, [6, 5, 5, 4, 5, 6, 4, 5, 5]), // 45 − 6 = 39
        player('Todd', 4, 14, [7, 6, 5, 4, 6, 7, 4, 5, 6]), // 50 − 10 = 40
      ],
      TIMBERLIN_FRONT,
    );
    expect(r.winner).toBe('Mike M');
    expect(r.decidedBy).toBe('net');
    expect(r.standings.map((s) => [s.id, s.strokes, s.net, s.position])).toEqual([
      ['Mike M', 4, 38, 1],
      ['Rich', 0, 39, 2],
      ['Rick H', 6, 39, 2],
      ['Todd', 10, 40, 4],
    ]);
  });
});
