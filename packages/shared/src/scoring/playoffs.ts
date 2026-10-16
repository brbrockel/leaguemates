import { matchStrokes, netHoleScores } from './strokes.js';
import { matchingCards, STANDARD_MATCHING_CARDS, type CardStep } from './tiebreak.js';
import type { Layout, MatchPlayer, Side } from './types.js';

export interface SeededPlayer extends MatchPlayer {
  /** 1 is the top seed. */
  seed: number;
}

export type PlayoffDecision = 'net' | 'card_match' | 'forfeit' | 'seed' | 'commissioner';

export interface KnockoutResult {
  /** null only when both players were absent: the commissioner decides. */
  winner: Side | null;
  decidedBy: PlayoffDecision;
  net: Record<Side, number | null>;
}

/**
 * Scores a playoff knockout match. An absent player loses. Equal nets are
 * broken by matching cards; if the cards match on every hole, the higher seed
 * advances.
 */
export function scoreKnockout(
  a: SeededPlayer,
  b: SeededPlayer,
  layout: Layout,
  steps: CardStep[] = STANDARD_MATCHING_CARDS,
): KnockoutResult {
  const absentA = a.attendance === 'absent';
  const absentB = b.attendance === 'absent';
  if (absentA && absentB)
    return { winner: null, decidedBy: 'commissioner', net: { A: null, B: null } };

  const strokes = matchStrokes(a.handicap, b.handicap);
  const holes = (p: SeededPlayer, side: Side) => {
    if (!p.holeScores) throw new Error(`Playoff matches need hole scores (player ${p.id})`);
    return netHoleScores(p.holeScores, strokes[side], layout);
  };

  if (absentA || absentB) {
    const winner: Side = absentA ? 'B' : 'A';
    const total = holes(winner === 'A' ? a : b, winner).reduce((s, x) => s + x, 0);
    return {
      winner,
      decidedBy: 'forfeit',
      net: { A: absentA ? null : total, B: absentB ? null : total },
    };
  }

  const netA = holes(a, 'A');
  const netB = holes(b, 'B');
  const net = { A: netA.reduce((s, x) => s + x, 0), B: netB.reduce((s, x) => s + x, 0) };
  if (net.A !== net.B) return { winner: net.A < net.B ? 'A' : 'B', decidedBy: 'net', net };

  const cards = matchingCards({ A: netA, B: netB }, layout, steps);
  if (cards.leaders.length === 1)
    return { winner: cards.leaders[0] as Side, decidedBy: 'card_match', net };
  return { winner: a.seed < b.seed ? 'A' : 'B', decidedBy: 'seed', net };
}

/**
 * Round 1 pairings as seed numbers: 1 v N, 2 v N-1, ... In the league's
 * bracket, winners of matches 1 and 2 meet in round 2, then 3 and 4, and so on.
 */
export function firstRoundSeeds(playerCount: number): [number, number][] {
  if (playerCount < 2 || playerCount % 2 !== 0)
    throw new Error('A knockout needs an even number of players');
  return Array.from(
    { length: playerCount / 2 },
    (_, i) => [i + 1, playerCount - i] as [number, number],
  );
}

/** Pairs the winners of consecutive matches for the next round (match 1 v match 2, ...). */
export function nextRoundPairs<T>(winners: T[]): [T, T][] {
  if (winners.length % 2 !== 0) throw new Error('A knockout round needs an even number of winners');
  return Array.from({ length: winners.length / 2 }, (_, i) => [
    winners[2 * i]!,
    winners[2 * i + 1]!,
  ]);
}

export interface FoursomeStanding {
  id: string;
  strokes: number;
  net: number;
  position: number;
}

export interface FoursomeResult {
  standings: FoursomeStanding[];
  /** null when the tie for first couldn't be broken on the cards or by seed. */
  winner: string | null;
  decidedBy: PlayoffDecision;
}

/**
 * Scores the Finals foursome: each player receives strokes equal to their
 * handicap minus the lowest handicap in the group, and the lowest net wins.
 * A tie for first goes to matching cards, then to the higher seed.
 * Absent players are ranked last.
 */
export function scoreFoursome(
  players: SeededPlayer[],
  layout: Layout,
  steps: CardStep[] = STANDARD_MATCHING_CARDS,
): FoursomeResult {
  const present = players.filter((p) => p.attendance === 'played');
  if (present.length === 0) return { standings: [], winner: null, decidedBy: 'commissioner' };
  const low = Math.min(...present.map((p) => p.handicap));
  const netHoles: Record<string, number[]> = {};
  const rows = present.map((p) => {
    if (!p.holeScores) throw new Error(`Playoff rounds need hole scores (player ${p.id})`);
    const strokes = p.handicap - low;
    netHoles[p.id] = netHoleScores(p.holeScores, strokes, layout);
    return { id: p.id, strokes, net: netHoles[p.id]!.reduce((s, x) => s + x, 0), position: 0 };
  });
  rows.sort((x, y) => x.net - y.net);
  rows.forEach((r) => (r.position = rows.filter((o) => o.net < r.net).length + 1));

  const tiedForFirst = rows.filter((r) => r.position === 1).map((r) => r.id);
  if (tiedForFirst.length === 1)
    return { standings: rows, winner: tiedForFirst[0]!, decidedBy: 'net' };

  const cards = matchingCards(
    Object.fromEntries(tiedForFirst.map((id) => [id, netHoles[id]!])),
    layout,
    steps,
  );
  if (cards.leaders.length === 1)
    return { standings: rows, winner: cards.leaders[0]!, decidedBy: 'card_match' };
  const bySeed = players
    .filter((p) => cards.leaders.includes(p.id))
    .sort((x, y) => x.seed - y.seed);
  return { standings: rows, winner: bySeed[0]!.id, decidedBy: 'seed' };
}
