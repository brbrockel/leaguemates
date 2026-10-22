import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;

function leagueApi(roster: object[], onPatch?: (body: unknown) => void) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: me }),
    [`GET /api/leagues/${LEAGUE}`]: () => ({
      status: 200,
      body: { ...me.leagues[0], role: 'admin' },
    }),
    [`GET /api/leagues/${LEAGUE}/members`]: () => ({
      status: 200,
      body: { members: [], players: roster },
    }),
    [`GET /api/leagues/${LEAGUE}/seasons`]: () => ({ status: 200, body: [] }),
    [`POST /api/leagues/${LEAGUE}/players`]: () => ({ status: 201, body: {} }),
    [`PATCH /api/leagues/${LEAGUE}/players/p1`]: (init) => {
      onPatch?.(JSON.parse(String(init?.body)));
      return { status: 200, body: {} };
    },
  });
}

/** The members list starts folded away on a phone (jsdom's matchMedia never matches). */
async function openPlayers() {
  await userEvent.click(await screen.findByRole('button', { name: /^Members/ }));
}

describe('members', () => {
  it('lists spots and accounts together, saying who is playing', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}`]: () => ({
        status: 200,
        body: { ...me.leagues[0], role: 'admin' },
      }),
      [`GET /api/leagues/${LEAGUE}/seasons`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: {
          members: [
            {
              userId: 'u1',
              email: 'doc@example.com',
              name: 'Sam Example',
              phone: null,
              address: null,
              role: 'admin',
            },
            {
              userId: 'u2',
              email: 'pat@example.com',
              name: 'Pat Watcher',
              phone: null,
              address: null,
              role: 'user',
            },
          ],
          players: [
            { id: 'p1', nickname: 'Doc', fullName: null, handicap: 12, userId: 'u1', active: true },
            {
              id: 'p2',
              nickname: 'Old',
              fullName: null,
              handicap: null,
              userId: null,
              active: false,
            },
          ],
        },
      }),
    });
    renderAt(`/leagues/${LEAGUE}`);
    expect(await screen.findByText('1 playing · 1 not playing')).toBeInTheDocument();
    await openPlayers();
    // A spot with an account: nickname links to stats, the account's name and role beside it.
    const doc = screen.getByRole('link', { name: 'Doc' }).closest('li')!;
    expect(within(doc).getByText('Sam Example')).toBeInTheDocument();
    expect(within(doc).getByText('Admin')).toBeInTheDocument();
    expect(within(doc).getByText('Playing · HCP 12')).toBeInTheDocument();
    // An account with no spot: no stats link, marked as not playing.
    const pat = screen.getByText('Pat Watcher').closest('li')!;
    expect(within(pat).getByText('Not playing')).toBeInTheDocument();
    expect(within(pat).queryByRole('link', { name: 'Pat Watcher' })).toBeNull();
    expect(screen.getByText('Past players (1)')).toBeInTheDocument();
  });

  it('starts open on a wide screen', async () => {
    const narrow = window.matchMedia;
    window.matchMedia = (q: string) => ({ ...narrow(q), matches: q.includes('min-width') });
    try {
      leagueApi([
        { id: 'p1', nickname: 'Doc', fullName: null, handicap: null, userId: null, active: true },
      ]);
      renderAt(`/leagues/${LEAGUE}`);
      expect(await screen.findByRole('link', { name: 'Doc' })).toBeInTheDocument();
    } finally {
      window.matchMedia = narrow;
    }
  });
});

describe('players', () => {
  it('shows nicknames with full names underneath', async () => {
    leagueApi([
      {
        id: 'p1',
        nickname: 'Doc',
        fullName: 'Sam Example',
        handicap: null,
        userId: null,
        active: true,
      },
    ]);
    renderAt(`/leagues/${LEAGUE}`);
    await openPlayers();
    const row = (await screen.findByText('Sam Example')).closest('li')!;
    expect(within(row).getByText('Doc')).toBeInTheDocument();
  });

  it('adds a player with a full name and nickname', async () => {
    const calls = leagueApi([]);
    renderAt(`/leagues/${LEAGUE}`);
    await openPlayers();
    await userEvent.type(await screen.findByLabelText('Full name'), 'Sam Example');
    await userEvent.type(screen.getByLabelText('Nickname'), 'Doc');
    await userEvent.click(screen.getByRole('button', { name: /Add player/ }));
    const post = calls.find((c) => c.key === `POST /api/leagues/${LEAGUE}/players`);
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      fullName: 'Sam Example',
      nickname: 'Doc',
    });
  });

  it('lets an admin fix a name', async () => {
    let patched: unknown;
    leagueApi(
      [
        {
          id: 'p1',
          nickname: 'Doc',
          fullName: 'Sam Exampel',
          handicap: null,
          userId: null,
          active: true,
        },
      ],
      (b) => (patched = b),
    );
    renderAt(`/leagues/${LEAGUE}`);
    await openPlayers();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Doc' }));
    const full = screen.getByRole('textbox', { name: 'Full name for Doc' });
    await userEvent.clear(full);
    await userEvent.type(full, 'Sam Example');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await screen.findByRole('button', { name: 'Edit Doc' });
    expect(patched).toEqual({
      nickname: 'Doc',
      fullName: 'Sam Example',
      handicap: null,
      active: true,
    });
  });

  it('marks a player as a past player, listed separately', async () => {
    let patched: unknown;
    leagueApi(
      [
        { id: 'p1', nickname: 'Doc', fullName: null, handicap: 7, userId: null, active: true },
        { id: 'p2', nickname: 'Joe', fullName: null, handicap: 7, userId: null, active: false },
      ],
      (b) => (patched = b),
    );
    renderAt(`/leagues/${LEAGUE}`);
    await openPlayers();
    expect(await screen.findByText('Past players (1)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Doc' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Still playing/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await screen.findByRole('button', { name: 'Edit Doc' });
    expect(patched).toEqual({ nickname: 'Doc', fullName: '', handicap: 7, active: false });
  });
});
