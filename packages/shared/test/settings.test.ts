import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS, withDefaults } from '../src/index.js';

describe('league settings', () => {
  it('defaults match the Wednesday league rules', () => {
    expect(DEFAULT_LEAGUE_SETTINGS.points).toEqual({ win: 3, tie: 1, loss: 0 });
    expect(DEFAULT_LEAGUE_SETTINGS.season.regularSeasonWeeks).toBe(15);
    expect(DEFAULT_LEAGUE_SETTINGS.nines).toBe('alternate');
    expect(DEFAULT_LEAGUE_SETTINGS.playoffs).toEqual({ format: 'knockout', tiebreak: 'standard' });
  });

  it('fills missing values and keeps stored ones', () => {
    const s = withDefaults({ points: { tie: 2 }, nines: 'front' });
    expect(s.points).toEqual({ win: 3, tie: 2, loss: 0 });
    expect(s.nines).toBe('front');
    expect(s.handicap).toEqual(DEFAULT_LEAGUE_SETTINGS.handicap);
    expect(withDefaults(null)).toEqual(DEFAULT_LEAGUE_SETTINGS);
  });
});
