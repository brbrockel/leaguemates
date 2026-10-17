import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SeasonSchedule } from '@/lib/api';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;
const SEASON = '22222222-2222-4222-8222-222222222222';
const P = (n: number) => `p${n}`;
const roster = ['Brian', 'Doc', 'Jerry', 'Paul'].map((nickname, i) => ({
  playerId: P(i + 1),
  spot: i + 1,
  nickname,
  fullName: null,
  handicap: 10,
  userId: i === 0 ? me.user.id : null,
}));
const week = (
  round: number,
  date: string,
  layout: string,
  a: [number, number],
  b: [number, number],
) => ({
  id: `w${round}`,
  round,
  date,
  status: 'scheduled' as const,
  layout,
  playoffRound: null,
  isFinal: false,
  groups: [
    {
      id: `g${round}a`,
      slot: 0,
      teeTime: '16:30',
      matches: [{ id: `m${round}a`, playerA: P(a[0]), playerB: P(a[1]) }],
    },
    {
      id: `g${round}b`,
      slot: 1,
      teeTime: '16:39',
      matches: [{ id: `m${round}b`, playerA: P(b[0]), playerB: P(b[1]) }],
    },
  ],
});
const generated = (status: 'draft' | 'scheduled'): SeasonSchedule => ({
  season: { id: SEASON, name: '2027', status, startDate: '2099-04-21', seed: 7 },
  roster,
  weeks: [
    week(1, '2099-04-21', 'Front 9', [1, 2], [3, 4]),
    week(2, '2099-04-28', 'Back 9', [3, 1], [2, 4]),
  ],
  report: {
    pairsMet: 6,
    possiblePairs: 6,
    maxOpponentRepeats: 1,
    maxGroupMateRepeats: 2,
    everyoneTeesFirstAndLast: true,
  },
});

describe('season page', () => {
  it('admins generate the schedule, review the report, and lock it', async () => {
    let state: SeasonSchedule = { ...generated('draft'), weeks: [], report: null };
    const posts: string[] = [];
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({ status: 200, body: state }),
      [`POST /api/leagues/${LEAGUE}/seasons/${SEASON}/generate`]: () => {
        posts.push('generate');
        state = generated('draft');
        return { status: 201, body: state };
      },
      [`POST /api/leagues/${LEAGUE}/seasons/${SEASON}/lock`]: () => {
        posts.push('lock');
        state = generated('scheduled');
        return { status: 201, body: state };
      },
      [`GET /api/leagues/${LEAGUE}/seasons`]: () => ({ status: 200, body: [] }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
    });
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    await userEvent.click(await screen.findByRole('button', { name: /Generate schedule/ }));
    expect(await screen.findByText(/Everyone plays everyone: 6 of 6/)).toBeInTheDocument();
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Lock schedule/ }));
    expect(await screen.findByRole('button', { name: /Unlock/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Rainout/ })).toHaveLength(2);
    expect(posts).toEqual(['generate', 'lock']);
  });

  it('players can filter to their own matches, which are highlighted', async () => {
    mockApi({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { ...me, leagues: [{ ...me.leagues[0]!, role: 'user' }] },
      }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({
        status: 200,
        body: generated('scheduled'),
      }),
    });
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    const round1 = (await screen.findByText('Round 1')).closest('li') as HTMLElement;
    expect(within(round1).getByText('Jerry')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rainout/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'My matches' }));
    expect(within(round1).queryByText('Jerry')).not.toBeInTheDocument();
    expect(within(round1).getByText('Brian')).toHaveClass('text-primary');
  });
});

describe('home: this week', () => {
  it('shows the tee time, opponent, nine and group', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({
        status: 200,
        body: [
          {
            leagueId: LEAGUE,
            leagueName: 'Wednesday League',
            next: {
              seasonId: SEASON,
              seasonName: '2027',
              round: 3,
              rounds: 15,
              date: '2099-05-05',
              layout: 'Front 9',
              teeTime: '16:48',
              opponent: 'Doc',
              foursome: [
                ['Brian', 'Doc'],
                ['Jerry', 'Paul'],
              ],
              teeOrder: 2,
              groupsOff: 4,
              bye: false,
            },
          },
        ],
      }),
    });
    renderAt('/');
    expect(await screen.findByText(/Round 3 of 15/)).toBeInTheDocument();
    expect(screen.getByText('4:48 PM')).toBeInTheDocument();
    expect(screen.getByText('Doc', { selector: 'span.font-semibold' })).toBeInTheDocument();
    expect(screen.getByText('Front 9')).toBeInTheDocument();
    expect(screen.getByText(/Jerry vs Paul/)).toBeInTheDocument();
    expect(screen.getByLabelText('2nd group off')).toHaveTextContent('2nd');
  });
});

