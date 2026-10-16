import type { Layout, Side } from './types.js';

/** League rule: the higher handicap receives the full difference. */
export function matchStrokes(handicapA: number, handicapB: number): Record<Side, number> {
  return {
    A: Math.max(0, handicapA - handicapB),
    B: Math.max(0, handicapB - handicapA),
  };
}

/**
 * Spreads handicap strokes over the holes of a layout, hardest holes first by
 * stroke index. With more strokes than holes, the extra strokes go round again
 * in the same order. Returns strokes per hole, in playing order.
 */
export function allocateStrokes(strokes: number, layout: Layout): number[] {
  const n = layout.holes.length;
  const byDifficulty = layout.holes
    .map((hole, playIndex) => ({ playIndex, strokeIndex: hole.strokeIndex }))
    .sort((x, y) => x.strokeIndex - y.strokeIndex);
  const perHole = new Array<number>(n).fill(Math.floor(strokes / n));
  byDifficulty.slice(0, strokes % n).forEach(({ playIndex }) => {
    perHole[playIndex]! += 1;
  });
  return perHole;
}

/** Net score per hole: gross minus the strokes allocated to that hole. */
export function netHoleScores(holeScores: number[], strokes: number, layout: Layout): number[] {
  const allocation = allocateStrokes(strokes, layout);
  return holeScores.map((score, i) => score - allocation[i]!);
}
