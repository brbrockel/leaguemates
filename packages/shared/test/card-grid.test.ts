import { describe, expect, it } from 'vitest';
import { gridBox, gridHole, gridOffset, type CardGrid } from '../src/index.js';

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
});
