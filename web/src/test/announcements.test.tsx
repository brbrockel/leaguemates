import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;
const LIST = `GET /api/leagues/${LEAGUE}/announcements?limit=50`;

const notice = (over: object) => ({
  id: 'a1',
  title: 'Bring $20 for the pot',
  body: 'Cash only.',
  pinned: false,
  audience: 'league',
  kind: null,
  to: 'League',
  createdAt: new Date().toISOString(),
  updatedAt: null,
  author: 'Brian',
  read: false,
  dismissed: false,
  banner: true,
  dismissible: true,
  urgent: false,
  bannerUntil: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  ...over,
});
const siteNotice = (over: object) => ({
  id: 's1',
  title: 'Down for updates Sunday 8pm',
  body: 'About an hour.',
  mustSee: false,
  createdAt: new Date().toISOString(),
  updatedAt: null,
  author: 'Brian',
  read: false,
  dismissed: false,
  banner: true,
  dismissible: true,
  bannerUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  ...over,
});

const home = (handlers: Parameters<typeof mockApi>[0]) =>
  mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: me }),
    'GET /api/me/this-week': () => ({ status: 200, body: [] }),
    [`POST /api/leagues/${LEAGUE}/announcements/read`]: () => ({ status: 200, body: {} }),
    'POST /api/notices/site/read': () => ({ status: 200, body: {} }),
    ...handlers,
  });

describe('notice banners', () => {
  it('stack by urgency, one line each; routine notices stay out', async () => {
    home({
      [LIST]: () => ({
        status: 200,
        body: [
          notice({ id: 'a1' }),
          notice({ id: 'a2', title: 'Card submitted', kind: 'card.submitted', banner: false }),
          notice({
            id: 'a3',
            title: 'Rained out: round 4',
            kind: 'week.rainout',
            urgent: true,
            dismissible: false,
          }),
        ],
      }),
      'GET /api/notices/site': () => ({ status: 200, body: [siteNotice({})] }),
    });
    renderAt('/');
    const bar = await screen.findByRole('region', { name: 'Notices' });
    const rows = within(bar).getAllByRole('button', { expanded: false });
    expect(rows.map((r) => r.textContent)).toEqual([
      'Down for updates Sunday 8pmTeeMate',
      'Rained out: round 4League',
      'Bring $20 for the potLeague',
    ]);
    expect(within(bar).queryByText('Card submitted')).toBeNull();
    // On the day, a rainout can't be dismissed.
    expect(within(bar).queryByRole('button', { name: 'Dismiss Rained out: round 4' })).toBeNull();
    expect(within(bar).getByRole('alert')).toHaveTextContent('Rained out: round 4');
  });

  it('tap for the full text (marks it read); ✕ dismisses it', async () => {
    let list = [notice({})];
    const calls = home({
      [LIST]: () => ({ status: 200, body: list }),
      [`POST /api/leagues/${LEAGUE}/announcements/dismiss`]: () => {
        list = [notice({ dismissed: true, banner: false, read: true })];
        return { status: 200, body: {} };
      },
    });
    renderAt('/');
    const bar = await screen.findByRole('region', { name: 'Notices' });
    await userEvent.click(within(bar).getByRole('button', { name: /^Bring \$20.*League$/ }));
    expect(within(bar).getByText('Cash only.')).toBeInTheDocument();
    const read = calls.find((c) => c.key.endsWith('/announcements/read'));
    expect(JSON.parse(String(read?.init?.body))).toEqual({ ids: ['a1'] });

    await userEvent.click(
      within(bar).getByRole('button', { name: 'Dismiss Bring $20 for the pot' }),
    );
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    expect(calls.some((c) => c.key.endsWith('/announcements/dismiss'))).toBe(true);
  });

  it('past three, the rest fold into "+N more", which opens the notices panel', async () => {
    home({
      [LIST]: () => ({
        status: 200,
        body: [1, 2, 3, 4].map((i) => notice({ id: `a${i}`, title: `Notice ${i}` })),
      }),
    });
    renderAt('/');
    const bar = await screen.findByRole('region', { name: 'Notices' });
    expect(within(bar).getAllByRole('button', { name: /^Dismiss/ })).toHaveLength(2);
    await userEvent.click(within(bar).getByRole('button', { name: '+2 more notices' }));
    const panel = await screen.findByRole('dialog', { name: 'Notices' });
    expect(within(panel).getByText('Notice 4')).toBeInTheDocument();
  });

  it('site-wide notices are dismissed on the server', async () => {
    let site = [siteNotice({})];
    const calls = home({
      [LIST]: () => ({ status: 200, body: [] }),
      'GET /api/notices/site': () => ({ status: 200, body: site }),
      'POST /api/notices/site/dismiss': () => {
        site = [siteNotice({ banner: false, dismissed: true })];
        return { status: 200, body: {} };
      },
    });
    renderAt('/');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss Down for updates Sunday 8pm' }),
    );
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    const dismiss = calls.find((c) => c.key === 'POST /api/notices/site/dismiss');
    expect(JSON.parse(String(dismiss?.init?.body))).toEqual({ ids: ['s1'] });
  });
});

