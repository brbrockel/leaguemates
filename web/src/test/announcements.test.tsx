import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;

const notice = (over: object) => ({
  id: 'a1',
  title: 'Rained out tonight',
  body: 'See you next week.',
  pinned: false,
  audience: 'league',
  kind: null,
  to: 'League',
  createdAt: new Date().toISOString(),
  updatedAt: null,
  author: 'Brian',
  read: false,
  dismissed: false,
  ...over,
});

describe('notice strip (Home)', () => {
  it('shows one line while something is new; expanding marks it read, ✕ clears it', async () => {
    let list = [
      notice({}),
      notice({ id: 'a2', title: 'Card submitted', to: 'Your foursome', author: 'TeeMate' }),
      notice({ id: 'a3', title: 'Old news', read: true }),
    ];
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/announcements?limit=20`]: () => ({ status: 200, body: list }),
      [`POST /api/leagues/${LEAGUE}/announcements/read`]: () => ({ status: 200, body: {} }),
      [`POST /api/leagues/${LEAGUE}/announcements/dismiss`]: () => {
        list = list.map((n) => ({ ...n, dismissed: true }));
        return { status: 200, body: {} };
      },
    });
    renderAt('/');
    const strip = await screen.findByRole('region', { name: 'Notices' });
    // Collapsed: the newest unread, and how many more (the read one isn't counted).
    expect(within(strip).getByText('Rained out tonight')).toBeInTheDocument();
    expect(within(strip).getByText('+1 more')).toBeInTheDocument();

    await userEvent.click(within(strip).getByRole('button', { name: /Rained out tonight/ }));
    expect(within(strip).getByText('Card submitted')).toBeInTheDocument();
    expect(within(strip).getByText(/Your foursome ·/)).toBeInTheDocument();
    const read = calls.find((c) => c.key.endsWith('/announcements/read'));
    expect(JSON.parse(String(read?.init?.body))).toEqual({ ids: ['a1', 'a2'] });
    // Tap a notice for its full text.
    await userEvent.click(within(strip).getByRole('button', { name: /Rained out tonight/ }));
    expect(within(strip).getByText('See you next week.')).toBeInTheDocument();

    await userEvent.click(within(strip).getByRole('button', { name: 'Clear notices' }));
    await screen.findByText('Your leagues');
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
  });

  it('takes no space when there is nothing new', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/announcements?limit=20`]: () => ({
        status: 200,
        body: [notice({ read: true })],
      }),
    });
    renderAt('/');
    await screen.findByText('Your leagues');
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
  });
});

describe('notices (League page)', () => {
  const leagueApi = (posts: object[] = []) =>
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}`]: () => ({
        status: 200,
        body: { ...me.leagues[0], role: 'admin' },
      }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: {
          players: [{ nickname: 'Jerry', userId: 'u2' }],
          members: [
            { userId: me.user.id, name: 'Brian', email: 'b@example.com' },
            { userId: 'u2', name: 'Jerry Smith', email: 'j@example.com' },
          ],
        },
      }),
      [`GET /api/leagues/${LEAGUE}/seasons`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/announcements?limit=50`]: () => ({
        status: 200,
        body: [notice({ read: true })],
      }),
      [`GET /api/leagues/${LEAGUE}/announcements/a1/phones`]: () => ({
        status: 200,
        body: ['+18605550000', '+18605550001'],
      }),
      [`POST /api/leagues/${LEAGUE}/announcements`]: (init) => {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: { phones: ['+18605550000'], emailed: 0, held: 0 } };
      },
    });

  it('stays collapsed to one line until opened', async () => {
    leagueApi();
    renderAt(`/leagues/${LEAGUE}`);
    const header = await screen.findByRole('button', { name: /Notices/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('See you next week.')).toBeNull();
    await userEvent.click(header);
    expect(screen.getByText('See you next week.')).toBeInTheDocument();
  });

  it('admins post to one person and can text it from their phone', async () => {
    const posts: object[] = [];
    leagueApi(posts);
    renderAt(`/leagues/${LEAGUE}`);
    await userEvent.click(await screen.findByRole('button', { name: /New notice/ }));
    await userEvent.selectOptions(screen.getByLabelText('For'), 'person');
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'u2');
    expect(screen.getByRole('option', { name: 'Jerry' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Title'), 'Please pay your fee');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(posts[0]).toMatchObject({
      title: 'Please pay your fee',
      audience: 'person',
      recipientUserId: 'u2',
      email: false,
    });
    const text = await screen.findByRole('link', { name: /Also text it \(1\)/ });
    expect(decodeURIComponent(text.getAttribute('href')!)).toContain('+18605550000');
  });

  it("texts an existing notice to the people it's for", async () => {
    leagueApi();
    renderAt(`/leagues/${LEAGUE}`);
    await userEvent.click(await screen.findByRole('button', { name: /Notices/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Text Rained out tonight' }));
    const link = await screen.findByRole('link', { name: /Send the text \(2\)/ });
    const href = decodeURIComponent(link.getAttribute('href')!);
    expect(href).toContain('+18605550000,+18605550001');
    expect(href).toContain('Rained out tonight\n\nSee you next week.');
  });
});
