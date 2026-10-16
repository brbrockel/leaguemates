import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const LEAGUE = me.leagues[0]!.id;

const hole = (number: number, over: object = {}) => ({
  number,
  par: 4,
  strokeIndex: number,
  n: 10,
  avg: 4.5,
  toPar: 0.5,
  rank: number,
  mix: { birdie: 0.1, par: 0.4, bogey: 0.4, double: 0.1 },
  mine: null,
  ...over,
});
const nine = (over: object = {}) => ({
  layoutId: 'l1',
  name: 'Front 9',
  course: 'Timberlin Golf Club',
  rounds: 12,
  mine: null,
  holes: [hole(1, { avg: 5.25, toPar: 1.25, rank: 1 }), hole(2)],
  ...over,
});

describe('hole stats', () => {
  it('League → Stats shows how each hole plays, per nine', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/stats/holes`]: () => ({
        status: 200,
        body: { seasons: [{ id: 's1', name: '2027' }], nines: [nine()] },
      }),
    });
    renderAt(`/leagues/${LEAGUE}/stats`);
    expect(await screen.findByText('Timberlin Golf Club · Front 9')).toBeInTheDocument();
    expect(screen.getByText(/12 rounds \(early days/)).toBeInTheDocument();
    const row = screen.getByText('+1.25').closest('tr')!;
    expect(within(row).getByText('5.25')).toBeInTheDocument();
  });

  it('says so when there are no hole-by-hole scores yet', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/stats/holes`]: () => ({
        status: 200,
        body: { seasons: [], nines: [] },
      }),
    });
    renderAt(`/leagues/${LEAGUE}/stats`);
    expect(await screen.findByText(/No hole-by-hole scores yet/)).toBeInTheDocument();
  });
});

describe('player trend and hole by hole', () => {
  const match = (date: string, gross: number, handicap = 10) => ({
    matchId: date,
    seasonId: 's1',
    season: '2027',
    weekId: 'w',
    groupId: 'g',
    round: 1,
    playoffRound: null,
    date,
    opponentId: 'p2',
    opponent: 'Keith',
    handicap,
    absent: false,
    gross,
    // Match net: as if the opponent always had the lower handicap by 4.
    net: gross - 4,
    result: 'W',
    points: 3,
    official: false,
  });

  it('charts scores over time (gross or net) and compares holes with the field', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${LEAGUE}/players/p1/history`]: () => ({
        status: 200,
        body: {
          player: { id: 'p1', nickname: 'Jerry', fullName: null, handicap: 10 },
          stats: {
            rounds: 4,
            scoringAverage: 46,
            netAverage: 36,
            best: null,
            winPct: 100,
            record: { W: 4, L: 0, T: 0 },
          },
          seasons: [],
          headToHead: [],
          matches: [
            match('2027-05-05', 44),
            match('2027-04-21', 48),
            match('2027-04-28', 46),
            match('2027-05-12', 42, 8),
          ],
        },
      }),
      [`GET /api/leagues/${LEAGUE}/stats/holes?playerId=p1`]: () => ({
        status: 200,
        body: {
          seasons: [],
          nines: [
            nine({
              mine: 4,
              holes: [hole(1, { avg: 4.5, mine: { n: 4, avg: 5 } })],
            }),
          ],
        },
      }),
    });
    renderAt(`/leagues/${LEAGUE}/players/p1`);
    const chart = await screen.findByRole('img', { name: 'Gross scores over 4 rounds' });
    expect(chart).toBeInTheDocument();
    // The table view lists rounds newest first, with the running average.
    await userEvent.click(screen.getByText('Show as a table'));
    const rows = screen.getAllByRole('row').filter((r) => within(r).queryByText(/2027/));
    expect(within(rows[0]!).getByText('42')).toBeInTheDocument();
    // (48 + 46 + 44 + 42) / 4 = 45.0
    expect(within(rows[0]!).getByText('45.0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'net' }));
    expect(screen.getByRole('img', { name: 'Net scores over 4 rounds' })).toBeInTheDocument();
    // Match net 42 - 4 = 38 for the latest round.
    expect(
      within(screen.getAllByRole('row').filter((r) => within(r).queryByText(/2027/))[0]!).getByText(
        '38',
      ),
    ).toBeInTheDocument();

    expect(screen.getByText('Hole by hole: Timberlin Golf Club · Front 9')).toBeInTheDocument();
    expect(screen.getByText('+0.50 worse')).toBeInTheDocument();
  });
});
