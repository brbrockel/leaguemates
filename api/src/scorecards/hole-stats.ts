/**
 * Hole-by-hole statistics from entered cards (EH-014): how each hole plays (average, over
 * par, difficulty rank and the mix of results) and, for one player, their average per hole
 * against the field. Only cards with hole scores count, so imported history (totals only)
 * doesn't appear here.
 */

export interface HoleInfo {
  number: number;
  par: number;
  strokeIndex: number;
}

export interface HoleRound {
  layoutId: string;
  playerId: string;
  holeScores: (number | null)[];
}

export interface HoleStat extends HoleInfo {
  /** Scores counted on this hole. */
  n: number;
  avg: number | null;
  /** Average strokes over par (negative: plays under par). */
  toPar: number | null;
  /** 1 = plays hardest relative to par, among the holes with scores. */
  rank: number | null;
  /** Share of scores: birdie or better, par, bogey, double bogey or worse. */
  mix: { birdie: number; par: number; bogey: number; double: number };
  /** The chosen player's average here, and how many of their scores. */
  mine: { n: number; avg: number | null } | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function holeStats(holes: HoleInfo[], rounds: HoleRound[], playerId?: string): HoleStat[] {
  const raw: (number | null)[] = [];
  const stats: HoleStat[] = holes.map((h, i) => {
    const all: number[] = [];
    const theirs: number[] = [];
    for (const r of rounds) {
      const s = r.holeScores[i];
      if (typeof s !== 'number' || s <= 0) continue;
      all.push(s);
      if (r.playerId === playerId) theirs.push(s);
    }
    const n = all.length;
    const avg = n ? all.reduce((a, b) => a + b, 0) / n : null;
    raw.push(avg === null ? null : avg - h.par);
    const share = (pred: (d: number) => boolean) =>
      n ? round2(all.filter((s) => pred(s - h.par)).length / n) : 0;
    return {
      ...h,
      n,
      avg: avg === null ? null : round2(avg),
      toPar: avg === null ? null : round2(avg - h.par),
      rank: null,
      mix: {
        birdie: share((d) => d <= -1),
        par: share((d) => d === 0),
        bogey: share((d) => d === 1),
        double: share((d) => d >= 2),
      },
      mine:
        playerId === undefined
          ? null
          : {
              n: theirs.length,
              avg: theirs.length ? round2(theirs.reduce((a, b) => a + b, 0) / theirs.length) : null,
            },
    };
  });
  // Hardest first (unrounded); ties go to the lower stroke index, the card's own ranking.
  stats
    .map((s, i) => ({ s, over: raw[i] }))
    .filter((x): x is { s: HoleStat; over: number } => x.over !== null)
    .sort((a, b) => b.over - a.over || a.s.strokeIndex - b.s.strokeIndex)
    .forEach((x, i) => (x.s.rank = i + 1));
  return stats;
}
