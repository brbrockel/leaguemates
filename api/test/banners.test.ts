import { describe, expect, it } from 'vitest';
import { bannerFields, bannerState } from '../src/announcements/banners.js';

const created = new Date('2027-05-05T12:00:00Z');
const notice = (over: Partial<Parameters<typeof bannerState>[0]> = {}) => ({
  kind: null,
  audience: 'league' as const,
  pinned: false,
  expiresAt: null,
  forDate: null,
  createdAt: created,
  ...over,
});
const at = (days: number) => new Date(created.getTime() + days * 24 * 60 * 60 * 1000);

describe('banners', () => {
  it("an admin's league notice shows for a week, one for a foursome or a person two days", () => {
    expect(bannerState(notice(), false, at(6.9), '2027-05-11').banner).toBe(true);
    expect(bannerState(notice(), false, at(7.1), '2027-05-12').banner).toBe(false);
    const group = notice({ audience: 'group', kind: 'round.absent' });
    expect(bannerState(group, false, at(1.9), '2027-05-06').banner).toBe(true);
    expect(bannerState(group, false, at(2.1), '2027-05-07').banner).toBe(false);
  });

  it('pinned stays until dismissed; a chosen end date wins over the default', () => {
    const pinned = notice({ pinned: true });
    expect(bannerState(pinned, false, at(90), '2027-08-03')).toMatchObject({
      banner: true,
      bannerUntil: null,
    });
    expect(bannerState(pinned, true, at(1), '2027-05-06').banner).toBe(false);
    const short = notice({ expiresAt: at(1) });
    expect(bannerState(short, false, at(1.5), '2027-05-06').banner).toBe(false);
  });

  it('routine notices (cards, playoffs) are never banners', () => {
    for (const kind of ['card.submitted', 'card.disputed', 'playoffs.start'])
      expect(bannerState(notice({ kind }), false, at(0), '2027-05-05').banner).toBe(false);
  });

  it("a rainout shows through its day, and can't be dismissed on the day", () => {
    const rainout = notice({ kind: 'week.rainout', forDate: '2027-05-12' });
    expect(bannerState(rainout, false, at(1), '2027-05-06')).toMatchObject({
      banner: true,
      dismissible: true,
      urgent: true,
    });
    // Dismissed ahead of time: gone until the day, then back and here to stay.
    expect(bannerState(rainout, true, at(1), '2027-05-06').banner).toBe(false);
    expect(bannerState(rainout, true, at(7), '2027-05-12')).toMatchObject({
      banner: true,
      dismissible: false,
    });
    expect(bannerState(rainout, false, at(8), '2027-05-13').banner).toBe(false);
  });

  it('days chosen become pinned or an end date', () => {
    expect(bannerFields(undefined)).toEqual({});
    expect(bannerFields(undefined, true)).toEqual({ pinned: true });
    expect(bannerFields(null)).toEqual({ pinned: true, expiresAt: null });
    const { pinned, expiresAt } = bannerFields(3) as { pinned: boolean; expiresAt: Date };
    expect(pinned).toBe(false);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);
  });
});
