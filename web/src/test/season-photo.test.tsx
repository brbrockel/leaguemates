import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SeasonBanner } from '@/components/Photos';
import type { PhotoView } from '@/lib/api';
import { me, mockApi } from './render';

const L = me.leagues[0]!.id;
const S = '22222222-2222-4222-8222-222222222222';
const admin = me;
const member = { ...me, leagues: me.leagues.map((l) => ({ ...l, role: 'user' as const })) };
const team: PhotoView = {
  id: 'team',
  groupId: null,
  caption: 'The 2026 team',
  width: 2048,
  height: 1536,
  createdAt: '2026-06-01T00:00:00Z',
  uploader: null,
  date: null,
  weekId: null,
  seasonId: S,
  seasonName: '2026',
  teamPhoto: true,
  round: null,
  canDelete: true,
};

function show(crop: { x: number; y: number; w: number; h: number } | null, who = admin) {
  const calls = mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: who }),
    [`GET /api/leagues/${L}/photos?seasonId=${S}`]: () => ({ status: 200, body: [team] }),
    [`PUT /api/leagues/${L}/seasons/${S}/cover`]: () => ({ status: 200, body: {} }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SeasonBanner leagueId={L} seasonId={S} coverPhotoId="team" coverCrop={crop} />
    </QueryClientProvider>,
  );
  return calls;
}

describe('season photo framing', () => {
  it('shows only the framed part of the photo', async () => {
    show({ x: 0.25, y: 0.4, w: 0.5, h: 0.375 });
    const img = await screen.findByAltText('The 2026 team');
    // Twice as wide as the banner, moved half a banner left.
    expect(img.style.width).toBe('200%');
    expect(img.style.left).toBe('-50%');
    expect(img.parentElement!.style.aspectRatio).toBe('1024 / 576');
  });

  it('an admin zooms and drags to frame it, and can show the whole photo again', async () => {
    const calls = show(null);
    await userEvent.click(await screen.findByRole('button', { name: /Adjust/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Frame the season photo' });
    fireEvent.change(within(dialog).getByRole('slider', { name: 'Zoom' }), {
      target: { value: '2' },
    });
    // Move the view right (towards the people) with the keyboard.
    const frame = within(dialog).getByRole('application');
    fireEvent.keyDown(frame, { key: 'ArrowRight' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.key.startsWith('PUT'))!.init!.body));
    expect(body.photoId).toBe('team');
    // At 2x the 16:9 view of a 4:3 photo is half its width; one step right moves 5% of that.
    expect(body.crop.w).toBeCloseTo(0.5);
    expect(body.crop.h).toBeCloseTo(0.375);
    expect(body.crop.x).toBeCloseTo(0.25 + 0.025);
    expect(body.crop.y).toBeCloseTo(0.3125);
  });

  it('only admins can adjust it', async () => {
    show(null, member);
    await screen.findByAltText('The 2026 team');
    expect(screen.queryByRole('button', { name: /Adjust/ })).toBeNull();
  });
});
