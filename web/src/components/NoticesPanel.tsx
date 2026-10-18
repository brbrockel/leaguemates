import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCheck,
  Info,
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
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import {
  noticesKey,
  siteNoticesKey,
  useMarkNotices,
  useNotices,
  useSiteNotices,
} from '@/components/NoticeBanners';
import {
  api,
  type Announcement,
  type NoticeAudience,
  type SeasonSchedule,
  type SeasonSummary,
  type SiteNotice,
} from '@/lib/api';
import { smsHref } from '@/lib/sms';
import { formatDay, timeAgo } from '@/lib/time';
import { cn, ordinal } from '@/lib/utils';

/**
 * The horn in the top bar: how many notices are unread that aren't already showing as a
 * banner, and a panel with every notice for the league you're in plus TeeMate's own. Opening
 * it doesn't mark anything read: ✓ marks one, "Mark all read" marks the lot. League admins
 * post here; site admins post to everyone.
 */
export function NoticesButton({
  leagueId,
  leagueName,
  isLeagueAdmin,
  isSiteAdmin,
  open,
  onOpenChange,
}: {
  leagueId: string | undefined;
  leagueName: string | undefined;
  isLeagueAdmin: boolean;
  isSiteAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const league = useNotices(leagueId);
  const site = useSiteNotices();
  const mark = useMarkNotices(leagueId);
  const leagueItems = league.data ?? [];
  const siteItems = site.data ?? [];
  const count = [...leagueItems, ...siteItems].filter((n) => !n.read && !n.banner).length;

  // Notices stay unread until you mark them: one at a time, or all at once.
  const leagueUnread = leagueItems.filter((n) => !n.read).map((n) => n.id);
  const siteUnread = siteItems.filter((n) => !n.read).map((n) => n.id);
  const markAllRead = () => {
    if (leagueUnread.length) mark.mutate({ site: false, ids: leagueUnread, how: 'read' });
    if (siteUnread.length) mark.mutate({ site: true, ids: siteUnread, how: 'read' });
  };
  const markRead = (site: boolean, id: string) => mark.mutate({ site, ids: [id], how: 'read' });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={count ? `Notices (${count} new)` : 'Notices'}
        onClick={() => onOpenChange(true)}
      >
        <Megaphone />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title="Notices">
          <div className="flex flex-col gap-5">
            {leagueUnread.length + siteUnread.length > 0 && (
              <Button size="sm" variant="outline" className="self-end" onClick={markAllRead}>
                <CheckCheck /> Mark all read
              </Button>
            )}
            {leagueId && (
              <NoticeSection
                title={leagueName ?? 'League'}
                empty="No notices yet."
                canPost={isLeagueAdmin}
                form={(done) => <NoticeForm leagueId={leagueId} onDone={done} />}
              >
                {leagueItems.map((a) => (
                  <NoticeItem
                    key={a.id}
                    leagueId={leagueId}
                    a={a}
                    canEdit={isLeagueAdmin}
                    onRead={() => markRead(false, a.id)}
                  />
                ))}
              </NoticeSection>
            )}
            {!leagueId && siteItems.length === 0 && !isSiteAdmin && (
              <p className="text-sm text-muted-foreground">No notices yet.</p>
            )}
            {(siteItems.length > 0 || isSiteAdmin) && (
              <NoticeSection
                title="TeeMate"
                hint="For everyone using TeeMate"
                empty="Nothing for everyone right now."
                canPost={isSiteAdmin}
                form={(done) => <SiteNoticeForm onDone={done} />}
              >
                {siteItems.map((n) => (
                  <SiteNoticeItem
                    key={n.id}
                    n={n}
                    canEdit={isSiteAdmin}
                    onRead={() => markRead(true, n.id)}
                  />
                ))}
              </NoticeSection>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NoticeSection({
  title,
  hint,
  empty,
  canPost,
  form,
  children,
}: {
  title: string;
  hint?: string;
  empty: string;
  canPost: boolean;
  form: (done: () => void) => React.ReactNode;
  children: React.ReactNode[];
}) {
  const [posting, setPosting] = useState(false);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {canPost && !posting && (
          <Button size="sm" variant="outline" onClick={() => setPosting(true)}>
            <Plus /> {title === 'TeeMate' ? 'Notice for everyone' : 'New notice'}
          </Button>
        )}
      </div>
      {posting && form(() => setPosting(false))}
      {children.length === 0 && !posting ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">{children}</ul>
      )}
    </section>
  );
}

/** For admins: how long it shows as a banner ("banner until Fri, Oct 24"), if it still does. */
function bannerNote(bannerUntil: string | null) {
  if (bannerUntil === null) return 'banner until cleared';
  const isDay = bannerUntil.length === 10;
  const ends = new Date(isDay ? `${bannerUntil}T23:59:59` : bannerUntil);
  if (ends < new Date()) return null;
  return `banner until ${formatDay(isDay ? bannerUntil : localDay(ends))}`;
}
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** How long a new notice shows as a banner. */
const BANNER_CHOICES: { value: string; label: string }[] = [
  { value: '0', label: 'No banner (notices list only)' },
  { value: '1', label: '1 day' },
  { value: '2', label: '2 days' },
  { value: '3', label: '3 days' },
  { value: '7', label: '1 week' },
  { value: '14', label: '2 weeks' },
  { value: 'kept', label: 'Until each person clears it' },
];
const toDays = (v: string) => (v === 'kept' ? null : Number(v));
/** The choice closest to an existing notice's banner. */
function choiceFor(n: { pinned?: boolean; createdAt: string; bannerUntil: string | null }) {
  if (n.pinned || n.bannerUntil === null) return 'kept';
  const days = (Date.parse(n.bannerUntil) - Date.parse(n.createdAt)) / 86_400_000;
  return BANNER_CHOICES.filter((c) => c.value !== 'kept').reduce((best, c) =>
    Math.abs(Number(c.value) - days) < Math.abs(Number(best.value) - days) ? c : best,
  ).value;
}

function BannerSelect({
  id,
  value,
  onChange,
  only,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Leave out choices that don't fit (e.g. must-see needs an end). */
  only?: (v: string) => boolean;
}) {
  return (
    <>
      <Label htmlFor={id}>Show as a banner</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {BANNER_CHOICES.filter((c) => !only || only(c.value)).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
    </>
  );
}

function NoticeItem({
  leagueId,
  a,
  canEdit,
  onRead,
}: {
  leagueId: string;
  a: Announcement;
  canEdit: boolean;
  onRead: () => void;
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
          {[
            a.to,
            a.author,
            timeAgo(a.createdAt),
            a.updatedAt && 'edited',
            canEdit && !a.kind && bannerNote(a.bannerUntil),
          ]
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
      {!a.read && <MarkReadButton title={a.title} onClick={onRead} />}
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

/** Who a notice from a shortcut is for (a foursome on the schedule, a person on People). */
export interface NoticePreset {
  audience: 'group' | 'person';
  groupId?: string;
  recipientUserId?: string;
  /** e.g. "Round 3, 2nd off: Jerry, Keith, Doc, Paul" or "Jerry". */
  label: string;
}

/** A new notice from a shortcut, already pointed at the right people. */
export function NoticeDialog({
  leagueId,
  preset,
  onClose,
}: {
  leagueId: string;
  preset: NoticePreset;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="New notice" description={`For ${preset.label}`}>
        <NoticeForm leagueId={leagueId} preset={preset} onDone={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function NoticeForm({
  leagueId,
  existing,
  preset,
  onDone,
}: {
  leagueId: string;
  existing?: Announcement;
  preset?: NoticePreset;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [audience, setAudience] = useState<NoticeAudience>(preset?.audience ?? 'league');
  const startBanner = existing ? choiceFor(existing) : audience === 'league' ? '7' : '2';
  const [banner, setBanner] = useState<string | null>(null);
  // Until it's chosen, it follows the audience (a week for the league, two days otherwise).
  const bannerChoice = banner ?? startBanner;
  const [weekId, setWeekId] = useState('');
  const [groupId, setGroupId] = useState(preset?.groupId ?? '');
  const [personId, setPersonId] = useState(preset?.recipientUserId ?? '');
  const [email, setEmail] = useState(false);
  const [sent, setSent] = useState<{ phones: string[]; emailed: number; held: number } | null>(
    null,
  );

  const schedule = useFoursomes(leagueId, audience === 'group' && !preset);
  const members = useQuery({
    queryKey: ['league', leagueId, 'members'],
    queryFn: () =>
      api<{
        members: { userId: string; name: string | null; email: string }[];
        players: { nickname: string; userId: string | null }[];
      }>(`/leagues/${leagueId}/members`),
    enabled: audience === 'person' && !preset,
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
            body: {
              title,
              body,
              // Only when changed: it counts from now.
              ...(banner !== null && banner !== startBanner ? { bannerDays: toDays(banner) } : {}),
            },
          })
        : api<{ phones: string[]; emailed: number; held: number }>(
            `/leagues/${leagueId}/announcements`,
            {
              method: 'POST',
              body: {
                title,
                body,
                bannerDays: toDays(bannerChoice),
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
      {!existing && !preset && (
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
      <BannerSelect id={`a-banner-${id}`} value={bannerChoice} onChange={setBanner} />
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

function SiteNoticeItem({
  n,
  canEdit,
  onRead,
}: {
  n: SiteNotice;
  canEdit: boolean;
  onRead: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/notices/site/${n.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: siteNoticesKey }),
  });
  if (editing)
    return (
      <li className="py-3">
        <SiteNoticeForm existing={n} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className="flex gap-2 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-center gap-1.5', !n.read ? 'font-semibold' : 'font-medium')}>
          <Info className="size-3.5 shrink-0 text-primary" aria-hidden />
          {n.title}
        </div>
        {n.body && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {n.body}
          </p>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          {[
            timeAgo(n.createdAt),
            n.updatedAt && 'edited',
            canEdit && n.mustSee && 'must see',
            canEdit && bannerNote(n.bannerUntil),
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {!n.read && <MarkReadButton title={n.title} onClick={onRead} />}
      {canEdit && (
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Edit ${n.title}`}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Delete ${n.title}`}
            disabled={remove.isPending}
            onClick={() => window.confirm(`Delete "${n.title}"?`) && remove.mutate()}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/** Site admins: a notice for everyone using TeeMate, guests included. */
function SiteNoticeForm({ existing, onDone }: { existing?: SiteNotice; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [mustSee, setMustSee] = useState(existing?.mustSee ?? false);
  const startBanner = existing ? choiceFor(existing) : '7';
  const [banner, setBanner] = useState(startBanner);
  // Nobody can clear a must-see notice, so it has to end by itself.
  const ends = (v: string) => v !== 'kept' && v !== '0';
  const save = useMutation({
    mutationFn: () => {
      const fields = {
        title,
        body,
        mustSee,
        ...(!existing || banner !== startBanner ? { bannerDays: toDays(banner) } : {}),
      };
      return existing
        ? api(`/notices/site/${existing.id}`, { method: 'PATCH', body: fields })
        : api('/notices/site', { method: 'POST', body: fields });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: siteNoticesKey });
      onDone();
    },
  });
  const id = existing?.id ?? 'new-site';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="flex flex-col gap-2"
    >
      <Label htmlFor={`s-title-${id}`}>Title</Label>
      <Input
        id={`s-title-${id}`}
        required
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Down for updates Sunday 8–9pm"
      />
      <Label htmlFor={`s-body-${id}`}>Details</Label>
      <textarea
        id={`s-body-${id}`}
        rows={3}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-lg border bg-card px-3 py-2 text-base shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
      />
      <BannerSelect
        id={`s-banner-${id}`}
        value={banner}
        onChange={setBanner}
        only={mustSee ? ends : undefined}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mustSee}
          onChange={(e) => {
            setMustSee(e.target.checked);
            if (e.target.checked && !ends(banner)) setBanner('7');
          }}
        />
        Everyone must see it (no ✕ until it ends)
      </label>
      {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !title.trim()}>
          <Check /> {existing ? 'Save' : 'Post to everyone'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** ✓ on an unread notice: marks just that one read. */
function MarkReadButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-label={`Mark ${title} read`}
      title="Mark read"
      onClick={onClick}
    >
      <Check />
    </Button>
  );
}
