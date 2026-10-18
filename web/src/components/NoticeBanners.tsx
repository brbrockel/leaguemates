import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Megaphone, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { api, type Announcement, type SiteNotice } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

export const noticesKey = (leagueId: string) => ['announcements', leagueId];
export const siteNoticesKey = ['site-notices'];

/** A league's latest notices (shared by the banners and the notices panel). */
export function useNotices(leagueId: string | undefined) {
  return useQuery({
    queryKey: [...noticesKey(leagueId ?? ''), 50],
    queryFn: () => api<Announcement[]>(`/leagues/${leagueId}/announcements?limit=50`),
    enabled: Boolean(leagueId),
  });
}

/** Notices from site admins to everyone. */
export function useSiteNotices() {
  return useQuery({
    queryKey: siteNoticesKey,
    queryFn: () => api<SiteNotice[]>('/notices/site'),
  });
}

/** Marks league or site notices read or dismissed. */
export function useMarkNotices(leagueId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ site, ids, how }: { site: boolean; ids: string[]; how: 'read' | 'dismiss' }) =>
      api(site ? `/notices/site/${how}` : `/leagues/${leagueId}/announcements/${how}`, {
        method: 'POST',
        body: { ids },
      }),
    onSuccess: (_, v) =>
      qc.invalidateQueries({ queryKey: v.site ? siteNoticesKey : noticesKey(leagueId ?? '') }),
  });
}

/** Guests can't keep anything on the server: the site banners they close are kept here. */
const GUEST_KEY = 'teemate.siteNotices.dismissed';
function guestDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

interface Banner {
  id: string;
  site: boolean;
  title: string;
  body: string;
  /** Who it's for or from: "TeeMate", "League", "Your foursome", "You". */
  label: string;
  urgent: boolean;
  dismissible: boolean;
  read: boolean;
  createdAt: string;
  /** 0 first: site-wide, then rainouts and skips, then for you or your foursome, then the league. */
  rank: number;
}

const tint = (urgent: boolean) =>
  urgent ? 'border-amber-500/40 bg-amber-500/10' : 'border-primary/30 bg-primary/10';

/**
 * Banners at the top of every page, by urgency: site-wide notices, a rainout or skip, notices
 * for you or your foursome, then the league's. With more than one they sit in a stack, like a
 * phone's notifications: the most urgent on top, the edges of the rest peeking out below; tap
 * the stack to fan them out. Each is one line; tap for the full text (that marks it read), ✕
 * clears it for good where it can be cleared. Routine notices (cards, playoffs) never show
 * here, only in the notices panel.
 */
export function NoticeBanners({
  leagueId,
  guest,
}: {
  leagueId: string | undefined;
  guest: boolean;
}) {
  const league = useNotices(guest ? undefined : leagueId);
  const site = useSiteNotices();
  const mark = useMarkNotices(leagueId);
  const [open, setOpen] = useState<string | null>(null);
  const [fanned, setFanned] = useState(false);
  const [closed, setClosed] = useState<string[]>(() => (guest ? guestDismissed() : []));

  const banners: Banner[] = [
    ...(site.data ?? [])
      .filter((n) => n.banner)
      .map((n) => ({ ...n, site: true, label: 'TeeMate', urgent: false, rank: 0 })),
    ...(league.data ?? [])
      .filter((n) => n.banner)
      .map((n) => ({
        ...n,
        site: false,
        label: n.to,
        rank: n.urgent ? 1 : n.audience === 'league' ? 3 : 2,
      })),
  ]
    .filter((b) => !(b.dismissible && closed.includes(b.id)))
    .sort((a, b) => a.rank - b.rank || b.createdAt.localeCompare(a.createdAt));
  if (!banners.length) return null;
  const stacked = banners.length > 1 && !fanned;

  const toggle = (b: Banner) => {
    setOpen(open === b.id ? null : b.id);
    if (!b.read && !guest) mark.mutate({ site: b.site, ids: [b.id], how: 'read' });
  };
  const dismiss = (b: Banner) => {
    setClosed((c) => [...c, b.id]);
    if (guest) {
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify([...guestDismissed(), b.id]));
      } catch {
        // Private browsing: it shows again next visit.
      }
    } else mark.mutate({ site: b.site, ids: [b.id], how: 'dismiss' });
  };

  const row = (b: Banner, extra?: React.ReactNode) => {
    const Icon = b.urgent ? TriangleAlert : b.site ? Info : Megaphone;
    return (
      // Solid underneath so the stack's lower layers don't show through the tint.
      <div key={b.id} className="relative z-10 rounded-xl bg-background shadow-xs">
        <div
          role={b.urgent ? 'alert' : undefined}
          className={cn('rounded-xl border px-3 py-2 text-sm', tint(b.urgent))}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={open === b.id}
              onClick={() => toggle(b)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <Icon
                className={cn('size-4 shrink-0', b.urgent ? 'text-amber-600' : 'text-primary')}
                aria-hidden
              />
              <span className={cn('truncate', b.read ? 'font-normal' : 'font-medium')}>
                {b.title}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{b.label}</span>
            </button>
            {extra}
            {b.dismissible ? (
              <button
                type="button"
                onClick={() => dismiss(b)}
                aria-label={`Dismiss ${b.title}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-4" />
              </button>
            ) : (
              <span className="size-6 shrink-0" aria-hidden />
            )}
          </div>
          {open === b.id && (
            <div className="mt-1 pl-6">
              {b.body && (
                <p className="whitespace-pre-wrap break-words text-muted-foreground">{b.body}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {timeAgo(b.createdAt)}
                {!b.dismissible &&
                  (b.urgent ? ' · stays up through the day' : ' · stays up until it ends')}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (stacked) {
    const [top, ...rest] = banners;
    const fan = () => setFanned(true);
    const peeks = rest.slice(0, 2);
    return (
      <section
        aria-label="Notices"
        className={cn('relative mb-4', peeks.length > 1 ? 'pb-4' : 'pb-2')}
      >
        {row(
          top!,
          <button
            type="button"
            onClick={fan}
            aria-label={`Show all ${banners.length} notices`}
            className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
          >
            +{rest.length}
          </button>,
        )}
        {/* The edges of the next ones, peeking out below; tap them to fan the stack out. */}
        {peeks.map((b, i) => (
          <button
            key={b.id}
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={fan}
            className={cn(
              'absolute inset-x-0 rounded-xl bg-background',
              i === 0 ? 'bottom-2 z-[5] mx-2 h-6' : 'bottom-0 z-0 mx-4 h-6',
            )}
          >
            <span className={cn('block h-full rounded-xl border', tint(b.urgent))} />
          </button>
        ))}
      </section>
    );
  }

  return (
    <section aria-label="Notices" className="mb-4 flex flex-col gap-1.5">
      {banners.map((b) => row(b))}
      {banners.length > 1 && (
        <button
          type="button"
          onClick={() => setFanned(false)}
          className="self-center rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          Show less
        </button>
      )}
    </section>
  );
}
