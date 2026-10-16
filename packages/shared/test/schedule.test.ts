import { describe, expect, it } from 'vitest';
import { addDays, diversityReport, generateSeason, roundRobin, teeTime } from '../src/index.js';

const LEAGUE = [
  'Brian',
  'Dickie',
  'Doc',
  'Don',
  'Jarrod',
  'Jason',
  'Jerry',
  'Keith',
  'Mike B',
  'Mike M',
  'Paul',
  'Rich',
  'Richie Jr',
  'Rick H',
  'Todd',
  'Tony',
];

const options = {
  players: LEAGUE,
  startDate: '2027-04-21',
  layouts: ['front', 'back'],
  firstTeeTime: '16:30',
  intervalMinutes: 9,
  seed: 2027,
};

describe('roundRobin', () => {
  it('16 players: 15 rounds, everyone plays once a week, every pair meets once', () => {
    const rounds = roundRobin(LEAGUE);
    expect(rounds).toHaveLength(15);
    const pairs = new Set<string>();
    for (const r of rounds) {
      expect(new Set(r.pairings.flat()).size).toBe(16);
      for (const [x, y] of r.pairings) pairs.add([x, y].sort().join('|'));
    }
    expect(pairs.size).toBe(120);
  });

  it('odd numbers get one bye per round, and each player sits out once', () => {
    const rounds = roundRobin(['a', 'b', 'c', 'd', 'e']);
    expect(rounds).toHaveLength(5);
    expect(rounds.map((r) => r.bye).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('generateSeason', () => {
  const season = generateSeason(options);
  const report = diversityReport(LEAGUE, season);

  it('defaults to 15 weekly rounds with 4 foursomes each', () => {
    expect(season).toHaveLength(15);
    for (const week of season) {
      expect(week.groups).toHaveLength(4);
      expect(week.groups.every((g) => g.matches.length === 2)).toBe(true);
    }
  });

  it('everyone plays everyone exactly once', () => {
    expect(report.pairsMet).toBe(120);
    expect(report.neverMet).toEqual([]);
    expect(report.maxOpponentRepeats).toBe(1);
  });

  it('mixes the foursomes: no two players share a group (other than as opponents) more than 3 times', () => {
    expect(report.maxGroupMateRepeats).toBeLessThanOrEqual(3);
  });

  it('keeps the foursome mix within 3 repeats across many seeds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = diversityReport(LEAGUE, generateSeason({ ...options, seed }));
      expect(r.maxGroupMateRepeats, `seed ${seed}`).toBeLessThanOrEqual(3);
    }
  }, 60_000);

  it('rotates tee order so everyone tees off both early and late', () => {
    for (const [player, [earliest, latest]] of Object.entries(report.teeSlotRange)) {
      expect(earliest, player).toBe(0);
      expect(latest, player).toBe(3);
    }
  });

  it('alternates nines, sets dates a week apart and tee times by interval', () => {
    expect(season.map((w) => w.layout).slice(0, 4)).toEqual(['front', 'back', 'front', 'back']);
    expect(season[0]!.date).toBe('2027-04-21');
    expect(season[14]!.date).toBe('2027-07-28');
    expect(season[0]!.groups.map((g) => g.teeTime)).toEqual(['16:30', '16:39', '16:48', '16:57']);
  });

  it('is reproducible from its seed and differs with another seed', () => {
    expect(generateSeason(options)).toEqual(season);
    expect(generateSeason({ ...options, seed: 1 })).not.toEqual(season);
  });

  it('extra weeks repeat matchups as evenly as possible', () => {
    const long = diversityReport(LEAGUE, generateSeason({ ...options, weeks: 18 }));
    expect(long.maxOpponentRepeats).toBe(2);
  });
});

describe('helpers', () => {
  it('addDays and teeTime', () => {
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
    expect(teeTime('16:55', 1, 9)).toBe('17:04');
  });
});
