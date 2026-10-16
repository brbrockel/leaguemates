/** One side of a head-to-head match. */
export type Side = 'A' | 'B';

/** Match outcome from side A's point of view: A won, B won, or tie. */
export type Outcome = Side | 'T';

export interface Hole {
  /** Hole number on the course card (1–18). */
  number: number;
  par: number;
  /** Difficulty rank from the course card: 1 is the hardest hole. */
  strokeIndex: number;
}

/** A nine (or eighteen) as played, holes in playing order. */
export interface Layout {
  name: string;
  holes: Hole[];
}

export interface PointsRule {
  win: number;
  tie: number;
  loss: number;
}

export const DEFAULT_POINTS: PointsRule = { win: 3, tie: 1, loss: 0 };

export type Attendance = 'played' | 'absent';

export interface MatchPlayer {
  id: string;
  handicap: number;
  attendance: Attendance;
  /** Gross score per hole, in playing order. Takes precedence over `gross`. */
  holeScores?: number[];
  /** Gross total, when hole scores weren't recorded (e.g. imported history). */
  gross?: number;
}

export function coursePar(layout: Layout): number {
  return layout.holes.reduce((sum, h) => sum + h.par, 0);
}

export function grossScore(player: MatchPlayer): number {
  if (player.holeScores) return player.holeScores.reduce((sum, s) => sum + s, 0);
  if (player.gross !== undefined) return player.gross;
  throw new Error(`No score recorded for player ${player.id}`);
}
