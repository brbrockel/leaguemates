import { scoreMatch, type Layout, type MatchResult, type Outcome } from '@teemate/shared';

export interface RoundData {
  playerId: string;
  handicap: number;
  attendance: 'played' | 'absent';
  holeScores: (number | null)[];
  /** Total only (imported history), when there are no hole scores. */
  gross?: number | null;
}

export interface MatchRef {
  id: string;
  playerA: string;
  playerB: string;
  /** Official result recorded by the league (imported history). */
  recordedOutcome?: Outcome | null;
}

export type MatchResultOut = Omit<MatchResult, 'decidedBy'> & {
  decidedBy: MatchResult['decidedBy'] | 'official';
};

const hasHoles = (r: RoundData) => r.holeScores.length > 0;

/** A round is complete when the player was absent, has a total, or has every hole. */
export const isComplete = (r: RoundData) =>
  r.attendance === 'absent' ||
  (hasHoles(r) ? r.holeScores.every((s) => s !== null) : r.gross !== null && r.gross !== undefined);

export const grossOf = (r: RoundData): number | null =>
  r.attendance !== 'played' || !isComplete(r)
    ? null
    : hasHoles(r)
      ? (r.holeScores as number[]).reduce((a, b) => a + b, 0)
      : (r.gross ?? null);

/**
 * Results for a group's matches. A match is scored with the shared league rules
 * once both rounds are complete. An officially recorded result always wins,
 * because history doesn't say who was absent.
 */
export function matchResults(matches: MatchRef[], rounds: RoundData[], layout: Layout) {
  const byPlayer = new Map(rounds.map((r) => [r.playerId, r]));
  return matches.map((m) => {
    const a = byPlayer.get(m.playerA);
    const b = byPlayer.get(m.playerB);
    let result: MatchResultOut | null = null;
    if (a && b && isComplete(a) && isComplete(b)) {
      const toPlayer = (r: RoundData) => ({
        id: r.playerId,
        handicap: r.handicap,
        attendance: r.attendance,
        ...(r.attendance === 'played'
          ? hasHoles(r)
            ? { holeScores: r.holeScores as number[] }
            : { gross: r.gross! }
          : {}),
      });
      result = scoreMatch(toPlayer(a), toPlayer(b), layout);
    }
    if (m.recordedOutcome) {
      const base = result ?? { strokes: { A: 0, B: 0 }, net: { A: null, B: null } };
      result = {
        ...base,
        outcome: m.recordedOutcome,
        decidedBy: result && result.outcome === m.recordedOutcome ? result.decidedBy : 'official',
      };
    }
    return { id: m.id, playerA: m.playerA, playerB: m.playerB, result };
  });
}
