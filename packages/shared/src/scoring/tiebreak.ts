import type { Layout } from './types.js';

/**
 * One step of a matching-cards tiebreak:
 * - `last`: total net over the last N holes played
 * - `holes`: total net over specific hole numbers (e.g. the par 5s)
 * - `countback`: compare single holes going backwards, starting before the last hole
 */
export type CardStep =
  { kind: 'last'; holes: number } | { kind: 'holes'; numbers: number[] } | { kind: 'countback' };

/** The standard method: last 6, last 3, last hole, then hole by hole backwards. */
export const STANDARD_MATCHING_CARDS: CardStep[] = [
  { kind: 'last', holes: 6 },
  { kind: 'last', holes: 3 },
  { kind: 'last', holes: 1 },
  { kind: 'countback' },
];

/** League option: the layout's par 5s first, then the standard method. */
export function par5sFirst(layout: Layout): CardStep[] {
  const numbers = layout.holes.filter((h) => h.par === 5).map((h) => h.number);
  return numbers.length
    ? [{ kind: 'holes', numbers }, ...STANDARD_MATCHING_CARDS]
    : STANDARD_MATCHING_CARDS;
}

export interface CardResult {
  /** Players still tied after all steps (one id when the tie was broken). */
  leaders: string[];
  /** Index of the step that broke the tie, or null if it never broke. */
  decidedAtStep: number | null;
}

/**
 * Breaks a tie between players with equal net totals by comparing their net
 * hole scores ("matching cards"). Works for two players or a whole foursome:
 * each step keeps only the players with the lowest total.
 */
export function matchingCards(
  netHoles: Record<string, number[]>,
  layout: Layout,
  steps: CardStep[] = STANDARD_MATCHING_CARDS,
): CardResult {
  const n = layout.holes.length;
  let leaders = Object.keys(netHoles);

  const keepLowest = (scoreOf: (id: string) => number) => {
    const best = Math.min(...leaders.map(scoreOf));
    leaders = leaders.filter((id) => scoreOf(id) === best);
  };
  const sum = (id: string, indexes: number[]) => indexes.reduce((s, i) => s + netHoles[id]![i]!, 0);

  for (const [stepIndex, step] of steps.entries()) {
    if (step.kind === 'countback') {
      for (let i = n - 2; i >= 0 && leaders.length > 1; i--) keepLowest((id) => netHoles[id]![i]!);
    } else {
      const indexes =
        step.kind === 'last'
          ? Array.from({ length: Math.min(step.holes, n) }, (_, k) => n - 1 - k)
          : layout.holes.flatMap((h, i) => (step.numbers.includes(h.number) ? [i] : []));
      keepLowest((id) => sum(id, indexes));
    }
    if (leaders.length === 1) return { leaders, decidedAtStep: stepIndex };
  }
  return { leaders, decidedAtStep: null };
}
