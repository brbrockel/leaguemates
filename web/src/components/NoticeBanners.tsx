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

/** At most this many rows; past it, the last row says how many more there are. */
const MAX = 3;

/**
 * Banners at the top of every page, stacked by urgency: site-wide notices, a rainout or skip,
 * notices for you or your foursome, then the league's. One line each; tap for the full text
 * (that marks it read), ✕ clears it for good where it can be cleared. Routine notices (cards,
 * playoffs) never show here, only in the notices panel.
 */
export function NoticeBanners({
  leagueId,
  guest,
  onMore,
}: {
  leagueId: string | undefined;
  guest: boolean;
  /** Opens the notices panel. */
  onMore: () => void;
}) {
  const league = useNotices(guest ? undefined : leagueId);
  const site = useSiteNotices();
  const mark = useMarkNotices(leagueId);
  const [open, setOpen] = useState<string | null>(null);
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
  // Guests have no notices panel to send the rest to.
  const shown = !guest && banners.length > MAX ? banners.slice(0, MAX - 1) : banners;
  const more = banners.length - shown.length;

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

  return (
    <section aria-label="Notices" className="mb-4 flex flex-col gap-1.5">
      {shown.map((b) => {
        const Icon = b.urgent ? TriangleAlert : b.site ? Info : Megaphone;
        return (
          <div
            key={b.id}
            role={b.urgent ? 'alert' : undefined}
            className={cn(
              'rounded-xl border px-3 py-2 text-sm shadow-xs',
              b.urgent ? 'border-amber-500/40 bg-amber-500/10' : 'bg-card',
            )}
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
        );
      })}
      {more > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="rounded-xl border border-dashed px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
        >
          +{more} more {more === 1 ? 'notice' : 'notices'}
        </button>
      )}
    </section>
  );
}
