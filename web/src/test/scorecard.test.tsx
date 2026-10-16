import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ScorecardView } from '@/lib/api';
import { me, mockApi, renderAt } from './render';

const L = me.leagues[0]!.id;
const S = '22222222-2222-4222-8222-222222222222';
const W = '33333333-3333-4333-8333-333333333333';
const G = '44444444-4444-4444-8444-444444444444';
const PATH = `/api/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}/scorecard`;
const FRONT = {
  id: 'front',
  name: 'Front 9',
  holes: [
    [1, 5, 3],
    [2, 4, 5],
    [3, 4, 11],
    [4, 3, 17],
    [5, 4, 9],
    [6, 5, 1],
    [7, 3, 15],
    [8, 4, 13],
    [9, 4, 7],
  ].map(([number, par, strokeIndex]) => ({
    number: number!,
    par: par!,
    strokeIndex: strokeIndex!,
  })),
};
const BACK = {
  ...FRONT,
  id: 'back',
  name: 'Back 9',
  holes: FRONT.holes.map((h) => ({ ...h, number: h.number + 9 })),
};

function view(over: Partial<ScorecardView> = {}): ScorecardView {
  return {
    round: 1,
    date: '2099-04-21',
    teeTime: '16:48',
    plannedLayoutId: 'front',
    layouts: [FRONT, BACK],
    players: [
      { playerId: 'jerry', nickname: 'Jerry', handicap: 7 },
      { playerId: 'brian', nickname: 'Brian', handicap: 14 },
    ],
    card: null,
    matches: [{ id: 'm1', playerA: 'jerry', playerB: 'brian', result: null }],
    disputeWindowHours: 48,
    permissions: {
      canEdit: true,
      canSubmit: true,
      canDispute: false,
      canApprove: false,
      needsReason: false,
    },
    ...over,
  };
}

async function fillAll(nick: string, score: string, first = 1) {
  for (let h = first; h < first + 9; h++)
    await userEvent.type(screen.getByLabelText(`${nick} hole ${h}`), score);
}

