import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  matchPlayer,
  parseOcrText,
  readWithClaude,
  type CardContext,
} from '../src/scorecards/card-reader.js';

const ctx: CardContext = {
  players: [
    { playerId: 'p-jerry', nickname: 'Jerry', fullName: null, handicap: 7 },
    { playerId: 'p-mikeb', nickname: 'Mike B', fullName: 'Michael Brown', handicap: 16 },
    { playerId: 'p-mikem', nickname: 'Mike M', fullName: null, handicap: 8 },
    { playerId: 'p-doc', nickname: 'Doc', fullName: 'David M. Rinaldi', handicap: 7 },
  ],
  layouts: [
    {
      id: 'front',
      name: 'Front 9',
      holes: [5, 4, 4, 3, 4, 5, 3, 4, 4].map((par, i) => ({ number: i + 1, par })),
    },
    {
      id: 'back',
      name: 'Back 9',
      holes: [5, 4, 3, 5, 4, 4, 3, 4, 4].map((par, i) => ({ number: i + 10, par })),
    },
  ],
  plannedLayoutId: 'front',
};

describe('matching handwritten names', () => {
  it('handles nicknames, initials, full names and small misspellings', () => {
    expect(matchPlayer('Jerry', ctx.players)).toBe('p-jerry');
    expect(matchPlayer('Jery', ctx.players)).toBe('p-jerry');
    expect(matchPlayer('Mike B.', ctx.players)).toBe('p-mikeb');
    expect(matchPlayer('MikeM', ctx.players)).toBe('p-mikem');
    expect(matchPlayer('Rinaldi', ctx.players)).toBe('p-doc');
    expect(matchPlayer('Zed', ctx.players)).toBeNull();
  });
});

describe('OCR fallback parsing', () => {
  it('finds name lines and splits run-together digits; everything is marked to check', () => {
    const rows = parseOcrText(
      'HOLE 1 2 3 4 5 6 7 8 9\nJerry544356345\nMike B 6 5 5 4 4 7 4 5 6\nPar 5 4 4 3',
      ctx,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ playerId: 'p-jerry', holeScores: [5, 4, 4, 3, 5, 6, 3, 4, 5] });
    expect(rows[1]).toMatchObject({ playerId: 'p-mikeb', holeScores: [6, 5, 5, 4, 4, 7, 4, 5, 6] });
    expect(rows[0]!.uncertain).toHaveLength(9);
  });
});

describe('Claude reading', () => {
  it('uses the structured answer: nine from the hole numbers, ids checked, bad values dropped', async () => {
    let asked: unknown;
    const fake = {
      messages: {
        create: async (req: unknown) => {
          asked = req;
          return {
            content: [
              {
                type: 'tool_use',
                name: 'record_scores',
                input: {
                  holeNumbers: [10, 11, 12, 13, 14, 15, 16, 17, 18],
                  rows: [
                    {
                      nameOnCard: 'Jerry',
                      playerId: 'p-jerry',
                      scores: [5, 4, 3, 6, 4, 5, 3, 4, 5],
                      uncertain: [3],
                      absent: false,
                    },
                    {
                      nameOnCard: 'Doc',
                      playerId: 'made-up-id',
                      scores: [6, 5, 4, 6, 5, 5, 99, null, 5],
                      uncertain: [],
                      absent: false,
                    },
                    {
                      nameOnCard: 'Mike M',
                      playerId: 'p-mikem',
                      scores: [],
                      uncertain: [],
                      absent: true,
                    },
                  ],
                  notes: 'Hole 13 for Jerry could be a 5.',
                },
              },
            ],
          };
        },
      },
    } as unknown as Anthropic;
    const r = await readWithClaude(fake, 'claude-sonnet-5-5', Buffer.from('jpeg'), ctx);
    expect(r).toMatchObject({
      provider: 'claude',
      layoutId: 'back',
      notes: ['Hole 13 for Jerry could be a 5.'],
    });
    expect(r.rows[0]).toMatchObject({ playerId: 'p-jerry', uncertain: [3] });
    // An unknown id falls back to name matching; impossible scores become blanks to check.
    expect(r.rows[1]).toMatchObject({
      playerId: 'p-doc',
      holeScores: [6, 5, 4, 6, 5, 5, null, null, 5],
    });
    expect(r.rows[1]!.uncertain).toEqual([6, 7]);
    expect(r.rows[2]).toMatchObject({ playerId: 'p-mikem', absent: true, uncertain: [] });
    expect(JSON.stringify(asked)).toContain('"name":"record_scores"');
  });
});
