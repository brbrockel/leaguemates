import type { Layout } from '../src/index.js';

const holes = (numbers: number[], pars: number[], strokeIndex: number[]) =>
  numbers.map((number, i) => ({ number, par: pars[i]!, strokeIndex: strokeIndex[i]! }));

/** Timberlin Golf Club, Berlin CT (doc/reference/Timberlin.md). */
export const TIMBERLIN_FRONT: Layout = {
  name: 'Timberlin Front 9',
  holes: holes(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [5, 4, 4, 3, 4, 5, 3, 4, 4],
    [3, 5, 11, 17, 9, 1, 15, 13, 7],
  ),
};

export const TIMBERLIN_BACK: Layout = {
  name: 'Timberlin Back 9',
  holes: holes(
    [10, 11, 12, 13, 14, 15, 16, 17, 18],
    [5, 4, 3, 5, 4, 4, 3, 4, 4],
    [10, 14, 16, 2, 4, 6, 18, 12, 8],
  ),
};
