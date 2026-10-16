import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_LEAGUE_SETTINGS } from '@teemate/shared';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!;
const person = (over: object) => ({
  id: 'u2',
  email: 'jerry@example.com',
  name: 'Jerry',
  isSiteAdmin: false,
  disabled: false,
  lastSignInAt: null,
  hasPassword: false,
  lockedUntil: null,
  totpEnabled: false,
  createdAt: '2026-10-01T00:00:00Z',
  isSelf: false,
  leagues: [
    {
      leagueId: LEAGUE.id,
      leagueName: LEAGUE.name,
      role: 'user',
      player: { id: 'p2', nickname: 'Jerry' },
    },
  ],
  ...over,
});

describe('people page', () => {
  it('lists people with roles, players and sign-in status', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/users': () => ({ status: 200, body: [person({})] }),
    });
    renderAt('/people');
    const card = (await screen.findByText('jerry@example.com')).closest(
      'div.rounded-xl',
    ) as HTMLElement;
    expect(within(card).getByText(/Never signed in · No password yet/)).toBeInTheDocument();
    expect(within(card).getByText(/· Jerry/)).toBeInTheDocument();
  });

  it('gets a password link without sending email and shows it to copy', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/users': () => ({ status: 200, body: [person({})] }),
      'POST /api/users/u2/password-link': () => ({
        status: 201,
        body: {
          link: 'https://teemate.test/sign-in/verify#token=abc',
          expiresAt: '2026-10-16T20:00:00Z',
        },
      }),
    });
    renderAt('/people');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Jerry' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Get password link/ }));
    expect(await screen.findByRole('textbox', { name: 'Password link' })).toHaveValue(
      'https://teemate.test/sign-in/verify#token=abc',
    );
    expect(calls.filter((c) => c.key.startsWith('POST'))).toHaveLength(1);
  });

  it('site admins add a person, optionally to a league as an existing player', async () => {
    const siteAdmin = { ...me, user: { ...me.user, isSiteAdmin: true } };
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: siteAdmin }),
      'GET /api/users': () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE.id}/members`]: () => ({
        status: 200,
        body: {
          members: [],
          players: [{ id: 'p4', nickname: 'Doc', fullName: null, userId: null, active: true }],
        },
      }),
      'POST /api/users': () => ({ status: 201, body: { id: 'u9' } }),
    });
    renderAt('/people');
    await userEvent.click(await screen.findByRole('button', { name: /Add/ }));
    await userEvent.type(await screen.findByLabelText('Email'), 'doc@example.com');
    await userEvent.selectOptions(screen.getByLabelText('League'), LEAGUE.id);
    await userEvent.selectOptions(
      await screen.findByLabelText('Player'),
      await screen.findByRole('option', { name: 'Doc' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Add person/ }));
    const post = calls.find((c) => c.key === 'POST /api/users');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      email: 'doc@example.com',
      leagueId: LEAGUE.id,
      role: 'user',
      playerId: 'p4',
    });
  });

  it('league admins (not site admins) cannot create accounts here', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/users': () => ({ status: 200, body: [] }),
    });
    renderAt('/people');
    await screen.findByText(/Add someone to your league from its Members list/);
    expect(screen.queryByRole('button', { name: /^Add$/ })).not.toBeInTheDocument();
  });
});

describe('league settings page', () => {
  it('admins edit the rules and save them', async () => {
    let saved: { settings: typeof DEFAULT_LEAGUE_SETTINGS } | undefined;
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE.id}`]: () => ({
        status: 200,
        body: {
          id: LEAGUE.id,
          name: LEAGUE.name,
          role: 'admin',
          settings: DEFAULT_LEAGUE_SETTINGS,
        },
      }),
      [`PATCH /api/leagues/${LEAGUE.id}`]: (init) => {
        saved = JSON.parse(String(init?.body));
        return { status: 200, body: { id: LEAGUE.id, name: LEAGUE.name, role: 'admin', ...saved } };
      },
    });
    renderAt(`/leagues/${LEAGUE.id}/settings`);
    await userEvent.selectOptions(await screen.findByLabelText('Tie-break'), 'par5s_first');
    const tie = screen.getByLabelText('Tie');
    await userEvent.clear(tie);
    await userEvent.type(tie, '2');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await screen.findByText('Saved');
    expect(saved!.settings.points).toEqual({ win: 3, tie: 2, loss: 0 });
    expect(saved!.settings.playoffs.tiebreak).toBe('par5s_first');
  });

  it('users see the rules read-only', async () => {
    mockApi({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { ...me, leagues: [{ ...LEAGUE, role: 'user' }] },
      }),
      [`GET /api/leagues/${LEAGUE.id}`]: () => ({
        status: 200,
        body: { id: LEAGUE.id, name: LEAGUE.name, role: 'user', settings: DEFAULT_LEAGUE_SETTINGS },
      }),
    });
    renderAt(`/leagues/${LEAGUE.id}/settings`);
    expect(await screen.findByLabelText('Win')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save changes/ })).not.toBeInTheDocument();
  });
});
