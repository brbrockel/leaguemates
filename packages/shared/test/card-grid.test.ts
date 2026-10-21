import { describe, expect, it } from 'vitest';
import { foldOver, gridBox, gridHole, gridOffset, type CardGrid } from '../src/index.js';

// A card like Timberlin's front: two lines above the par row and two below it.
const grid: CardGrid = {
  rows: [
    [0.2, 0.4],
    [0.2, 0.45],
    [0.2, 0.6],
    [0.2, 0.65],
  ],
  last: [0.6, 0.4],
  total: [0.65, 0.4],
  name: [0.05, 0.4],
};

describe('card grid', () => {
  it('spaces the holes evenly along each line', () => {
    expect(gridHole(grid, 9, 0, 0)).toEqual([0.2, 0.4]);
    expect(gridHole(grid, 9, 0, 8)).toEqual([0.6, 0.4]);
    const h5 = gridHole(grid, 9, 2, 4);
    expect(h5[0]).toBeCloseTo(0.4);
    expect(h5[1]).toBeCloseTo(0.6);
  });

  it('puts totals and names on every line, and continues past the last tapped line', () => {
    expect(gridOffset(grid, 3, grid.total!)).toEqual([0.65, 0.65]);
    expect(gridOffset(grid, 1, grid.name!)[0]).toBeCloseTo(0.05);
    const fifth = gridHole(grid, 9, 4, 0);
    expect(fifth[1]).toBeCloseTo(0.7);
  });

  it('follows a picture taken at a slight angle', () => {
    const tilted: CardGrid = { rows: [[0.1, 0.5]], last: [0.9, 0.58], total: null, name: null };
    expect(gridHole(tilted, 9, 0, 4)[1]).toBeCloseTo(0.54);
  });

  it('sizes a box by the tighter of the hole and line gaps', () => {
    // Holes 0.05 apart across; lines 0.05 of the height apart on a picture half as tall as wide.
    expect(gridBox(grid, 9, 0.5)).toBeCloseTo(0.025);
    expect(gridBox(grid, 9, 2)).toBeCloseTo(0.05);
  });

  it("puts another nine's name column beside a fold-over panel, lines level", () => {
    // Timberlin: the front has the names; the back panel starts at hole 10.
    const front = { grid, width: 1000, height: 400, holes: 9 };
    const back: CardGrid = {
      rows: [
        [0.05, 0.42],
        [0.05, 0.52],
      ],
      last: [0.45, 0.42],
      total: null,
      name: null,
      nameFrom: 'front',
    };
    // The back's lines span 40 px; the front's span 100 px: scale 0.4.
    const f = foldOver({ grid: back, width: 1000, height: 400, holes: 9 }, front);
    expect(f.scale).toBeCloseTo(0.4);
    const g = foldOver(
      {
        grid: {
          ...back,
          rows: [
            [0.05, 0.42],
            [0.05, 0.455],
          ],
        },
        width: 1000,
        height: 400,
        holes: 9,
      },
      { ...front, grid: { ...grid, rows: grid.rows.slice(0, 2) } },
    );
    expect(g.scale).toBeCloseTo(0.7);
    // Cut half a hole before hole 1 (holes are 50 px apart): 175 px, scaled.
    expect(g.width).toBeCloseTo(175 * 0.7);
    // The front's first line (160 px down, scaled) lands on the back's (168 px).
    expect(g.top + 160 * 0.7).toBeCloseTo(168);
    expect(g.nameX).toBeCloseTo(50 * 0.7);
  });
});
