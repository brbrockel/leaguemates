import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlayoffBracket, SeasonSchedule } from '@/lib/api';
import { me, mockApi, renderAt } from './render';

const L = me.leagues[0]!.id;
const S = '22222222-2222-4222-8222-222222222222';
const BASE = `/api/leagues/${L}/seasons/${S}`;
const season: SeasonSchedule = {
  season: { id: S, name: '2027', status: 'scheduled', startDate: '2027-04-21', seed: 1 },
  roster: [],
  weeks: [],
  report: null,
};
const p = (playerId: string, nickname: string, seed: number) => ({ playerId, nickname, seed });

function api(bracket: PlayoffBracket, onPost?: (path: string) => PlayoffBracket) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: me }),
    [`GET ${BASE}`]: () => ({ status: 200, body: season }),
    [`GET ${BASE}/results`]: () => ({ status: 200, body: [] }),
    [`GET ${BASE}/playoffs`]: () => ({ status: 200, body: bracket }),
    [`POST ${BASE}/playoffs/start`]: () => ({ status: 201, body: onPost!('start') }),
    [`POST ${BASE}/playoffs/advance`]: () => ({ status: 201, body: onPost!('advance') }),
    [`GET /api/leagues/${L}/seasons`]: () => ({ status: 200, body: [] }),
    'GET /api/me/this-week': () => ({ status: 200, body: [] }),
  });
}

const round1: PlayoffBracket['rounds'][number] = {
  weekId: 'w16',
  round: 1,
  isFinal: false,
  date: '2027-08-04',
  status: 'played',
  groups: [{ id: 'g1', teeTime: '16:30', card: 'submitted' }],
  matches: [
    {
      id: 'm1',
      groupId: 'g1',
      slot: 1,
      a: p('a', 'Richie Jr', 1),
      b: p('h', 'Mike M', 8),
      card: 'submitted',
      winner: 'h',
      decidedBy: 'card_match',
      net: { A: 44, B: 44 },
      decidedReason: null,
    },
    {
      id: 'm2',
      groupId: 'g1',
      slot: 2,
      a: p('b', 'Jerry', 2),
      b: p('g', 'Dickie', 7),
      card: 'submitted',
      winner: 'b',
      decidedBy: 'net',
      net: { A: 40, B: 45 },
      decidedReason: null,
    },
    {
      id: 'm3',
      groupId: 'g2',
      slot: 3,
      a: p('c', 'Paul', 3),
      b: p('f', 'Rick H', 6),
      card: 'submitted',
      winner: 'c',
      decidedBy: 'forfeit',
      net: { A: 41, B: null },
      decidedReason: null,
    },
    {
      id: 'm4',
      groupId: 'g2',
      slot: 4,
      a: p('d', 'Doc', 4),
      b: p('e', 'Tony', 5),
      card: 'submitted',
      winner: 'e',
      decidedBy: 'seed',
      net: { A: 42, B: 42 },
      decidedReason: null,
    },
  ],
};

describe('playoffs card', () => {
  it('admins start the playoffs when the regular season is done', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = api(
      { format: 'knockout', canStart: true, regularRoundsLeft: 0, champion: null, rounds: [] },
      () => ({
        format: 'knockout',
        canStart: false,
        regularRoundsLeft: 0,
        champion: null,
        rounds: [round1],
      }),
    );
    renderAt(`/leagues/${L}/seasons/${S}`);
    await userEvent.click(await screen.findByRole('button', { name: /Start playoffs/ }));
    expect(await screen.findByText(/Won on the cards/)).toBeInTheDocument();
    expect(screen.getByText(/opponent absent/)).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain(`POST ${BASE}/playoffs/start`);
  });

  it('offers the Finals once every match is decided, and shows the champion', async () => {
    const finals: PlayoffBracket['rounds'][number] = {
      weekId: 'w17',
      round: 2,
      isFinal: true,
      date: '2027-08-11',
      status: 'played',
      groups: [{ id: 'gf', teeTime: '16:30', card: 'final' }],
      finalists: [p('b', 'Jerry', 2), p('c', 'Paul', 3), p('e', 'Tony', 5), p('h', 'Mike M', 8)],
      finals: {
        winner: 'c',
        decidedBy: 'net',
        standings: [
          { id: 'c', strokes: 0, net: 38, position: 1, nickname: 'Paul' },
          { id: 'b', strokes: 1, net: 40, position: 2, nickname: 'Jerry' },
        ],
      },
      matches: [],
    };
    api(
      {
        format: 'knockout',
        canStart: false,
        regularRoundsLeft: 0,
        champion: null,
        rounds: [round1],
      },
      () => ({
        format: 'knockout',
        canStart: false,
        regularRoundsLeft: 0,
        champion: { playerId: 'c', nickname: 'Paul' },
        rounds: [round1, finals],
      }),
    );
    renderAt(`/leagues/${L}/seasons/${S}`);
    await userEvent.click(await screen.findByRole('button', { name: /Start the Finals/ }));
    expect(await screen.findByText('Champion')).toBeInTheDocument();
    expect(screen.getAllByText('Paul').length).toBeGreaterThan(0);
  });
});
