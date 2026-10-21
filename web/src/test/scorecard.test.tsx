import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CardGrid } from '@teemate/shared';
import type { ScorecardView } from '@/lib/api';
import { me, mockApi, renderAt } from './render';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(async () => new Blob(['png'])) }));

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

  it('draws the virtual scorecard on request, like the paper card', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({
        status: 200,
        body: view({
          course: { id: 'fox', name: 'Fox Run', city: 'Springfield', state: 'IL' },
          layouts: [
            {
              ...FRONT,
              tees: 'White',
              holes: FRONT.holes.map((h) => ({ ...h, yards: 300 + h.number })),
            },
            BACK,
          ],
        }),
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    // Not shown until asked for.
    expect(screen.queryByText('Fox Run')).not.toBeInTheDocument();
    for (const [h, s] of ['4', '4', '5', '3', '6', '5', '3', '4', '4'].entries())
      await userEvent.type(screen.getByLabelText(`Jerry hole ${h + 1}`), s); // 38
    await fillAll('Brian', '6'); // 54, gets 7 -> 47

    await userEvent.click(screen.getByRole('button', { name: /Virtual scorecard/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Virtual scorecard' });
    const card = within(dialog).getByRole('figure', { name: 'Round 1 · Front 9 card' });
    expect(within(card).getByText('Fox Run')).toBeInTheDocument();
    expect(within(card).getByText('Springfield, IL')).toBeInTheDocument();
    expect(within(card).getByText('WHITE')).toBeInTheDocument();
    expect(within(card).getByText(String(9 * 300 + 45))).toBeInTheDocument(); // total yards
    expect(within(dialog).getByText('Includes changes not saved yet.')).toBeInTheDocument();
    const marks = (label: string) => card.querySelectorAll(`[data-mark="${label}"]`).length;
    expect(marks('birdie')).toBe(2); // hole 1, plus the legend
    expect(marks('bogey')).toBe(1 + 2 + 1); // Jerry's 3rd, Brian's par 5s, legend
    expect(marks('double bogey or worse')).toBe(1 + 7 + 1); // Jerry's 5th, Brian's others, legend
    // No eagle on this card, so the legend doesn't explain one.
    expect(within(card).queryByText('eagle')).toBeNull();
    // Strokes aren't dotted on holes: the match is decided on total net.
    expect(within(card).queryByText('stroke')).toBeNull();
    expect(within(card).getByText('Jerry wins')).toBeInTheDocument();
    expect(within(card).getByText(/Brian gets 7/)).toBeInTheDocument();
  });

  it("writes the scores on the course's own card when it's set up", async () => {
    const grid: CardGrid = {
      rows: [
        [0.2, 0.4],
        [0.2, 0.5],
      ],
      last: [0.6, 0.4],
      total: [0.65, 0.4],
      name: [0.05, 0.4],
    };
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({
        status: 200,
        body: view({
          course: { id: 'fox', name: 'Fox Run', city: null, state: null },
          layouts: [
            { ...FRONT, cardGrid: { imageId: 'img', grid, width: 1000, height: 400 } },
            BACK,
          ],
        }),
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    await fillAll('Jerry', '5');
    await userEvent.click(screen.getByRole('button', { name: /Virtual scorecard/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Virtual scorecard' });
    expect(within(dialog).getByRole('radio', { name: 'Course card' })).toBeChecked();
    const card = within(dialog).getByRole('figure');
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/courses/fox/images/img');
    // Jerry's nine scores and his total are written on it, with both names.
    expect(
      card.querySelectorAll('[data-mark=under],[data-mark=par],[data-mark=over]'),
    ).toHaveLength(9);
    expect(within(card).getByText('45')).toBeInTheDocument();
    expect(within(card).getByText('Brian')).toBeInTheDocument();

    // Where sharing isn't offered, only Download image.
    expect(within(dialog).queryByRole('button', { name: 'Share image' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Download image' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Drawn card' }));
    expect(within(dialog).getByRole('figure').querySelector('img')).toBeNull();
    expect(within(within(dialog).getByRole('figure')).getByText('HANDICAP')).toBeInTheDocument();
  });

  it('a fold-over panel shows the name column from the other card', async () => {
    const at = (x: number): CardGrid => ({
      rows: [
        [x, 0.4],
        [x, 0.5],
      ],
      last: [x + 0.4, 0.4],
      total: null,
      name: null,
    });
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({
        status: 200,
        body: view({
          course: { id: 'fox', name: 'Fox Run', city: null, state: null },
          layouts: [
            {
              ...FRONT,
              cardGrid: {
                imageId: 'back-panel',
                grid: { ...at(0.05), nameFrom: 'other' },
                width: 1000,
                height: 400,
                names: {
                  imageId: 'front-card',
                  grid: { ...at(0.3), name: [0.03, 0.4] },
                  width: 1000,
                  height: 400,
                  holes: 9,
                },
              },
            },
            BACK,
          ],
        }),
      }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    await userEvent.click(screen.getByRole('button', { name: /Virtual scorecard/ }));
    const card = within(await screen.findByRole('dialog')).getByRole('figure');
    expect([...card.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
      '/api/courses/fox/images/front-card',
      '/api/courses/fox/images/back-panel',
    ]);
    expect(within(card).getByText('Jerry')).toBeInTheDocument();
  });

  it('shares the virtual scorecard as an image, or saves it where sharing is not offered', async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { canShare: () => true, share });
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view() }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await userEvent.click(await screen.findByRole('button', { name: /Virtual scorecard/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Share image' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [{ files, title }] = share.mock.calls[0] as unknown as [{ files: File[]; title: string }];
    expect(title).toBe('Round 1 · Front 9');
    expect(files[0]!.name).toBe('Round-1-Front-9-2099-04-21.png');
    expect(files[0]!.type).toBe('image/png');

    // The phone wants a fresh tap: the image waits for it.
    share.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share image' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Image ready: share it' }));
    expect(share).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Share image' })).toBeInTheDocument();

    // Download image saves it instead, beside Share.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:card');
    URL.revokeObjectURL = vi.fn();
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'Round-1-Front-9-2099-04-21.png',
    );
    expect(share).toHaveBeenCalledTimes(3);
    delete (navigator as { canShare?: unknown }).canShare;
    delete (navigator as { share?: unknown }).share;
  });

  it('double-circles an eagle and explains it in the legend', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view() }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    await userEvent.type(screen.getByLabelText('Jerry hole 1'), '3'); // par 5
    await userEvent.click(screen.getByRole('button', { name: /Virtual scorecard/ }));
    const card = within(await screen.findByRole('dialog')).getByRole('figure');
    // Jerry's 3, and the legend's sample.
    expect(card.querySelectorAll('[data-mark="eagle or better"]')).toHaveLength(2);
    expect(within(card).getByText('eagle')).toBeInTheDocument();
  });

  it('keeps unsaved scores through a reload, until saved or discarded', async () => {
    const saved = { ...view(), card: null };
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: saved }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    await userEvent.type(screen.getByLabelText('Jerry hole 1'), '3');
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    // The app reloads (an update, or the phone closed it): the page starts again.
    cleanup();
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    expect(await screen.findByText(/Your unsaved changes were brought back/)).toBeInTheDocument();
    expect(screen.getByLabelText('Jerry hole 1')).toHaveValue('3');
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Jerry hole 1')).toHaveValue('');
    expect(screen.queryByText(/brought back/)).toBeNull();
    expect(localStorage.getItem(`teemate.card-draft.${G}`)).toBeNull();
  });

  it('drops kept edits once someone else has saved the card', async () => {
    localStorage.setItem(
      `teemate.card-draft.${G}`,
      JSON.stringify({
        version: 1,
        layoutId: 'front',
        reason: '',
        entries: ['jerry', 'brian'].map((playerId) => ({
          playerId,
          handicap: 7,
          attendance: 'played',
          subName: '',
          holeScores: Array.from({ length: 9 }, () => 3),
        })),
      }),
    );
    const card = {
      id: 'c1',
      status: 'draft' as const,
      layoutId: 'front',
      version: 2,
      enteredBy: null,
      submittedAt: null,
      finalAt: null,
      dispute: null,
      rounds: [],
    };
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view({ card }) }),
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    expect(screen.queryByText(/brought back/)).toBeNull();
    expect(screen.getByLabelText('Jerry hole 1')).toHaveValue('');
    expect(localStorage.getItem(`teemate.card-draft.${G}`)).toBeNull();
  });

  it('an admin correcting a final card gives the reason beside Save', async () => {
    const bodies: { reason?: string }[] = [];
    const card = {
      id: 'c1',
      status: 'final' as const,
      layoutId: 'front',
      version: 2,
      enteredBy: 'Jerry',
      submittedAt: '2099-04-21T22:00:00Z',
      finalAt: '2099-04-23T22:00:00Z',
      dispute: null,
      rounds: ['jerry', 'brian'].map((playerId) => ({
        playerId,
        handicap: 7,
        attendance: 'played' as const,
        subName: null,
        holeScores: Array.from({ length: 9 }, () => 5),
      })),
    };
    const permissions = {
      canEdit: true,
      canSubmit: false,
      canDispute: false,
      canApprove: false,
      needsReason: true,
    };
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET ${PATH}`]: () => ({ status: 200, body: view({ card, permissions }) }),
      [`PUT ${PATH}`]: (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { status: 200, body: view({ card: { ...card, version: 3 }, permissions }) };
      },
    });
    renderAt(`/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}`);
    await screen.findByText('Round 1 scorecard');
    expect(screen.queryByLabelText('Reason for changing a submitted card')).toBeNull();
    const hole = screen.getByLabelText('Jerry hole 1');
    await userEvent.clear(hole);
    await userEvent.type(hole, '3');
    // The reason is asked for in the bar with Save, which waits for it.
    const save = screen.getByRole('button', { name: /^Save$/ });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for changing a submitted card'), 'Eagle');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.reason).toBe('Eagle');
    expect(await screen.findByRole('button', { name: /Saved/ })).toBeInTheDocument();
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
    // Kept on the device while unsaved...
    expect(localStorage.getItem(`teemate.card-draft.${G}`)).not.toBeNull();
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
    // ...and gone once saved.
    expect(localStorage.getItem(`teemate.card-draft.${G}`)).toBeNull();
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
    expect(
      screen.getByText(/as recorded on the league's sheet|one player was absent/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Jerry hole 1')).not.toBeInTheDocument();
  });
});
