/**
 * How a league works out handicaps from recent 9-hole gross scores.
 * Defaults are the rule that best matches the league's 2020-2026 sheets
 * (see doc/Handicaps.md): best 10 of the last 20, 75% of the average over 35, rounded down, max 18.
 */
export interface HandicapRule {
  /** Look at the player's last N rounds. */
  rounds: number;
  /** Average the best (lowest) K of them; 0 averages them all. */
  best: number;
  /** Percent of (average - base) that becomes the handicap. */
  allowance: number;
  /** 9-hole score that equals a handicap of 0. */
  base: number;
  rounding: 'down' | 'nearest';
  max: number;
  /** Fewer rounds than this: keep the current handicap. */
  minimumRounds: number;
  /** Also count rounds from another league (e.g. its history), matched by nickname. */
  includeLeagueId: string | null;
}

export const DEFAULT_HANDICAP_RULE: HandicapRule = {
  rounds: 20,
  best: 10,
  allowance: 75,
  base: 35,
  rounding: 'down',
  max: 18,
  minimumRounds: 5,
  includeLeagueId: null,
};

export interface HandicapResult {
  /** null when there aren't enough rounds yet. */
  handicap: number | null;
  /** The last N rounds, oldest first. */
  window: number[];
  /** The scores that were averaged. */
  counted: number[];
  average: number | null;
}

/**
 * Handicap from gross scores, oldest first. With fewer than `rounds` scores it uses what
 * there is, counting the same share of best scores (best 10 of 20 = the better half).
 */
export function computeHandicap(grossOldestFirst: number[], rule: HandicapRule): HandicapResult {
  const window = grossOldestFirst.slice(-rule.rounds);
  if (window.length === 0 || window.length < rule.minimumRounds)
    return { handicap: null, window, counted: [], average: null };
  const share = rule.best > 0 ? Math.min(rule.best, rule.rounds) / rule.rounds : 1;
  const k = Math.max(1, Math.round(window.length * share));
  const counted = [...window].sort((a, b) => a - b).slice(0, k);
  const average = counted.reduce((s, g) => s + g, 0) / counted.length;
  const raw = (average - rule.base) * (rule.allowance / 100);
  // Tiny epsilon so 7.9999999 from floating point still rounds down to 8.
  const rounded = rule.rounding === 'down' ? Math.floor(raw + 1e-9) : Math.round(raw);
  return {
    handicap: Math.min(Math.max(rounded, 0), rule.max),
    window,
    counted,
    average: Math.round(average * 10) / 10,
  };
}
