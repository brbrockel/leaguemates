import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Megaphone,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { noticesKey } from '@/components/NoticeStrip';
import {
  api,
  type Announcement,
  type NoticeAudience,
  type SeasonSchedule,
  type SeasonSummary,
} from '@/lib/api';
import { smsHref } from '@/lib/sms';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * League page: every notice you can see, collapsed to one line until opened. Admins post to
 * the league, one foursome or one person, optionally email it, and can text it from their
 * own phone. Notices the app writes itself (cards, rainouts, playoffs) show here too.
 */
export function AnnouncementsCard({
  leagueId,
  isAdmin = false,
}: {
  leagueId: string;
  isAdmin?: boolean;
}) {
  const list = useQuery({
    queryKey: [...noticesKey(leagueId), 50],
    queryFn: () => api<Announcement[]>(`/leagues/${leagueId}/announcements?limit=50`),
  });
  const [open, setOpen] = useState(() => window.location.hash === '#notices');
  const [posting, setPosting] = useState(false);
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;

  return (
    <Card id="notices">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-primary" aria-hidden /> Notices
          </CardTitle>
          <CardDescription className="truncate">
            {items.length === 0
              ? 'None yet'
              : unread
                ? `${unread} new`
                : `${items.length} · latest ${timeAgo(items[0]!.createdAt)}`}
          </CardDescription>
          {open ? (
            <ChevronUp className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </button>
        {isAdmin && !posting && (
          <Button
            size="sm"
            onClick={() => {
              setOpen(true);
              setPosting(true);
            }}
          >
            <Plus /> New notice
          </Button>
        )}
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-3">
          {posting && <NoticeForm leagueId={leagueId} onDone={() => setPosting(false)} />}
          {items.length === 0 && !posting && (
            <p className="text-sm text-muted-foreground">No notices yet.</p>
          )}
          <ul className="divide-y">
            {items.map((a) => (
              <NoticeItem key={a.id} leagueId={leagueId} a={a} canEdit={isAdmin} />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function NoticeItem({
  leagueId,
  a,
  canEdit,
}: {
  leagueId: string;
  a: Announcement;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/leagues/${leagueId}/announcements/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noticesKey(leagueId) }),
  });
  const phones = useMutation({
    mutationFn: () => api<string[]>(`/leagues/${leagueId}/announcements/${a.id}/phones`),
  });

  if (editing)
    return (
      <li className="py-3">
        <NoticeForm leagueId={leagueId} existing={a} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className="flex gap-2 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-center gap-1.5', !a.read ? 'font-semibold' : 'font-medium')}>
          {a.pinned && <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" />}
          {a.title}
        </div>
        {a.body && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {a.body}
          </p>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          {[a.to, a.author, timeAgo(a.createdAt), a.updatedAt && 'edited']
            .filter(Boolean)
            .join(' · ')}
        </div>
        {phones.data &&
          (phones.data.length ? (
            <Button asChild size="sm" variant="secondary" className="mt-2">
              <a href={smsHref(phones.data, a.body ? `${a.title}\n\n${a.body}` : a.title)}>
                <MessageSquare /> Send the text ({phones.data.length})
              </a>
            </Button>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Nobody it's for has a phone number.
            </p>
          ))}
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-1">
          {!a.kind && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Text ${a.title}`}
              title="Text it from your phone"
              disabled={phones.isPending}
              onClick={() => phones.mutate()}
            >
              <MessageSquare />
            </Button>
          )}
          {!a.kind && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Edit ${a.title}`}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Delete ${a.title}`}
            disabled={remove.isPending}
            onClick={() => window.confirm(`Delete "${a.title}"?`) && remove.mutate()}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/** Choose a round's foursome from the league's current season. */
function useFoursomes(leagueId: string, enabled: boolean) {
  const seasons = useQuery({
    queryKey: ['seasons', leagueId],
    queryFn: () => api<SeasonSummary[]>(`/leagues/${leagueId}/seasons`),
    enabled,
  });
  const current = seasons.data?.find((s) => s.status === 'scheduled');
  const schedule = useQuery({
    queryKey: ['season', current?.id],
    queryFn: () => api<SeasonSchedule>(`/leagues/${leagueId}/seasons/${current!.id}`),
    enabled: enabled && Boolean(current),
  });
  return schedule.data;
}

function NoticeForm({
  leagueId,
  existing,
  onDone,
}: {
  leagueId: string;
  existing?: Announcement;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [audience, setAudience] = useState<NoticeAudience>('league');
  const [weekId, setWeekId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [personId, setPersonId] = useState('');
  const [email, setEmail] = useState(false);
  const [sent, setSent] = useState<{ phones: string[]; emailed: number; held: number } | null>(
    null,
  );

  const schedule = useFoursomes(leagueId, audience === 'group');
  const members = useQuery({
    queryKey: ['league', leagueId, 'members'],
    queryFn: () =>
      api<{
        members: { userId: string; name: string | null; email: string }[];
        players: { nickname: string; userId: string | null }[];
      }>(`/leagues/${leagueId}/members`),
    enabled: audience === 'person',
  });
  const names = new Map((schedule?.roster ?? []).map((r) => [r.playerId, r.nickname]));
  const upcoming = schedule?.weeks.find((w) => w.status === 'scheduled');
  const week = schedule?.weeks.find((w) => w.id === (weekId || upcoming?.id));
  const people = (members.data?.members ?? [])
    .map((m) => ({
      userId: m.userId,
      label:
        members.data!.players.find((p) => p.userId === m.userId)?.nickname ?? m.name ?? m.email,
    }))
    .sort((x, y) => x.label.localeCompare(y.label));

  const save = useMutation({
    mutationFn: () =>
      existing
        ? api(`/leagues/${leagueId}/announcements/${existing.id}`, {
            method: 'PATCH',
            body: { title, body, pinned },
          })
        : api<{ phones: string[]; emailed: number; held: number }>(
            `/leagues/${leagueId}/announcements`,
            {
              method: 'POST',
              body: {
                title,
                body,
                pinned,
                audience,
                email,
                ...(audience === 'group' ? { groupId } : {}),
                ...(audience === 'person' ? { recipientUserId: personId } : {}),
              },
            },
          ),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: noticesKey(leagueId) });
      if (!existing && r) {
        const res = r as { phones: string[]; emailed: number; held: number };
        if (res.phones.length || email) {
          setSent(res);
          return;
        }
      }
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const id = existing?.id ?? 'new';
  const ready =
    title.trim() && (audience !== 'group' || groupId) && (audience !== 'person' || personId);

  if (sent)
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Posted.</p>
        {email && (
          <p className="text-sm text-muted-foreground">
            Emailed to {sent.emailed}
            {sent.held ? `; ${sent.held} held back by the mail guard` : ''}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {sent.phones.length > 0 && (
            <Button asChild size="sm" variant="secondary">
              <a href={smsHref(sent.phones, body ? `${title}\n\n${body}` : title)}>
                <MessageSquare /> Also text it ({sent.phones.length})
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {!existing && (
        <>
          <Label htmlFor="a-audience">For</Label>
          <Select
            id="a-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as NoticeAudience)}
          >
            <option value="league">The whole league</option>
            <option value="group">One foursome</option>
            <option value="person">One person</option>
          </Select>
          {audience === 'group' &&
            (schedule ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  aria-label="Round"
                  value={week?.id ?? ''}
                  onChange={(e) => {
                    setWeekId(e.target.value);
                    setGroupId('');
                  }}
                >
                  {schedule.weeks.map((w) => (
                    <option key={w.id} value={w.id}>
                      Round {w.round} · {w.date}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Foursome"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">Pick the foursome</option>
                  {week?.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {ordinal(g.slot + 1)} off:{' '}
                      {g.matches
                        .flatMap((m) => [m.playerA, m.playerB])
                        .map((p) => names.get(p) ?? '?')
                        .join(', ')}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Foursomes come from a locked season's schedule.
              </p>
            ))}
          {audience === 'person' && (
            <Select
              aria-label="Person"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Pick the person</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </>
      )}
      <Label htmlFor={`a-title-${id}`}>Title</Label>
      <Input
        id={`a-title-${id}`}
        required
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="No golf tonight: course closed"
      />
      <Label htmlFor={`a-body-${id}`}>Details</Label>
      <textarea
        id={`a-body-${id}`}
        rows={3}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-lg border bg-card px-3 py-2 text-base shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        Pin it (stays on everyone's Home until they clear it)
      </label>
      {!existing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
          Also email it
        </label>
      )}
      {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !ready}>
          <Check /> {existing ? 'Save' : 'Post'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