describe('season tools', () => {
  it('admins skip a rained-out round from the Rainout menu, and can delete the season', async () => {
    const { vi } = await import('vitest');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('2027');
    const posts: string[] = [];
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({
        status: 200,
        body: generated('scheduled'),
      }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/results`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/playoffs`]: () => ({
        status: 200,
        body: { format: 'none', canStart: false, regularRoundsLeft: 2, champion: null, rounds: [] },
      }),
      [`POST /api/leagues/${LEAGUE}/seasons/${SEASON}/weeks/w2/skip`]: () => {
        posts.push('skip');
        return { status: 201, body: generated('scheduled') };
      },
      [`DELETE /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => {
        posts.push('delete');
        return { status: 204 };
      },
      [`GET /api/leagues/${LEAGUE}/seasons`]: () => ({ status: 200, body: [] }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}`]: () => ({
        status: 200,
        body: { ...me.leagues[0], role: 'admin' },
      }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: { members: [], players: [] },
      }),
    });
    const router = renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    const rainouts = await screen.findAllByRole('button', { name: /Rainout/ });
    await userEvent.click(rainouts[1]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Skip this round/ }));
    await userEvent.click(screen.getByRole('button', { name: /Delete season/ }));
    await screen.findByRole('heading', { name: 'Seasons' });
    expect(router.state.location.pathname).toBe(`/leagues/${LEAGUE}`);
    expect(posts).toEqual(['skip', 'delete']);
  });
});

