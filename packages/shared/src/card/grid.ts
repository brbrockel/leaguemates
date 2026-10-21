/** A point on a picture, as fractions of its width and height (0–1 from the top left). */
export type GridPoint = [x: number, y: number];

/**
 * Where a nine's scores go on a picture of the course's printed card, from a few taps:
 * the first hole's box on each player line (cards often split the lines with a par or
 * handicap row, so each line has its own), the last hole's box on the first line, and
 * optionally the total box and where the name goes on the first line. Holes in between are
 * evenly spaced, and every line repeats the first line's spacing.
 */
export interface CardGrid {
  /** The first hole's box on each player line, top to bottom. */
  rows: GridPoint[];
  /** The last hole's box on the first line. */
  last: GridPoint;
  /** The total (Out/In) box on the first line. */
  total: GridPoint | null;
  /** Where the name goes on the first line. */
  name: GridPoint | null;
  /**
   * Fold-over cards: this nine's panel has no name column and folds over another nine's
   * card, whose name column then sits beside it (that layout's id).
   */
  nameFrom?: string | null;
}

/** A card picture with its grid: what a fold-over joins. */
export interface GridPicture {
  grid: CardGrid;
  width: number;
  height: number;
  /** Holes in that nine. */
  holes: number;
}

/**
 * How another nine's name column sits beside a fold-over panel, in the panel picture's
 * pixels: the other picture is scaled so its player lines are as far apart as the panel's,
 * moved so its first line is level with the panel's, and cut just before its first hole box.
 */
export function foldOver(panel: GridPicture, names: GridPicture) {
  const span = (p: GridPicture) => {
    const rs = p.grid.rows;
    return rs.length > 1 ? (rs[rs.length - 1]![1] - rs[0]![1]) * p.height : 0;
  };
  const scale =
    span(panel) > 0 && span(names) > 0 ? span(panel) / span(names) : panel.height / names.height;
  const first = names.grid.rows[0]!;
  const holeGap = (names.grid.last[0] - first[0]) / Math.max(1, names.holes - 1);
  /** Where the strip is cut, in the names picture's pixels. */
  const cut = Math.max(0, (first[0] - holeGap / 2) * names.width);
  return {
    scale,
    /** The strip's width once scaled. */
    width: cut * scale,
    /** The names picture's top edge, from the panel's top. */
    top: panel.grid.rows[0]![1] * panel.height - first[1] * names.height * scale,
    /** Where names are written, from the strip's left edge. */
    nameX: (names.grid.name?.[0] ?? first[0] / 10) * names.width * scale,
  };
}

export const CARD_GRID_MAX_ROWS = 6;

const add = (p: GridPoint, q: GridPoint, k = 1): GridPoint => [p[0] + q[0] * k, p[1] + q[1] * k];
const sub = (p: GridPoint, q: GridPoint): GridPoint => [p[0] - q[0], p[1] - q[1]];

/** The centre of hole `index`'s box (0-based, of `holes`) on player line `row`. */
export function gridHole(grid: CardGrid, holes: number, row: number, index: number): GridPoint {
  const step = holes > 1 ? 1 / (holes - 1) : 0;
  return add(lineStart(grid, row), sub(grid.last, grid.rows[0]!), index * step);
}

/** Where `grid.total` or `grid.name` falls on player line `row`. */
export function gridOffset(grid: CardGrid, row: number, at: GridPoint): GridPoint {
  return add(lineStart(grid, row), sub(at, grid.rows[0]!));
}

/** A line past the last tapped one continues the spacing of the last two. */
function lineStart(grid: CardGrid, row: number): GridPoint {
  const rs = grid.rows;
  if (row < rs.length) return rs[row]!;
  const lastGap =
    rs.length > 1 ? sub(rs[rs.length - 1]!, rs[rs.length - 2]!) : ([0, 0.05] as GridPoint);
  return add(rs[rs.length - 1]!, lastGap, row - rs.length + 1);
}

/**
 * How big a box is, as a fraction of the picture's width: the smaller of the gap between
 * holes and the gap between lines (a picture `aspect` = height / width).
 */
export function gridBox(grid: CardGrid, holes: number, aspect: number): number {
  const across = sub(grid.last, grid.rows[0]!);
  const holeGap = Math.hypot(across[0], across[1] * aspect) / Math.max(1, holes - 1);
  let lineGap = Infinity;
  for (let i = 1; i < grid.rows.length; i++) {
    const d = sub(grid.rows[i]!, grid.rows[i - 1]!);
    lineGap = Math.min(lineGap, Math.hypot(d[0], d[1] * aspect));
  }
  return Math.min(holeGap, lineGap);
}
