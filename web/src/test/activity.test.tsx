import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const L = me.leagues[0]!.id;
const entry = (id: number, action: string, extra: object = {}) => ({
  id,
  leagueId: L,
  action,
  entityType: 'x',
  entityId: null,
  before: null,
  after: null,
  reason: null,
  createdAt: new Date().toISOString(),
  actor: 'Brian Brockel',
  actorEmail: 'brian@example.com',
  ...extra,
});

describe('activity page', () => {
  it('shows plain-English entries, reasons and details, and loads more', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${L}/audit?`]: () => ({
        status: 200,
        body: {
          entries: [
            entry(9, 'scorecard.override', {
              reason: 'Fixed per dispute',
              before: { gross: 45 },
              after: { gross: 44 },
            }),
            entry(8, 'week.rainout'),
          ],
          more: true,
        },
      }),
      [`GET /api/leagues/${L}/audit?before=8`]: () => ({
        status: 200,
        body: { entries: [entry(7, 'league.create')], more: false },
      }),
    });
    renderAt(`/leagues/${L}/activity`);
    expect(await screen.findByText('corrected a scorecard')).toBeInTheDocument();
    expect(screen.getByText('“Fixed per dispute”')).toBeInTheDocument();
    await userEvent.click(screen.getByText('corrected a scorecard'));
    expect(screen.getByText('Before')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('created the league')).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain(`GET /api/leagues/${L}/audit?before=8`);
  });

  it('is hidden from users', async () => {
    mockApi({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { ...me, leagues: [{ ...me.leagues[0]!, role: 'user' }] },
      }),
    });
    renderAt(`/leagues/${L}/activity`);
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });
});
