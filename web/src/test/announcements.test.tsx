import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;

describe('announcements', () => {
  it('admins can text a notice to the league from their phone (everyone but themselves)', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}`]: () => ({
        status: 200,
        body: { ...me.leagues[0], role: 'admin' },
      }),
      [`GET /api/leagues/${LEAGUE}/members`]: () => ({
        status: 200,
        body: {
          players: [],
          members: [
            { userId: me.user.id, phone: '+18605551234' },
            { userId: 'u2', phone: '+18605550000' },
            { userId: 'u3', phone: '+18605550001' },
            { userId: 'u4', phone: null },
          ],
        },
      }),
      [`GET /api/leagues/${LEAGUE}/seasons`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${LEAGUE}/announcements?limit=20`]: () => ({
        status: 200,
        body: [
          {
            id: 'a1',
            title: 'Rained out tonight',
            body: 'See you next week.',
            pinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: null,
            author: 'Brian',
          },
        ],
      }),
    });
    renderAt(`/leagues/${LEAGUE}`);
    const link = await screen.findByRole('link', { name: 'Text Rained out tonight to the league' });
    const href = decodeURIComponent(link.getAttribute('href')!);
    expect(href).toContain('+18605550000,+18605550001');
    expect(href).not.toContain('+18605551234');
    expect(href).toContain('Rained out tonight\n\nSee you next week.');
  });
});
