import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

const reading = {
  provider: 'claude',
  layout: {
    name: 'Front 9',
    holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4 })),
  },
  rows: [
    {
      nameOnCard: 'Jery',
      playerId: 'p-jerry',
      player: 'Jerry',
      holeScores: [5, 4, 4, 5, 4, 4, 5, 4, 8],
      uncertain: [8],
      absent: false,
    },
    {
      nameOnCard: 'K',
      playerId: 'p-jerry',
      player: 'Jerry',
      holeScores: [6, 5, 4, 5, 5, 4, 6, 4, 5],
      uncertain: [],
      absent: false,
    },
    {
      nameOnCard: 'Totals',
      playerId: null,
      player: null,
      holeScores: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      uncertain: [],
      absent: false,
    },
  ],
  notes: [],
  left: 9,
  players: [
    { playerId: 'p-jerry', nickname: 'Jerry', handicap: 7 },
    { playerId: 'p-keith', nickname: 'Keith', handicap: 14 },
  ],
};

describe('practice card scan (Account)', () => {
  it('reads a card, then lets you fix matches and scores before game day', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'POST /api/me/card-scan/practice': () => ({ status: 200, body: reading }),
    });
    renderAt('/account');
    const file = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
    await userEvent.upload(await screen.findByLabelText('Card photo'), file);
    expect(await screen.findByText(/Read by the AI reader as Front 9/)).toBeInTheDocument();

    // Two rows were both matched to Jerry: flagged until fixed.
    expect(screen.getByText(/Two rows are matched to the same player/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Player for K'), 'p-keith');
    expect(screen.queryByText(/Two rows are matched/)).toBeNull();
    // The unmatched "Totals" row starts left out.
    expect(screen.getByLabelText('Player for Totals')).toHaveValue('');

    // Hole 9 was read as 8 (flagged); fix it to 3.
    const hole9 = screen.getByLabelText('Jery hole 9');
    await userEvent.clear(hole9);
    await userEvent.type(hole9, '3');
    const jerryRow = hole9.closest('tr')!;
    // 5+4+4+5+4+4+5+4+3 = 38, net 38 - 7 = 31.
    expect(within(jerryRow).getByText('38')).toBeInTheDocument();
    expect(within(jerryRow).getByText('31')).toBeInTheDocument();
    expect(screen.getByText(/2 players matched, every hole filled in/)).toBeInTheDocument();
  });
});
