import { describe, expect, it } from 'vitest';
import { isComplete, matchResults } from '../src/scorecards/results.js';

const PAR36 = {
  name: 'Front 9',
  holes: [5, 4, 4, 3, 4, 5, 3, 4, 4].map((par, i) => ({ number: i + 1, par, strokeIndex: i + 1 })),
};
const round = (
  playerId: string,
  handicap: number,
  gross: number | null,
  attendance: 'played' | 'absent' = 'played',
) => ({
  playerId,
  handicap,
  attendance,
  holeScores: [] as (number | null)[],
  gross,
});

describe('imported (total-only) rounds', () => {
  it('scores from totals when there are no hole scores', () => {
    const [m] = matchResults(
      [{ id: 'm', playerA: 'a', playerB: 'b' }],
      [round('a', 6, 44), round('b', 14, 54)],
      PAR36,
    );
    // b gets 8 strokes: 46 net v 44.
    expect(m!.result).toMatchObject({ outcome: 'A', decidedBy: 'net', net: { A: 44, B: 46 } });
  });

  it('a total of null is incomplete unless the player was absent', () => {
    expect(isComplete(round('a', 6, null))).toBe(false);
    expect(isComplete(round('a', 6, null, 'absent'))).toBe(true);
  });

  it('the officially recorded result wins over re-scoring (e.g. an unrecorded absence)', () => {
    const [m] = matchResults(
      [{ id: 'm', playerA: 'a', playerB: 'b', recordedOutcome: 'T' }],
      [round('a', 6, 44), round('b', 14, 54)],
      PAR36,
    );
    expect(m!.result).toMatchObject({ outcome: 'T', decidedBy: 'official', net: { A: 44, B: 46 } });
  });

  it('an official result stands even with no scores at all', () => {
    const [m] = matchResults(
      [{ id: 'm', playerA: 'a', playerB: 'b', recordedOutcome: 'B' }],
      [round('a', 6, null), round('b', 14, null)],
      PAR36,
    );
    expect(m!.result).toMatchObject({
      outcome: 'B',
      decidedBy: 'official',
      net: { A: null, B: null },
    });
  });

  it('when the recorded result agrees with the scores, the scoring reason is kept', () => {
    const [m] = matchResults(
      [{ id: 'm', playerA: 'a', playerB: 'b', recordedOutcome: 'A' }],
      [round('a', 6, 44), round('b', 14, 54)],
      PAR36,
    );
    expect(m!.result!.decidedBy).toBe('net');
  });
});