describe('scorecard entry', () => {
  it('shows live net results as scores go in', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view() }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    expect(screen.getByText('In progress')).toBeInTheDocument();
    await fillAll('Jerry', '5'); // 45
    await fillAll('Brian', '6'); // 54, gets 7 strokes -> 47
    const line = screen.getByText(/Net · Brian gets 7/).closest('div') as HTMLElement;
    expect(within(line.parentElement!).getByText('45')).toBeInTheDocument();
    expect(within(line.parentElement!).getByText('47')).toBeInTheDocument();
    expect(screen.getAllByText('Jerry').length).toBeGreaterThan(1);
  });

  it('marks a player absent and applies the absence rule', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view() }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    await userEvent.click(screen.getByRole('button', { name: 'Brian absent' }));
    await fillAll('Jerry', '5'); // 45 vs baseline 36 + 14 = 50
    expect(await screen.findByText(/absence rule \(must beat 50\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Sub for Brian (optional)')).toBeInTheDocument();
  });

  it('saves then submits', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const bodies: unknown[] = [];
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view() }),
      [`PUT ${PATH}`]: (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return {
          status: 200,
          body: view({
            card: {
              id: 'card1',
              status: 'draft',
              layoutId: 'back',
              version: 1,
              enteredBy: 'Brian',
              submittedAt: null,
              finalAt: null,
              dispute: null,
              rounds: [],
            },
          }),
        };
      },
      [`POST ${PATH}/submit`]: () => ({
        status: 201,
        body: view({
          card: {
            id: 'card1',
            status: 'submitted',
            layoutId: 'back',
            version: 2,
            enteredBy: 'Brian',
            submittedAt: '2099-04-21T22:00:00Z',
            finalAt: null,
            dispute: null,
            rounds: [],
          },
          permissions: {
            canEdit: false,
            canSubmit: false,
            canDispute: true,
            canApprove: false,
            needsReason: false,
          },
        }),
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    await userEvent.click(screen.getByRole('radio', { name: /Back 9/ })); // the starter changed the nine
    await fillAll('Jerry', '5', 10);
    await fillAll('Brian', '6', 10);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(await screen.findByRole('button', { name: /Dispute/ })).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({
      layoutId: 'back',
      rounds: [
        { playerId: 'jerry', attendance: 'played', holeScores: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
        { playerId: 'brian', attendance: 'played', holeScores: [6, 6, 6, 6, 6, 6, 6, 6, 6] },
      ],
    });
    expect(calls.map((c) => c.key)).toContain(`POST ${PATH}/submit`);
  });

  it('read-only for people outside the group', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({
        status: 200,
        body: view({
          permissions: {
            canEdit: false,
            canSubmit: false,
            canDispute: false,
            canApprove: false,
            needsReason: false,
          },
        }),
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    expect(screen.getByLabelText('Jerry hole 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
  });
});

describe('scanning a paper card', () => {
  it('fills the form from the photo, highlights doubtful scores, and lets you match names', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view() }),
      [`POST ${PATH}/scan`]: () => ({
        status: 201,
        body: {
          photo: { id: 'ph1' },
          reading: {
            provider: 'claude',
            layoutId: 'back',
            rows: [
              {
                playerId: 'jerry',
                nameOnCard: 'Jer',
                holeScores: [5, 4, 4, 3, 5, 6, 3, 4, 5],
                uncertain: [3],
                absent: false,
              },
              {
                playerId: null,
                nameOnCard: 'B-Man',
                holeScores: [6, 6, 6, 6, 6, 6, 6, 6, 6],
                uncertain: [],
                absent: false,
              },
              {
                playerId: null,
                nameOnCard: 'Uncle Joe',
                holeScores: [7, 7, 7, 7, 7, 7, 7, 7, 7],
                uncertain: [],
                absent: false,
              },
            ],
            notes: [],
          },
        },
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    const file = new File(['jpeg'], 'card.jpg', { type: 'image/jpeg' });
    await userEvent.upload(
      document.querySelector('input[data-card-scan]') as HTMLInputElement,
      file,
    );

    expect(await screen.findByText(/Read by AI/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === `POST ${PATH}/scan`)).toBe(true);
    // The card was the back nine; Jerry's scores are in, hole 13 outlined to check.
    expect(screen.getByLabelText('Jerry hole 10')).toHaveValue('5');
    expect(screen.getByLabelText('Jerry hole 13').className).toMatch(/amber/);
    expect(screen.getByLabelText('Brian hole 10')).toHaveValue('');
    expect(screen.getByText(/Still missing: Brian/)).toBeInTheDocument();

    // "B-Man" is Brian's nickname; "Uncle Joe" isn't in this foursome.
    await userEvent.selectOptions(screen.getByLabelText('Who is B-Man on the card'), 'brian');
    expect(screen.getByLabelText('Brian hole 10')).toHaveValue('6');
    expect(screen.queryByText(/Still missing/)).not.toBeInTheDocument();
    // Matching two rows to one player warns.
    await userEvent.selectOptions(screen.getByLabelText('Who is Uncle Joe on the card'), 'brian');
    expect(screen.getByText('Two rows are matched to the same player.')).toBeInTheDocument();
    // As a sub for Brian instead: Brian is marked absent with the sub's name.
    await userEvent.selectOptions(screen.getByLabelText('Who is Uncle Joe on the card'), 'ignore');
    await userEvent.selectOptions(screen.getByLabelText('Who is B-Man on the card'), 'sub:brian');
    expect(screen.getByLabelText('Sub for Brian (optional)')).toHaveValue('B-Man');
  });
});

describe('standings page', () => {
  it('lists players by points with W/L/T', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${L}/seasons`]: () => ({
        status: 200,
        body: [{ id: S, name: '2027', status: 'scheduled', startDate: '2027-04-21', weeks: 15 }],
      }),
      [`GET /api/leagues/${L}/seasons/${S}/standings`]: () => ({
        status: 200,
        body: {
          provisional: true,
          roundsCounted: 2,
          rows: [
            {
              rank: 1,
              playerId: 'a',
              nickname: 'Richie Jr',
              spot: 1,
              W: 2,
              L: 0,
              T: 0,
              played: 2,
              points: 6,
            },
            {
              rank: 2,
              playerId: 'b',
              nickname: 'Jerry',
              spot: 2,
              W: 1,
              L: 0,
              T: 1,
              played: 2,
              points: 4,
            },
          ],
        },
      }),
    });
    renderAt(`/leagues/${L}/standings`);
    expect(
      await screen.findByText(/After 2 rounds · includes cards still open for disputes/),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByText('Richie Jr')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('6')).toBeInTheDocument();
  });
});

describe('imported history card', () => {
  it('shows totals and the official result', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({
        status: 200,
        body: view({
          teeTime: '',
          card: {
            id: 'card1',
            status: 'final',
            layoutId: 'front',
            version: 1,
            enteredBy: null,
            submittedAt: null,
            finalAt: null,
            dispute: null,
            rounds: [
              {
                playerId: 'jerry',
                handicap: 7,
                attendance: 'played',
                subName: null,
                holeScores: [],
                gross: 44,
              },
              {
                playerId: 'brian',
                handicap: 14,
                attendance: 'absent',
                subName: null,
                holeScores: [],
                gross: null,
              },
            ],
          },
          matches: [
            {
              id: 'm1',
              playerA: 'jerry',
              playerB: 'brian',
              result: {
                outcome: 'T',
                decidedBy: 'official',
                strokes: { A: 0, B: 7 },
                net: { A: 44, B: null },
              },
            },
          ],
          permissions: {
            canEdit: false,
            canSubmit: false,
            canDispute: false,
            canApprove: false,
            needsReason: false,
          },
        }),
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    expect(await screen.findByText('Round 1 result')).toBeInTheDocument();
    expect(screen.getByText('Absent')).toBeInTheDocument();
    expect(screen.getByText(/official result from the league sheet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Jerry hole 1')).not.toBeInTheDocument();
  });
});
