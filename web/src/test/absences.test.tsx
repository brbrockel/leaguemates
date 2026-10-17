import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;

describe("can't make it (Home)", () => {
  it('marks yourself out with a sub, then back in', async () => {
    let out: { subName: string | null } | null = null;
    const bodies: unknown[] = [];
    const next = () => ({
      seasonId: 's1',
      seasonName: '2027',
      weekId: 'w1',
      groupId: 'g1',
      round: 6,
      rounds: 15,
      playoffRound: null,
      isFinal: false,
      date: '2099-06-03',
      layout: 'Front 9',
      teeTime: '17:00',
      opponent: 'Keith',
      foursome: [['Brian', 'Keith']],
      teeOrder: 1,
      groupsOff: 4,
      bye: false,
      playerId: 'p1',
      out,
    });
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({
        status: 200,
        body: [{ leagueId: LEAGUE, leagueName: 'Wednesday League', next: next() }],
      }),
      [`GET /api/leagues/${LEAGUE}/announcements?limit=50`]: () => ({ status: 200, body: [] }),
      [`PUT /api/leagues/${LEAGUE}/seasons/s1/weeks/w1/absences/p1`]: (init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        out = { subName: body.subName };
        return { status: 200, body: {} };
      },
      [`DELETE /api/leagues/${LEAGUE}/seasons/s1/weeks/w1/absences/p1`]: () => {
        out = null;
        return { status: 200, body: {} };
      },
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Can't make it/ }));
    await userEvent.type(screen.getByLabelText("Sub's name (optional)"), 'Uncle Bob');
    await userEvent.click(screen.getByRole('button', { name: 'Mark me out' }));
    expect(
      await screen.findByText(/You're out this round; Uncle Bob is subbing/),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ subName: 'Uncle Bob' }]);
    await userEvent.click(screen.getByRole('button', { name: 'I can play after all' }));
    expect(await screen.findByRole('button', { name: /Can't make it/ })).toBeInTheDocument();
  });
});
