/**
 * Checks the scoring rules against real league results from 2021-2026.
 * The fixture is built from teemate-data/history by `pnpm history:fixture`, with names anonymized.
 * Each match's recorded outcome comes from the change in the standings, not
 * from the scores. The sheets never record absences, so absence handling can
 * only be checked for consistency.
 */
import { describe, expect, it } from 'vitest';
import {
  computeStandings,
  scoreMatch,
  type Layout,
  type MatchPlayer,
  type Outcome,
} from '../src/index.js';
import history from './fixtures/history.json' with { type: 'json' };
import { TIMBERLIN_FRONT } from './layouts.js';

interface FixturePlayer {
  name: string;
  handicap: number;
  gross: number;
}
interface FixtureMatch {
  a: FixturePlayer;
  b: FixturePlayer;
  recorded: Outcome;
}

// Both Timberlin nines are par 36, and the sheets don't say which nine was played.
const PAR_36: Layout = TIMBERLIN_FRONT;

const asPlayer = (p: FixturePlayer, attendance: MatchPlayer['attendance']): MatchPlayer => ({
  id: p.name,
  handicap: p.handicap,
  attendance,
  gross: p.gross,
});

const matches = history.seasons.flatMap((s) =>
  s.weeks.flatMap((w) =>
    w.matches.map((m) => ({ year: s.year, date: w.date, ...(m as FixtureMatch) })),
  ),
);

describe('history fixture', () => {
  it('covers six seasons of weekly results', () => {
    expect(history.seasons.map((s) => s.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    expect(matches.length).toBeGreaterThan(600);
  });
});

describe('scoring rules v recorded results (2021-2026)', () => {
  const bothScored = matches.filter((m) => m.a.gross > 0 && m.b.gross > 0);

  it('every recorded win agrees with the net scores', () => {
    const disagreements = bothScored
      .filter((m) => m.recorded !== 'T')
      .filter(
        (m) =>
          scoreMatch(asPlayer(m.a, 'played'), asPlayer(m.b, 'played'), PAR_36).outcome !==
          m.recorded,
      )
      .map((m) => `${m.date} ${m.a.name} v ${m.b.name}`);
    expect(disagreements).toEqual([]);
  });

  it('every tie that the nets would have decided fits the absence rule for one of the players', () => {
    const unexplained = bothScored
      .filter((m) => m.recorded === 'T')
      .filter(
        (m) => scoreMatch(asPlayer(m.a, 'played'), asPlayer(m.b, 'played'), PAR_36).outcome !== 'T',
      )
      .filter(
        (m) =>
          scoreMatch(asPlayer(m.a, 'absent'), asPlayer(m.b, 'played'), PAR_36).outcome !== 'T' &&
          scoreMatch(asPlayer(m.a, 'played'), asPlayer(m.b, 'absent'), PAR_36).outcome !== 'T',
      )
      .map((m) => `${m.date} ${m.a.name} v ${m.b.name}`);
    expect(unexplained).toEqual([]);
  });

  it('matches with no score for either player were ties', () => {
    const noScores = matches.filter((m) => m.a.gross === 0 && m.b.gross === 0);
    expect(noScores.length).toBeGreaterThan(0);
    for (const m of noScores) {
      expect(scoreMatch(asPlayer(m.a, 'absent'), asPlayer(m.b, 'absent'), PAR_36).outcome).toBe(
        m.recorded,
      );
    }
  });

  it('matches with one missing score follow the absence rule', () => {
    for (const m of matches.filter((x) => (x.a.gross === 0) !== (x.b.gross === 0))) {
      const r = scoreMatch(
        asPlayer(m.a, m.a.gross ? 'played' : 'absent'),
        asPlayer(m.b, m.b.gross ? 'played' : 'absent'),
        PAR_36,
      );
      expect(r.outcome, `${m.date} ${m.a.name} v ${m.b.name}`).toBe(m.recorded);
    }
  });
});

describe('standings', () => {
  it('reproduces the final 2024 standings from all 15 weeks of results', () => {
    const season = history.seasons.find((s) => s.year === 2024)!;
    expect(season.weeks).toHaveLength(15);
    const players = season.finalStandings.map((s) => s.name);
    const recorded = season.weeks.flatMap((w) =>
      w.matches.map((m) => ({ a: m.a.name, b: m.b.name, outcome: m.recorded as Outcome })),
    );
    const computed = computeStandings(players, recorded);
    for (const sheet of season.finalStandings) {
      const row = computed.find((r) => r.playerId === sheet.name)!;
      expect({ W: row.W, L: row.L, T: row.T, points: row.points }, sheet.name).toEqual({
        W: sheet.W,
        L: sheet.L,
        T: sheet.T,
        points: sheet.points,
      });
    }
  });

  it('orders by points, then wins, then head-to-head', () => {
    const rows = computeStandings(
      ['a', 'b', 'c'],
      [
        { a: 'a', b: 'b', outcome: 'B' },
        { a: 'a', b: 'c', outcome: 'A' },
        { a: 'b', b: 'c', outcome: 'B' },
      ],
    );
    // All 3 points and 1 win each; the head-to-head among all three is level, so fall back to id.
    expect(rows.map((r) => [r.playerId, r.points])).toEqual([
      ['a', 3],
      ['b', 3],
      ['c', 3],
    ]);
    const h2h = computeStandings(
      ['x', 'y', 'z'],
      [
        { a: 'x', b: 'y', outcome: 'B' },
        { a: 'x', b: 'z', outcome: 'A' },
        { a: 'y', b: 'z', outcome: 'T' },
      ],
    );
    // y: 4 pts (W + T), x: 3 pts, z: 1 pt.
    expect(h2h.map((r) => r.playerId)).toEqual(['y', 'x', 'z']);
  });

  it('then the lower total net over the rounds all the tied players played', () => {
    const level = [
      { a: 'a', b: 'b', outcome: 'B' as const },
      { a: 'a', b: 'c', outcome: 'A' as const },
      { a: 'b', b: 'c', outcome: 'B' as const },
    ];
    const nets = new Map([
      [
        'a',
        new Map([
          [1, 36],
          [2, 36],
          [3, 30],
        ]),
      ], // round 3 only a played: ignored
      [
        'b',
        new Map([
          [1, 34],
          [2, 35],
        ]),
      ],
      [
        'c',
        new Map([
          [1, 35],
          [2, 36],
        ]),
      ],
    ]);
    // Shared rounds 1-2: b 69, c 71, a 72.
    const rows = computeStandings(['a', 'b', 'c'], level, undefined, nets);
    expect(rows.map((r) => r.playerId)).toEqual(['b', 'c', 'a']);
  });
});
