import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Course, CourseLayout } from '@/lib/api';
import { me, mockApi, renderAt } from './render';

const siteAdmin = { ...me, user: { ...me.user, isSiteAdmin: true } };
const pars = [5, 4, 4, 3, 4, 5, 3, 4, 4];
const front: CourseLayout = {
  id: 'front',
  name: 'Front 9',
  tees: 'White',
  par: 36,
  yards: null,
  cards: 0,
  retiredAt: null,
  cardGrid: null,
  holes: pars.map((par, i) => ({ number: i + 1, par, strokeIndex: i + 1, yards: null })),
};
const course = (layout: CourseLayout = front): Course => ({
  id: 'timberlin',
  name: 'Timberlin Golf Club',
  city: 'Berlin',
  state: 'CT',
  notes: null,
  website: null,
  lat: null,
  lng: null,
  pinned: true,
  images: [
    { id: 'card-front', caption: 'Front', width: 1000, height: 400 },
    { id: 'card-back', caption: 'Back', width: 1000, height: 400 },
  ],
  layouts: [layout],
});

/** Taps the picture at (x, y), as fractions of it. */
function tapAt(x: number, y: number) {
  const area = screen.getByTestId('card-tap-area');
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 400,
  } as DOMRect);
  fireEvent.click(area, { clientX: x * 1000, clientY: y * 400 });
}

describe('course card setup (site admin)', () => {
  it('marks the boxes with a few taps, previews sample scores, and saves', async () => {
    let saved: unknown = null;
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: siteAdmin }),
      'GET /api/courses': () => ({ status: 200, body: [course()] }),
      'PUT /api/courses/timberlin/layouts/front/card-grid': (init) => {
        saved = JSON.parse(String(init?.body));
        return {
          status: 200,
          body: course({ ...front, cardGrid: saved as CourseLayout['cardGrid'] }),
        };
      },
    });
    renderAt('/courses/timberlin');
    await userEvent.click(await screen.findByRole('button', { name: 'Set up the course card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Course card: Front 9' });

    // The back nine's picture is chosen instead.
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Back' }));
    expect(
      within(dialog).getByText(/Tap the hole 1 box on the first player's line/),
    ).toBeInTheDocument();
    tapAt(0.2, 0.4);
    expect(within(dialog).getByText(/Tap the hole 9 box on the same line/)).toBeInTheDocument();
    tapAt(0.6, 0.4);
    expect(within(dialog).getByText(/Tap the Out box/)).toBeInTheDocument();
    tapAt(0.65, 0.4);
    // No name column: skip it.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Skip' }));
    tapAt(0.2, 0.45);
    // A slip: undo it and tap again.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Undo' }));
    expect(within(dialog).getByText(/player line 2\./)).toBeInTheDocument();
    tapAt(0.2, 0.46);
    tapAt(0.2, 0.6);
    // The fourth line follows the spacing: skip.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Skip' }));

    expect(within(dialog).getByText(/Check the sample scores/)).toBeInTheDocument();
    // Four sample lines: the fourth continues the spacing of the last two.
    expect(dialog.querySelectorAll('[data-mark]').length).toBe(4 * 9);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toEqual({
      imageId: 'card-back',
      grid: {
        rows: [
          [0.2, 0.4],
          [0.2, 0.46],
          [0.2, 0.6],
        ],
        last: [0.6, 0.4],
        total: [0.65, 0.4],
        name: null,
      },
    });
    expect(await screen.findByText('Scores are written on the course card.')).toBeInTheDocument();
  });

  it("isn't offered without a picture of the card, or to other members", async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/courses': () => ({ status: 200, body: [course()] }),
    });
    renderAt('/courses/timberlin');
    await screen.findByText('Front 9');
    expect(screen.queryByRole('button', { name: 'Set up the course card' })).toBeNull();
  });
});