describe('notices panel (the horn)', () => {
  const adminApi = (posts: object[] = []) =>
    home({
      [LIST]: () => ({
        status: 200,
        body: [
          notice({ banner: false, read: false, title: 'Rained out tonight', body: 'See you.' }),
          notice({ id: 'a2', title: 'Card submitted', kind: 'card.submitted', banner: false }),
        ],
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
      [`GET /api/leagues/${LEAGUE}/announcements/a1/phones`]: () => ({
        status: 200,
        body: ['+18605550000', '+18605550001'],
      }),
      [`POST /api/leagues/${LEAGUE}/announcements`]: (init) => {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: { phones: ['+18605550000'], emailed: 0, held: 0 } };
      },
    });

  it('counts what is new and not already a banner; opening it marks them read', async () => {
    const calls = adminApi();
    renderAt('/');
    const horn = await screen.findByRole('button', { name: 'Notices (2 new)' });
    await userEvent.click(horn);
    const panel = await screen.findByRole('dialog', { name: 'Notices' });
    expect(within(panel).getByRole('region', { name: 'Wednesday League' })).toBeInTheDocument();
    expect(within(panel).getByText('Card submitted')).toBeInTheDocument();
    const read = calls.find((c) => c.key.endsWith('/announcements/read'));
    expect(JSON.parse(String(read?.init?.body))).toEqual({ ids: ['a1', 'a2'] });
  });

  it('admins post to one person, for a chosen time as a banner, and can text it', async () => {
    const posts: object[] = [];
    adminApi(posts);
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /^Notices/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notices' });
    await userEvent.click(within(panel).getByRole('button', { name: /New notice/ }));
    await userEvent.selectOptions(within(panel).getByLabelText('For'), 'person');
    await userEvent.selectOptions(await within(panel).findByLabelText('Person'), 'u2');
    // A notice for one person shows as a banner for two days unless chosen otherwise.
    expect(within(panel).getByLabelText('Show as a banner')).toHaveValue('2');
    await userEvent.selectOptions(within(panel).getByLabelText('Show as a banner'), '3');
    await userEvent.type(within(panel).getByLabelText('Title'), 'Please pay your fee');
    await userEvent.click(within(panel).getByRole('button', { name: 'Post' }));
    expect(posts[0]).toMatchObject({
      title: 'Please pay your fee',
      audience: 'person',
      recipientUserId: 'u2',
      bannerDays: 3,
      email: false,
    });
    const text = await within(panel).findByRole('link', { name: /Also text it \(1\)/ });
    expect(decodeURIComponent(text.getAttribute('href')!)).toContain('+18605550000');
  });

  it("texts an existing notice to the people it's for", async () => {
    adminApi();
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /^Notices/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notices' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Text Rained out tonight' }));
    const link = await within(panel).findByRole('link', { name: /Send the text \(2\)/ });
    const href = decodeURIComponent(link.getAttribute('href')!);
    expect(href).toContain('+18605550000,+18605550001');
    expect(href).toContain('Rained out tonight\n\nSee you.');
  });

  it('site admins post a notice for everyone; must-see needs an end', async () => {
    const posts: object[] = [];
    mockApi({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { ...me, user: { ...me.user, isSiteAdmin: true } },
      }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      [LIST]: () => ({ status: 200, body: [] }),
      'GET /api/notices/site': () => ({ status: 200, body: [] }),
      'POST /api/notices/site': (init) => {
        posts.push(JSON.parse(String(init?.body)));
        return { status: 201, body: {} };
      },
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Notices' }));
    const panel = await screen.findByRole('dialog', { name: 'Notices' });
    const site = within(panel).getByRole('region', { name: 'TeeMate' });
    await userEvent.click(within(site).getByRole('button', { name: /Notice for everyone/ }));
    await userEvent.type(within(site).getByLabelText('Title'), 'Down Sunday');
    await userEvent.selectOptions(within(site).getByLabelText('Show as a banner'), 'kept');
    await userEvent.click(within(site).getByLabelText(/Everyone must see it/));
    // "Until each person clears it" can't go with must-see: back to a week.
    expect(within(site).getByLabelText('Show as a banner')).toHaveValue('7');
    expect(within(site).queryByRole('option', { name: 'Until each person clears it' })).toBeNull();
    await userEvent.click(within(site).getByRole('button', { name: /Post to everyone/ }));
    expect(posts[0]).toEqual({ title: 'Down Sunday', body: '', mustSee: true, bannerDays: 7 });
  });
});
