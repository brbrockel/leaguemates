import {
  par5sFirst,
  scoreFoursome,
  scoreKnockout,
  STANDARD_MATCHING_CARDS,
  type CardStep,
  type Layout,
  type LeagueSettings,
  type PlayoffDecision,
  type SeededPlayer,
} from '@teemate/shared';
import { isComplete, type RoundData } from '../scorecards/results.js';

export interface PlayoffMatchRef {
  id: string;
  playerA: string;
  playerB: string;
  seedA: number | null;
  seedB: number | null;
  bracketSlot: number | null;
  decidedWinnerId: string | null;
}

export interface KnockoutOut {
  winner: string | null;
  decidedBy: PlayoffDecision | null;
  net: { A: number | null; B: number | null };
}

export function tiebreakSteps(settings: LeagueSettings, layout: Layout): CardStep[] {
  return settings.playoffs.tiebreak === 'par5s_first'
    ? par5sFirst(layout)
    : STANDARD_MATCHING_CARDS;
}

const seeded = (r: RoundData, seed: number): SeededPlayer => ({
  id: r.playerId,
  seed,
  handicap: r.handicap,
  attendance: r.attendance,
  ...(r.attendance === 'played' ? { holeScores: r.holeScores as number[] } : {}),
});

/** Winner of a knockout match: an admin decision, else the playoff rules once both cards are complete. */
export function knockoutResult(
  m: PlayoffMatchRef,
  rounds: RoundData[],
  layout: Layout,
  settings: LeagueSettings,
): KnockoutOut {
  if (m.decidedWinnerId)
    return { winner: m.decidedWinnerId, decidedBy: 'commissioner', net: { A: null, B: null } };
  const a = rounds.find((r) => r.playerId === m.playerA);
  const b = rounds.find((r) => r.playerId === m.playerB);
  if (!a || !b || !isComplete(a) || !isComplete(b))
    return { winner: null, decidedBy: null, net: { A: null, B: null } };
  const r = scoreKnockout(
    seeded(a, m.seedA ?? 99),
    seeded(b, m.seedB ?? 99),
    layout,
    tiebreakSteps(settings, layout),
  );
  return {
    winner: r.winner === 'A' ? m.playerA : r.winner === 'B' ? m.playerB : null,
    decidedBy: r.winner ? r.decidedBy : 'commissioner',
    net: r.net,
  };
}

/** The Finals foursome: strokes from the lowest handicap, lowest net wins, ties by cards then seed. */
export function finalsResult(
  players: { playerId: string; seed: number }[],
  rounds: RoundData[],
  layout: Layout,
  settings: LeagueSettings,
  decidedWinnerId: string | null,
) {
  if (decidedWinnerId)
    return { winner: decidedWinnerId, decidedBy: 'commissioner' as const, standings: [] };
  const rs = players.map((p) => ({ p, r: rounds.find((x) => x.playerId === p.playerId) }));
  if (rs.some(({ r }) => !r || !isComplete(r))) return null;
  const result = scoreFoursome(
    rs.map(({ p, r }) => seeded(r!, p.seed)),
    layout,
    tiebreakSteps(settings, layout),
  );
  return { winner: result.winner, decidedBy: result.decidedBy, standings: result.standings };
}
