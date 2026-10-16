import { createRng, shuffle } from '../schedule/random.js';
import { matchingCards } from '../scoring/tiebreak.js';
import type { Layout } from '../scoring/types.js';

export interface ScrambleRule {
  teamSize: number;
  /** Percent of each member's handicap, lowest handicap first, e.g. [20, 15, 10, 5]. */
  allowance: number[];
}

export const DEFAULT_SCRAMBLE_RULE: ScrambleRule = { teamSize: 4, allowance: [20, 15, 10, 5] };

/** Team handicap: each member's share by allowance, lowest handicap first, rounded to nearest. */
export function teamHandicap(handicaps: number[], allowance: number[]): number {
  const sorted = [...handicaps].sort((a, b) => a - b);
  const last = allowance.at(-1) ?? 0;
  const total = sorted.reduce((s, h, i) => s + (h * (allowance[i] ?? last)) / 100, 0);
  return Math.round(total + 1e-9);
}

export interface TeamPlayer {
  id: string;
  handicap: number;
}

/**
 * Splits players into teams of `teamSize` (a team may have one fewer when it doesn't divide),
 * as even as possible by team handicap: a snake draft by handicap, then pairwise swaps while
 * they narrow the gap between the strongest and weakest team. `seed` shuffles players with
 * equal handicaps so a regenerate gives a different mix.
 */
export function balancedTeams(players: TeamPlayer[], rule: ScrambleRule, seed = 1): TeamPlayer[][] {
  const teamCount = Math.max(1, Math.ceil(players.length / rule.teamSize));
  const order = shuffle(players, createRng(seed)).sort((a, b) => a.handicap - b.handicap);
  const teams: TeamPlayer[][] = Array.from({ length: teamCount }, () => []);
  order.forEach((p, i) => {
    const round = Math.floor(i / teamCount);
    const slot = i % teamCount;
    teams[round % 2 === 0 ? slot : teamCount - 1 - slot]!.push(p);
  });

  const hcp = (t: TeamPlayer[]) =>
    teamHandicap(
      t.map((p) => p.handicap),
      rule.allowance,
    );
  const spread = () => {
    const hs = teams.map(hcp);
    return Math.max(...hs) - Math.min(...hs);
  };
  let best = spread();
  for (let improved = true, guard = 0; improved && guard < 200; guard++) {
    improved = false;
    for (let a = 0; a < teamCount && !improved; a++)
      for (let b = a + 1; b < teamCount && !improved; b++)
        for (let i = 0; i < teams[a]!.length && !improved; i++)
          for (let j = 0; j < teams[b]!.length && !improved; j++) {
            [teams[a]![i], teams[b]![j]] = [teams[b]![j]!, teams[a]![i]!];
            const s = spread();
            if (s < best) {
              best = s;
              improved = true;
            } else [teams[a]![i], teams[b]![j]] = [teams[b]![j]!, teams[a]![i]!];
          }
  }
  return teams.map((t) => [...t].sort((x, y) => x.handicap - y.handicap));
}

export interface ScrambleTeamScore {
  id: string;
  handicap: number;
  /** Gross per hole; null for holes not entered. */
  holeScores: (number | null)[];
}

export interface RankedTeam {
  id: string;
  gross: number | null;
  net: number | null;
  /** 1 = winner; teams with incomplete cards have no position. */
  position: number | null;
  /** Set when matching cards (gross, last 6/3/1, countback) separated equal nets. */
  onCards: boolean;
}

/** Lowest net wins; equal nets are separated by matching cards on gross hole scores. */
export function rankScramble(teams: ScrambleTeamScore[], layout: Layout): RankedTeam[] {
  const complete = (t: ScrambleTeamScore) =>
    t.holeScores.length === layout.holes.length && t.holeScores.every((s) => s !== null);
  const scored = teams.map((t) => {
    const gross = complete(t) ? (t.holeScores as number[]).reduce((a, b) => a + b, 0) : null;
    return { t, gross, net: gross === null ? null : gross - t.handicap };
  });
  const done = scored.filter((s) => s.net !== null).sort((a, b) => a.net! - b.net!);
  const out: RankedTeam[] = [];
  let position = 1;
  for (let i = 0; i < done.length;) {
    let tied = done.filter((s) => s.net === done[i]!.net);
    i += tied.length;
    const onCards = tied.length > 1;
    while (tied.length) {
      const { leaders } = matchingCards(
        Object.fromEntries(tied.map((s) => [s.t.id, s.t.holeScores as number[]])),
        layout,
      );
      for (const s of tied.filter((x) => leaders.includes(x.t.id)))
        out.push({ id: s.t.id, gross: s.gross, net: s.net, position, onCards });
      position += leaders.length;
      tied = tied.filter((x) => !leaders.includes(x.t.id));
    }
  }
  for (const s of scored.filter((x) => x.net === null))
    out.push({ id: s.t.id, gross: null, net: null, position: null, onCards: false });
  return out;
}