describe('roster sign-in links', () => {
  const handlers = (who: typeof me, posts: string[] = []) => ({
    'GET /api/auth/me': () => ({ status: 200, body: who }),
    [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({
      status: 200,
      body: generated('scheduled'),
    }),
    [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/results`]: () => ({ status: 200, body: [] }),
    [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/playoffs`]: () => ({
      status: 200,
      body: { format: 'none', canStart: false, regularRoundsLeft: 2, champion: null, rounds: [] },
    }),
    [`POST /api/users/${me.user.id}/password-link/email`]: () => {
      posts.push('email');
      return { status: 201, body: { sent: true, to: 'b***@example.com' } };
    },
    [`POST /api/users/${me.user.id}/password-link/text`]: () => {
      posts.push('text');
      return {
        status: 201,
        body: {
          link: 'https://teemate.test/set-password#token=abc',
          phone: '+18605551234',
          hours: 72,
          greeting: 'Brian',
        },
      };
    },
    [`GET /api/leagues/${LEAGUE}/members`]: () => ({
      status: 200,
      body: {
        players: [],
        members: [
          { userId: me.user.id, phone: '+18605551234' },
          { userId: 'u2', phone: '+18605550000' },
        ],
      },
    }),
  });

  it('site admins email a player a link from the roster', async () => {
    const { vi } = await import('vitest');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const posts: string[] = [];
    mockApi(handlers({ ...me, user: { ...me.user, isSiteAdmin: true } }, posts));
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    await userEvent.click(await screen.findByText('Show spots and handicaps'));
    // Only players with an account get the button (Brian here).
    const buttons = screen.getAllByRole('button', { name: /Email .* a sign-in link/ });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(await screen.findByText('Sent to b***@example.com')).toBeInTheDocument();
    expect(posts).toEqual(['email']);
  });

  it("league admins who aren't site admins don't see it", async () => {
    mockApi(handlers(me));
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    await userEvent.click(await screen.findByText('Show spots and handicaps'));
    expect(screen.queryByRole('button', { name: /a sign-in link/ })).toBeNull();
  });

  it('site admins text a player a sign-in link from their own phone', async () => {
    const posts: string[] = [];
    mockApi(handlers({ ...me, user: { ...me.user, isSiteAdmin: true } }, posts));
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    await userEvent.click(await screen.findByText('Show spots and handicaps'));
    await userEvent.click(screen.getByRole('button', { name: /Text Brian a sign-in link/ }));
    const send = await screen.findByRole('link', { name: 'Send Brian the text' });
    const href = send.getAttribute('href')!;
    expect(href).toMatch(/^sms:\+18605551234[?&]body=/);
    expect(decodeURIComponent(href)).toContain(
      "Hi Brian, here's your TeeMate sign-in link. Set your password and you're in: https://teemate.test/set-password#token=abc",
    );
    expect(posts).toEqual(['text']);
  });

  it('league admins can open a group text to the roster', async () => {
    mockApi(handlers(me));
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    const link = await screen.findByRole('link', { name: /Text everyone/ });
    // Brian is the only roster player with an account (and a phone) here.
    expect(link.getAttribute('href')).toMatch(/^sms:\+18605551234[?&]body=TeeMate/);
    expect(screen.getByText('1 of 4 have a phone number.')).toBeInTheDocument();
  });
});

describe('notice shortcuts', () => {
  it('admins send a notice straight to a foursome from the schedule', async () => {
    const posts: unknown[] = [];
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({
        status: 200,
        body: generated('scheduled'),
      }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/results`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/playoffs`]: () => ({
        status: 200,
        body: { format: 'none', canStart: false, regularRoundsLeft: 2, champion: null, rounds: [] },
      }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: { players: [], members: [] },
      }),
      [`POST /api/leagues/${LEAGUE}/announcements`]: (init) => {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: { phones: [], emailed: 0, held: 0 } };
      },
      [`GET /api/leagues/${LEAGUE}/announcements?limit=50`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/announcements?limit=20`]: () => ({ status: 200, body: [] }),
    });
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    const buttons = await screen.findAllByRole('button', {
      name: /Notice to the 1st off foursome/,
    });
    await userEvent.click(buttons[0]!);
    const dialog = await screen.findByRole('dialog');
    const label = within(dialog).getByText(/^For round 1, 1st off: /).textContent!;
    for (const n of ['Brian', 'Doc']) expect(label).toContain(n);
    expect(within(dialog).queryByLabelText('For')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Tee time moved to 5:20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post' }));
    expect(posts[0]).toMatchObject({
      audience: 'group',
      groupId: generated('scheduled').weeks[0]!.groups[0]!.id,
      title: 'Tee time moved to 5:20',
    });
  });
});

describe('recorded ties', () => {
  it('say why when the scores alone would not give a tie', async () => {
    const sched = generated('scheduled');
    const w = sched.weeks[0]!;
    const g = w.groups[0]!;
    const m = g.matches[0]!;
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({ status: 200, body: sched }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/results`]: () => ({
        status: 200,
        body: [
          {
            groupId: g.id,
            weekId: w.id,
            round: 1,
            playoffRound: null,
            status: 'final',
            layout: 'Front 9',
            rounds: [
              { playerId: m.playerA, attendance: 'played', handicap: 5, gross: 44 },
              { playerId: m.playerB, attendance: 'played', handicap: 8, gross: 51 },
            ],
            matches: [
              {
                id: m.id,
                playerA: m.playerA,
                playerB: m.playerB,
                result: {
                  outcome: 'T',
                  decidedBy: 'official',
                  why: 'absence',
                  strokes: { A: 0, B: 3 },
                  net: { A: 44, B: 48 },
                },
              },
            ],
          },
        ],
      }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/playoffs`]: () => ({
        status: 200,
        body: { format: 'none', canStart: false, regularRoundsLeft: 2, champion: null, rounds: [] },
      }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: { players: [], members: [] },
      }),
    });
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    const tie = await screen.findByText('Tie · absent');
    expect(tie).toHaveAttribute('title', expect.stringMatching(/one player was absent/));
  });
});

describe('game-day rearranging', () => {
  it('a player in the round moves a foursome earlier and swaps two matches', async () => {
    const posts: { key: string; body: unknown }[] = [];
    const sched = generated('scheduled');
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}`]: () => ({ status: 200, body: sched }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/results`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/seasons/${SEASON}/playoffs`]: () => ({
        status: 200,
        body: { format: 'none', canStart: false, regularRoundsLeft: 2, champion: null, rounds: [] },
      }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: { players: [], members: [] },
      }),
      [`POST /api/leagues/${LEAGUE}/seasons/${SEASON}/weeks/w1/tee-order`]: (init) => {
        posts.push({ key: 'tee-order', body: JSON.parse(String(init?.body)) });
        return { status: 201, body: sched };
      },
      [`POST /api/leagues/${LEAGUE}/seasons/${SEASON}/weeks/w1/regroup`]: (init) => {
        posts.push({ key: 'regroup', body: JSON.parse(String(init?.body)) });
        return { status: 201, body: sched };
      },
    });
    renderAt(`/leagues/${LEAGUE}/seasons/${SEASON}`);
    const buttons = await screen.findAllByRole('button', { name: /Rearrange/ });
    await userEvent.click(buttons[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move 2nd off earlier' }));
    const [first, second] = within(dialog).getAllByRole('button', { name: / v / });
    await userEvent.click(first!);
    expect(within(dialog).getByText(/Now tap a match in another foursome/)).toBeInTheDocument();
    await userEvent.click(second!);
    expect(posts).toEqual([
      { key: 'tee-order', body: { groupId: 'g1b', direction: 'up' } },
      { key: 'regroup', body: { matchA: 'm1a', matchB: 'm1b' } },
    ]);
  });
});
