import { matchStrokes } from './strokes.js';
import {
  coursePar,
  grossScore,
  type Layout,
  type MatchPlayer,
  type Outcome,
  type PointsRule,
  type Side,
  DEFAULT_POINTS,
} from './types.js';

export type DecidedBy = 'net' | 'absence' | 'both_absent';

export interface MatchResult {
  outcome: Outcome;
  decidedBy: DecidedBy;
  strokes: Record<Side, number>;
  /** Net totals; null for an absent player (a sub's score never counts). */
  net: Record<Side, number | null>;
  /** With one player absent: par + the absent player's handicap, which the present player must beat. */
  baseline?: number;
}

/**
 * Scores a regular-season head-to-head match.
 *
 * - Both played: lower net score wins; equal nets tie.
 * - One absent: the present player wins only with a net score lower than
 *   par + the absent player's handicap; otherwise it's a tie. They can't lose.
 * - Both absent: tie.
 */
export function scoreMatch(a: MatchPlayer, b: MatchPlayer, layout: Layout): MatchResult {
  const strokes = matchStrokes(a.handicap, b.handicap);
  const netOf = (p: MatchPlayer, side: Side) =>
    p.attendance === 'played' ? grossScore(p) - strokes[side] : null;
  const net = { A: netOf(a, 'A'), B: netOf(b, 'B') };

  if (net.A === null && net.B === null) {
    return { outcome: 'T', decidedBy: 'both_absent', strokes, net };
  }
  if (net.A === null || net.B === null) {
    const present: Side = net.A === null ? 'B' : 'A';
    const absent = present === 'A' ? b : a;
    const baseline = coursePar(layout) + absent.handicap;
    const outcome: Outcome = net[present]! < baseline ? present : 'T';
    return { outcome, decidedBy: 'absence', strokes, net, baseline };
  }
  const outcome: Outcome = net.A < net.B ? 'A' : net.B < net.A ? 'B' : 'T';
  return { outcome, decidedBy: 'net', strokes, net };
}

/** Points earned by one side of a match. */
export function pointsFor(outcome: Outcome, side: Side, rule: PointsRule = DEFAULT_POINTS): number {
  if (outcome === 'T') return rule.tie;
  return outcome === side ? rule.win : rule.loss;
}
