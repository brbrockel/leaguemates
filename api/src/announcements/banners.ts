import { z } from 'zod';

type Audience = 'league' | 'group' | 'person';

/** How many days a notice shows as a banner: 0 none, null until each person dismisses it. */
export const BannerDays = z.number().int().min(0).max(60).nullable();

export const DAY = 24 * 60 * 60 * 1000;
/** The app's routine notices (cards, playoffs): in the notices list only, never a banner. */
const ROUTINE = /^(card|playoffs)\./;
/** About the round itself: a banner through the day, and not dismissible on the day. */
const ROUND_OFF = new Set(['week.rainout', 'week.skip']);

/**
 * Whether a notice shows as a banner right now, for one person. Admins' league notices last
 * a week unless they chose otherwise (pinned: until dismissed), ones for a foursome or one
 * person two days, a rainout or skip through its day; routine ones never do.
 */
export function bannerState(
  n: {
    kind: string | null;
    audience: Audience;
    pinned: boolean;
    expiresAt: Date | null;
    forDate: string | null;
    createdAt: Date;
  },
  dismissed: boolean,
  now: Date,
  today: string,
) {
  if (n.kind && ROUTINE.test(n.kind))
    return { banner: false, dismissible: true, urgent: false, bannerUntil: null };
  const urgent = n.kind !== null && ROUND_OFF.has(n.kind);
  if (urgent && n.forDate) {
    // On the day itself it can't be cleared away, so nobody drives to the course.
    const dismissible = today !== n.forDate;
    const active = today <= n.forDate;
    return {
      banner: active && (!dismissed || !dismissible),
      dismissible,
      urgent,
      bannerUntil: n.forDate,
    };
  }
  const until =
    n.expiresAt ??
    (n.pinned
      ? null
      : new Date(n.createdAt.getTime() + (urgent || n.audience !== 'league' ? 2 : 7) * DAY));
  return {
    banner: !dismissed && (until === null || now < until),
    dismissible: true,
    urgent,
    bannerUntil: until?.toISOString() ?? null,
  };
}

/** Pinned and expiry from the days chosen; left out, the defaults apply. */
export function bannerFields(days: number | null | undefined, pinned?: boolean) {
  if (days === undefined) return pinned === undefined ? {} : { pinned };
  if (days === null) return { pinned: true, expiresAt: null };
  return { pinned: false, expiresAt: new Date(Date.now() + days * DAY) };
}
