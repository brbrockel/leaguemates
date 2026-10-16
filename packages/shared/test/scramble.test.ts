import { describe, expect, it } from 'vitest';
import {
  balancedTeams,
  DEFAULT_SCRAMBLE_RULE as RULE,
  rankScramble,
  teamHandicap,
} from '../src/index.js';
import { TIMBERLIN_FRONT as FRONT } from './layouts.js';

const HCPS = [3, 4, 5, 6, 6, 6, 6, 7, 7, 8, 10, 12, 14, 14, 16, 16];
const players = HCPS.map((handicap, i) => ({ id: `p${i}`, handicap }));

describe('teamHandicap', () => {
  it('takes 20/15/10/5% from the lowest handicap up', () => {
    // 3*.2 + 6*.15 + 10*.1 + 16*.05 = 0.6 + 0.9 + 1 + 0.8 = 3.3
    expect(teamHandicap([16, 3, 10, 6], RULE.allowance)).toBe(3);
    expect(teamHandicap([10, 10], [50, 50])).toBe(10);
  });
});

describe('balancedTeams', () => {
  it('makes even teams of four with everyone placed once', () => {
    const teams = balancedTeams(players, RULE, 7);
    expect(teams).toHaveLength(4);
    expect(teams.every((t) => t.length === 4)).toBe(true);
    expect(new Set(teams.flat().map((p) => p.id)).size).toBe(16);
    const hs = teams.map((t) =>
      teamHandicap(
        t.map((p) => p.handicap),
        RULE.allowance,
      ),
    );
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(1);
    // Each team gets one of the four lowest handicaps (snake draft).
    expect(teams.map((t) => t[0]!.handicap).sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
  });

  it('handles a number that does not divide evenly', () => {
    const teams = balancedTeams(players.slice(0, 14), RULE);
    expect(teams.map((t) => t.length).sort()).toEqual([3, 3, 4, 4]);
  });
});

describe('rankScramble', () => {
  const holes = (total: number) => {
    const base = Array(9).fill(4) as number[];
    base[0] = total - 32;
    return base;
  };
  it('ranks by net and separates equal nets on the cards', () => {
    const r = rankScramble(
      [
        { id: 'a', handicap: 2, holeScores: holes(32) }, // net 30
        { id: 'b', handicap: 0, holeScores: holes(31) }, // net 31
        { id: 'c', handicap: 3, holeScores: [...holes(33).slice(0, 8), 3] }, // 32, net 29
        { id: 'd', handicap: 1, holeScores: [4, 4, 4, 4, 4, 4, 4, 4, null] },
      ],
      FRONT,
    );
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by['d']).toMatchObject({ position: null, net: null });
    // c: 33 with last hole 3 instead of 4 = 32, net 29 → first.
    expect(by['c']).toMatchObject({ gross: 32, net: 29, position: 1 });
    expect(by['a']).toMatchObject({ net: 30, position: 2 });
    expect(by['b']).toMatchObject({ net: 31, position: 3 });
  });

  it('a net tie goes to the better finish', () => {
    const r = rankScramble(
      [
        { id: 'x', handicap: 0, holeScores: [3, 4, 4, 4, 4, 4, 4, 4, 5] },
        { id: 'y', handicap: 0, holeScores: [5, 4, 4, 4, 4, 4, 4, 4, 3] },
      ],
      FRONT,
    );
    expect(r[0]).toMatchObject({ id: 'y', position: 1, onCards: true });
    expect(r[1]).toMatchObject({ id: 'x', position: 2, onCards: true });
  });
});
