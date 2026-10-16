import { DEFAULT_POINTS, type PointsRule } from '../scoring/types.js';
import { DEFAULT_SCRAMBLE_RULE, type ScrambleRule } from '../scramble/scramble.js';
import { DEFAULT_HANDICAP_RULE, type HandicapRule } from './handicap.js';

/** Everything a league admin can configure. Stored per league; a season copies it when it starts. */
export interface LeagueSettings {
  points: PointsRule;
  /** How suggested handicaps are worked out. Admins review and apply them. */
  handicap: HandicapRule;
  season: {
    /** Regular-season rounds: 15 = everyone plays everyone once with 16 players. */
    regularSeasonWeeks: number;
  };
  teeTimes: {
    /** HH:MM, 24-hour. */
    firstTeeTime: string;
    intervalMinutes: number;
  };
  /** Which nine is played: alternate each week, or always the same one. */
  nines: 'alternate' | 'front' | 'back';
  playoffs: {
    format: 'knockout' | 'final_foursome' | 'none';
    /** Tie-break for playoff matches: last 6/3/1 then countback, optionally par 5s first. */
    tiebreak: 'standard' | 'par5s_first';
  };
  scorecards: {
    /** Hours other players have to dispute a submitted card before it becomes final. */
    disputeWindowHours: number;
  };
  /** Defaults for the post-season team scramble. */
  scramble: ScrambleRule;
}

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  points: DEFAULT_POINTS,
  handicap: DEFAULT_HANDICAP_RULE,
  season: { regularSeasonWeeks: 15 },
  teeTimes: { firstTeeTime: '17:00', intervalMinutes: 9 },
  nines: 'alternate',
  playoffs: { format: 'knockout', tiebreak: 'standard' },
  scorecards: { disputeWindowHours: 48 },
  scramble: DEFAULT_SCRAMBLE_RULE,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Fills any missing settings with defaults (older leagues, or settings added later). */
export function withDefaults(
  stored: DeepPartial<LeagueSettings> | null | undefined,
): LeagueSettings {
  const s = stored ?? {};
  const d = DEFAULT_LEAGUE_SETTINGS;
  return {
    points: { ...d.points, ...s.points },
    handicap: { ...d.handicap, ...s.handicap },
    season: { ...d.season, ...s.season },
    teeTimes: { ...d.teeTimes, ...s.teeTimes },
    nines: s.nines ?? d.nines,
    playoffs: { ...d.playoffs, ...s.playoffs },
    scorecards: { ...d.scorecards, ...s.scorecards },
    scramble: {
      teamSize: s.scramble?.teamSize ?? d.scramble.teamSize,
      allowance: (s.scramble?.allowance as number[] | undefined) ?? d.scramble.allowance,
    },
  };
}
