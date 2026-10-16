import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Megaphone, Pin, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, type Announcement } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

export const noticesKey = (leagueId: string) => ['announcements', leagueId];

/**
 * Home: one line while there's something new (unread) or pinned, nothing otherwise. Tap to
 * expand (that marks them read) and tap a notice for its full text; ✕ clears the strip
 * until something new arrives.
 */
export function NoticeStrip({ leagueId }: { leagueId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: [...noticesKey(leagueId), 20],
    queryFn: () => api<Announcement[]>(`/leagues/${leagueId}/announcements?limit=20`),
  });
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);
  const mark = useMutation({
    mutationFn: ({ ids, how }: { ids: string[]; how: 'read' | 'dismiss' }) =>
      api(`/leagues/${leagueId}/announcements/${how}`, { method: 'POST', body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noticesKey(leagueId) }),
  });

  const notices = (list.data ?? []).filter((n) => !n.dismissed && (!n.read || n.pinned));
  if (!notices.length) return null;
  const newest = notices.find((n) => !n.read) ?? notices[0]!;

  const expand = () => {
    setOpen((o) => !o);
    const unread = notices.filter((n) => !n.read).map((n) => n.id);
    if (!open && unread.length) mark.mutate({ ids: unread, how: 'read' });
  };
  const dismiss = () => {
    mark.mutate({ ids: notices.map((n) => n.id), how: 'dismiss' });
    setOpen(false);
  };

  return (
    <section aria-label="Notices" className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={expand}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <Megaphone className="size-4 shrink-0 text-primary" aria-hidden />
          {open ? (
            <span className="font-medium">Notices</span>
          ) : (
            <>
              <span className={cn('truncate', !newest.read && 'font-medium')}>{newest.title}</span>
              {notices.length > 1 && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  +{notices.length - 1} more
                </span>
              )}
            </>
          )}
          {open ? (
            <ChevronUp className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Clear notices"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </div>
      {open && (
        <ul className="divide-y border-t px-3">
          {notices.map((n) => (
            <li key={n.id} className="py-2">
              <button
                type="button"
                className="flex w-full items-start gap-1.5 text-left text-sm"
                onClick={() => setShowing(showing === n.id ? null : n.id)}
              >
                {n.pinned && (
                  <Pin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Pinned" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{n.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {n.to} · {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
              {showing === n.id && n.body && (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {n.body}
                </p>
              )}
            </li>
          ))}
          <li className="py-2 text-xs">
            <Link to={`/leagues/${leagueId}#notices`} className="text-primary hover:underline">
              All notices
            </Link>
          </li>
        </ul>
      )}
    </section>
  );
}
