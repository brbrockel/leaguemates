import type { Pairing } from './roundRobin.js';

/** A playing group: two matches (a foursome), or one match when the count is odd. */
export type Group = Pairing[];

const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Pairs of players who share a group but aren't opponents. */
function crossPairs(group: Group): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++)
      for (const x of group[i]!) for (const y of group[j]!) out.push([x, y]);
  return out;
}

/** How many times each pair of players shared a group without playing each other. */
export function groupMateCounts(weeks: Group[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const week of weeks)
    for (const group of week)
      for (const [x, y] of crossPairs(group))
        counts.set(key(x, y), (counts.get(key(x, y)) ?? 0) + 1);
  return counts;
}

function initialGroups(pairings: Pairing[]): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < pairings.length; i += 2) groups.push(pairings.slice(i, i + 2));
  return groups;
}

/**
 * Puts each week's matches into foursomes so players share the course with as
 * many different people as possible over the season. Minimises the sum of
 * squared group-mate counts with simulated annealing: a move swaps two matches
 * between two groups in the same week.
 */
export function assignFoursomes(
  weeklyPairings: Pairing[][],
  rng: () => number,
  iterations = 40_000,
): Group[][] {
  const weeks = weeklyPairings.map(initialGroups);
  const counts = groupMateCounts(weeks);
  /** Adds `delta` to each cross pair's count; returns the change in total cost (sum of squares). */
  const bump = (group: Group, delta: number) => {
    let change = 0;
    for (const [x, y] of crossPairs(group)) {
      const k = key(x, y);
      const c = counts.get(k) ?? 0;
      counts.set(k, c + delta);
      change += (c + delta) ** 2 - c ** 2;
    }
    return change;
  };
  const swap = (a: Group, b: Group, i: number, j: number) => {
    let change = bump(a, -1) + bump(b, -1);
    [a[i], b[j]] = [b[j]!, a[i]!];
    change += bump(a, 1) + bump(b, 1);
    return change;
  };

  const movable = weeks.map((_, i) => i).filter((i) => weeks[i]!.length > 1);
  if (movable.length === 0) return weeks;

  let temperature = 2;
  const cooling = Math.pow(0.01 / temperature, 1 / iterations);
  for (let it = 0; it < iterations; it++, temperature *= cooling) {
    const week = weeks[movable[Math.floor(rng() * movable.length)]!]!;
    const g1 = Math.floor(rng() * week.length);
    let g2 = Math.floor(rng() * (week.length - 1));
    if (g2 >= g1) g2++;
    const a = week[g1]!;
    const b = week[g2]!;
    const i = Math.floor(rng() * a.length);
    const j = Math.floor(rng() * b.length);

    const change = swap(a, b, i, j);
    if (change > 0 && rng() >= Math.exp(-change / temperature)) swap(a, b, i, j);
  }
  return weeks;
}

/** Worst case first, then total spread: lower is better. */
export function groupingScore(weeks: Group[][]): [number, number] {
  const counts = [...groupMateCounts(weeks).values()];
  return [Math.max(0, ...counts), counts.reduce((sum, c) => sum + c * c, 0)];
}

/** Runs the optimiser several times and keeps the best result. */
export function bestFoursomes(
  weeklyPairings: Pairing[][],
  rng: () => number,
  restarts = 6,
): Group[][] {
  let best: Group[][] | undefined;
  let bestScore: [number, number] = [Infinity, Infinity];
  for (let r = 0; r < restarts; r++) {
    const candidate = assignFoursomes(weeklyPairings, rng);
    const score = groupingScore(candidate);
    if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = candidate;
      bestScore = score;
    }
  }
  return best!;
}
