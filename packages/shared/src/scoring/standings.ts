import { pointsFor } from './match.js';
import { DEFAULT_POINTS, type Outcome, type PointsRule } from './types.js';

export interface RecordedMatch {
  a: string;
  b: string;
  outcome: Outcome;
}

export interface StandingRow {
  rank: number;
  playerId: string;
  W: number;
  L: number;
  T: number;
  played: number;
  points: number;
}

/** Each player's net score (gross minus handicap) by round, for the tie-break. */
export type NetsByRound = Map<string, Map<number, number>>;

/**
 * Season standings, calculated from match results (never stored).
 * Order: points, then wins, then points in head-to-head matches among the tied players,
 * then the lower total net over the rounds all of them played (league rule, 2026-10-16),
 * then player id so the order is always stable.
 */
export function computeStandings(
  playerIds: string[],
  matches: RecordedMatch[],
  rule: PointsRule = DEFAULT_POINTS,
  nets: NetsByRound = new Map(),
): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    playerIds.map((id) => [id, { rank: 0, playerId: id, W: 0, L: 0, T: 0, played: 0, points: 0 }]),
  );
  const row = (id: string) => {
    const r = rows.get(id);
    if (!r) throw new Error(`Match references unknown player ${id}`);
    return r;
  };

  for (const m of matches) {
    for (const [id, side] of [
      [m.a, 'A'],
      [m.b, 'B'],
    ] as const) {
      const r = row(id);
      r.played += 1;
      r.points += pointsFor(m.outcome, side, rule);
      if (m.outcome === 'T') r.T += 1;
      else if (m.outcome === side) r.W += 1;
      else r.L += 1;
    }
  }

  const headToHead = (id: string, group: Set<string>) =>
    matches.reduce((sum, m) => {
      if (m.a === id && group.has(m.b)) return sum + pointsFor(m.outcome, 'A', rule);
      if (m.b === id && group.has(m.a)) return sum + pointsFor(m.outcome, 'B', rule);
      return sum;
    }, 0);

  const sorted = [...rows.values()].sort((x, y) => y.points - x.points || y.W - x.W);
  const result: StandingRow[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (
      j < sorted.length &&
      sorted[j]!.points === sorted[i]!.points &&
      sorted[j]!.W === sorted[i]!.W
    )
      j++;
    const tied = sorted.slice(i, j);
    const group = new Set(tied.map((r) => r.playerId));
    // Rounds every tied player has a net score for, so missed rounds don't help anyone.
    const shared = [...(nets.get(tied[0]!.playerId)?.keys() ?? [])].filter((round) =>
      tied.every((r) => nets.get(r.playerId)?.has(round)),
    );
    const totalNet = (id: string) => shared.reduce((sum, rd) => sum + nets.get(id)!.get(rd)!, 0);
    tied.sort(
      (x, y) =>
        headToHead(y.playerId, group) - headToHead(x.playerId, group) ||
        totalNet(x.playerId) - totalNet(y.playerId) ||
        x.playerId.localeCompare(y.playerId),
    );
    result.push(...tied);
    i = j;
  }
  result.forEach((r, i) => (r.rank = i + 1));
  return result;
}
