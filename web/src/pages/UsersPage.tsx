import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultNickname } from '@teemate/shared';
import {
  Ban,
  Check,
  Copy,
  History,
  KeyRound,
  Unlock,
  LogOut,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Share2,
  ShieldCheck,
  ShieldOff,
  UserMinus,
  UserPlus,
  UserRoundCheck,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NoticeDialog } from '@/components/NoticesPanel';
import { ContactLinks } from '@/components/ContactLinks';
import { smsHref } from '@/lib/sms';
import {
  MembershipFields,
  membershipBody,
  NEW_MEMBERSHIP,
  type Membership,
} from '@/components/MembershipFields';
import { DetailsForm } from '@/components/DetailsForm';
import { Input, Label, Select } from '@/components/ui/input';
import { api, type LeagueRole, type Person } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

const PEOPLE = ['users'] as const;

export function UsersPage() {
  const { data: me } = useMe();
  const people = useQuery({ queryKey: PEOPLE, queryFn: () => api<Person[]>('/users') });
  const adminLeagues = (me?.leagues ?? []).filter((l) => l.role === 'admin');
  const [leagueFilter, setLeagueFilter] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<{ person: Person; link: string; expiresAt: string } | null>(
    null,
  );
  const [editing, setEditing] = useState<Person | null>(null);
  const [noticeFor, setNoticeFor] = useState<{ leagueId: string; person: Person } | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (people.data ?? []).filter(
      (p) =>
        (!leagueFilter || p.leagues.some((l) => l.leagueId === leagueFilter)) &&
        (!q ||
          p.email.includes(q) ||
          p.name?.toLowerCase().includes(q) ||
          p.leagues.some((l) => l.player?.nickname.toLowerCase().includes(q))),
    );
  }, [people.data, leagueFilter, search]);

  if (!me) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="text-sm text-muted-foreground">
            {me.user.isSiteAdmin
              ? 'Everyone with an account, in a league or not.'
              : 'People in the leagues you run. Add someone to your league from its Members list.'}
          </p>
        </div>
        {me.user.isSiteAdmin && (
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Add
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search people"
          placeholder="Search by name, nickname or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {adminLeagues.length > 1 && (
          <Select
            aria-label="Filter by league"
            className="sm:w-64"
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
          >
            <option value="">All leagues</option>
            {adminLeagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {people.isError && <Alert variant="destructive">{people.error.message}</Alert>}
      <div className="flex flex-col gap-3">
        {shown.map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            viewerIsSiteAdmin={me.user.isSiteAdmin}
            onLink={(l) => setLink({ person: p, ...l })}
            onEdit={() => setEditing(p)}
            // A notice to them in each league of theirs that you run.
            noticeLeagues={p.leagues.filter((l) => adminLeagues.some((a) => a.id === l.leagueId))}
            onNotice={(leagueId) => setNoticeFor({ leagueId, person: p })}
          />
        ))}
        {people.data && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">No one matches.</p>
        )}
      </div>

      <AddPersonDialog open={adding} onOpenChange={setAdding} leagues={adminLeagues} />
      {link && <SignInLinkDialog {...link} onClose={() => setLink(null)} />}
      {editing && <EditNameDialog person={editing} onClose={() => setEditing(null)} />}
      {noticeFor && (
        <NoticeDialog
          leagueId={noticeFor.leagueId}
          preset={{
            audience: 'person',
            recipientUserId: noticeFor.person.id,
            label:
              noticeFor.person.leagues.find((l) => l.leagueId === noticeFor.leagueId)?.player
                ?.nickname ?? displayName(noticeFor.person),
          }}
          onClose={() => setNoticeFor(null)}
        />
      )}
    </div>
  );
}

function displayName(p: Person) {
  return p.name ?? p.leagues.find((l) => l.player)?.player?.nickname ?? p.email;
}

function PersonCard({
  person: p,
  viewerIsSiteAdmin,
  onLink,
  onEdit,
  noticeLeagues,
  onNotice,
}: {
  person: Person;
  viewerIsSiteAdmin: boolean;
  onLink: (l: { link: string; expiresAt: string }) => void;
  onEdit: () => void;
  noticeLeagues: { leagueId: string; leagueName: string }[];
  onNotice: (leagueId: string) => void;
}) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: PEOPLE });
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      return refresh();
    },
    onError: (e) => setError(e.message),
  });
  const link = useMutation({
    mutationFn: () =>
      api<{ link: string; expiresAt: string }>(`/users/${p.id}/password-link`, {
        method: 'POST',
      }),
    onSuccess: onLink,
    onError: (e) => setError(e.message),
  });
  // Site admins: email the link, or text it from their own phone.
  const [notice, setNotice] = useState<string | null>(null);
  const [textHref, setTextHref] = useState<string | null>(null);
  const emailLink = useMutation({
    mutationFn: () =>
      api<{ sent: boolean; to: string }>(`/users/${p.id}/password-link/email`, {
        method: 'POST',
      }),
    onSuccess: (r) => {
      setError(null);
      setNotice(r.sent ? `Sign-in link emailed to ${r.to}.` : null);
      if (!r.sent) setError(`Held back by the mail guard (${r.to}). See Site settings → Email.`);
    },
    onError: (e) => setError(e.message),
  });
  const textLink = useMutation({
    mutationFn: () =>
      api<{ link: string; phone: string; hours: number; greeting: string | null }>(
        `/users/${p.id}/password-link/text`,
        { method: 'POST' },
      ),
    onSuccess: (d) => {
      setError(null);
      setNotice(null);
      setTextHref(
        smsHref(
          [d.phone],
          `${d.greeting ? `Hi ${d.greeting}, here` : 'Here'}'s your LeagueMates sign-in link. Set your password and you're in: ${d.link} (works once, for ${d.hours} hours)`,
        ),
      );
    },
    onError: (e) => setError(e.message),
  });

  const managed =
    viewerIsSiteAdmin || (!p.isSiteAdmin && p.leagues.every((l) => l.role === 'user'));
  const setRole = (leagueId: string, role: LeagueRole) =>
    run.mutate(() =>
      api(`/leagues/${leagueId}/members/${p.id}`, { method: 'PUT', body: { role } }),
    );
  const confirmThen = (message: string, fn: () => Promise<unknown>) => {
    if (window.confirm(message)) run.mutate(fn);
  };

  return (
    <Card className={cn('p-4', p.disabled && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{displayName(p)}</span>
            {p.isSelf && <Badge>You</Badge>}
            {p.isSiteAdmin && <Badge className="bg-primary/15 text-primary">Site admin</Badge>}
            {p.disabled && <Badge className="bg-destructive/15 text-destructive">Disabled</Badge>}
            {p.lockedUntil && (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                Locked until {formatDateTime(p.lockedUntil)}
              </Badge>
            )}
            {p.totpEnabled && <Badge>Authenticator on</Badge>}
          </div>
          <div className="mt-0.5">
            <ContactLinks email={p.email} phone={p.phone} address={p.address} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {p.lastSignInAt ? `Signed in ${timeAgo(p.lastSignInAt)}` : 'Never signed in'}
            {!p.hasPassword && ' · No password yet'}
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {p.leagues.map((l) => (
              <li key={l.leagueId} className="rounded-full border px-2.5 py-0.5 text-xs">
                {l.leagueName} ·{' '}
                <span className={cn(l.role === 'admin' && 'font-semibold text-primary')}>
                  {l.role === 'admin' ? 'Admin' : 'User'}
                </span>
                {l.player && (
                  <>
                    {' · '}
                    <Link
                      to={`/leagues/${l.leagueId}/players/${l.player.id}`}
                      className="font-medium text-primary underline decoration-dotted underline-offset-2"
                      aria-label={`${l.player.nickname}'s stats in ${l.leagueName}`}
                    >
                      {l.player.nickname}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        {(managed || p.isSelf || noticeLeagues.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${displayName(p)}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {managed && !p.disabled && !p.isSelf && (
                <DropdownMenuItem onSelect={() => link.mutate()}>
                  <KeyRound /> {p.hasPassword ? 'Get password reset link' : 'Get password link'}
                </DropdownMenuItem>
              )}
              {!p.isSelf &&
                !p.disabled &&
                noticeLeagues.map((l) => (
                  <DropdownMenuItem key={l.leagueId} onSelect={() => onNotice(l.leagueId)}>
                    <MessageSquarePlus /> Send a notice
                    {noticeLeagues.length > 1 && (
                      <span className="ml-auto text-xs text-muted-foreground">{l.leagueName}</span>
                    )}
                  </DropdownMenuItem>
                ))}
              {viewerIsSiteAdmin && !p.disabled && (
                <DropdownMenuItem
                  onSelect={() =>
                    window.confirm(
                      `Email ${displayName(p)} a link to set their password and sign in?`,
                    ) && emailLink.mutate()
                  }
                >
                  <Mail /> Email sign-in link
                </DropdownMenuItem>
              )}
              {viewerIsSiteAdmin && !p.disabled && p.phone && (
                <DropdownMenuItem onSelect={() => textLink.mutate()}>
                  <MessageSquare /> Text sign-in link
                </DropdownMenuItem>
              )}
              {managed && p.lockedUntil && (
                <DropdownMenuItem
                  onSelect={() =>
                    run.mutate(() => api(`/users/${p.id}/unlock`, { method: 'POST' }))
                  }
                >
                  <Unlock /> Unlock account
                </DropdownMenuItem>
              )}
              {viewerIsSiteAdmin && p.totpEnabled && !p.isSelf && (
                <DropdownMenuItem
                  onSelect={() =>
                    confirmThen(
                      `Turn off ${displayName(p)}'s authenticator codes (for a lost phone)? They'll be signed out and can set it up again.`,
                      () => api(`/users/${p.id}/reset-authenticator`, { method: 'POST' }),
                    )
                  }
                >
                  <ShieldOff /> Reset authenticator
                </DropdownMenuItem>
              )}
              {managed && (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edit details
                </DropdownMenuItem>
              )}
              {managed && (
                <DropdownMenuItem asChild>
                  <Link
                    to={`/people/${p.id}/activity?label=${encodeURIComponent(`${displayName(p)}: activity`)}`}
                  >
                    <History /> Activity
                  </Link>
                </DropdownMenuItem>
              )}
              {managed && !p.isSelf && (
                <DropdownMenuItem
                  onSelect={() =>
                    confirmThen(`Sign ${displayName(p)} out on every device?`, () =>
                      api(`/users/${p.id}/sign-out-everywhere`, { method: 'POST' }),
                    )
                  }
                >
                  <LogOut /> Sign out everywhere
                </DropdownMenuItem>
              )}

              {!p.isSelf &&
                p.leagues.map((l) => (
                  <div key={l.leagueId}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{l.leagueName}</DropdownMenuLabel>
                    {l.role === 'user' ? (
                      <DropdownMenuItem onSelect={() => setRole(l.leagueId, 'admin')}>
                        <ShieldCheck /> Make admin
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setRole(l.leagueId, 'user')}>
                        <UserRoundCheck /> Make user
                      </DropdownMenuItem>
                    )}
                    {managed && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() =>
                          confirmThen(`Remove ${displayName(p)} from ${l.leagueName}?`, () =>
                            api(`/leagues/${l.leagueId}/members/${p.id}`, { method: 'DELETE' }),
                          )
                        }
                      >
                        <UserMinus /> Remove from league
                      </DropdownMenuItem>
                    )}
                  </div>
                ))}

              {viewerIsSiteAdmin && !p.isSelf && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Site</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() =>
                      confirmThen(
                        p.isSiteAdmin
                          ? `Remove site admin access from ${displayName(p)}?`
                          : `Make ${displayName(p)} a site admin? They will be able to manage every league and person.`,
                        () =>
                          api(`/users/${p.id}`, {
                            method: 'PATCH',
                            body: { isSiteAdmin: !p.isSiteAdmin },
                          }),
                      )
                    }
                  >
                    {p.isSiteAdmin ? <ShieldOff /> : <ShieldCheck />}
                    {p.isSiteAdmin ? 'Remove site admin' : 'Make site admin'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={cn(!p.disabled && 'text-destructive')}
                    onSelect={() =>
                      p.disabled
                        ? run.mutate(() =>
                            api(`/users/${p.id}`, { method: 'PATCH', body: { disabled: false } }),
                          )
                        : confirmThen(
                            `Disable ${displayName(p)}? They will be signed out and can't sign in.`,
                            () =>
                              api(`/users/${p.id}`, { method: 'PATCH', body: { disabled: true } }),
                          )
                    }
                  >
                    {p.disabled ? <Check /> : <Ban />}
                    {p.disabled ? 'Enable account' : 'Disable account'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {notice && <Alert className="mt-3">{notice}</Alert>}
      {textHref && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a href={textHref} onClick={() => setTimeout(() => setTextHref(null), 500)}>
              <MessageSquare /> Send the text to {displayName(p)}
            </a>
          </Button>
          <span className="text-xs text-muted-foreground">
            Opens Messages on your phone with the link filled in.
          </span>
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}

function SignInLinkDialog({
  person,
  link,
  expiresAt,
  onClose,
}: {
  person: Person;
  link: string;
  expiresAt: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };
  const canShare = typeof navigator.share === 'function';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Password link for ${displayName(person)}`}
        description={`They open it and choose a password, then sign in with ${person.email} and that password. Works once, until ${formatDateTime(expiresAt)}. Anyone with the link can set the password, so only send it to them.`}
      >
        <div className="flex flex-col gap-3">
          <Input
            readOnly
            value={link}
            aria-label="Password link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex gap-2">
            <Button onClick={copy}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            {canShare && (
              <Button
                variant="outline"
                onClick={() =>
                  navigator
                    .share({
                      title: 'LeagueMates',
                      text: 'Set your LeagueMates password with this link',
                      url: link,
                    })
                    .catch(() => {})
                }
              >
                <Share2 /> Share
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Nothing is emailed: send it by text or however you usually reach them.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditNameDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (d: {
      name: string | null;
      nickname: string | null;
      phone: string;
      address: string;
    }) => api(`/users/${person.id}`, { method: 'PATCH', body: d }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PEOPLE });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Edit details" description={person.email}>
        <DetailsForm
          initial={{
            name: person.name,
            nickname: person.nickname,
            phone: person.phone,
            address: person.address,
          }}
          onSave={(d) => save.mutate(d)}
          saving={save.isPending}
          error={save.error?.message ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddPersonDialog({
  open,
  onOpenChange,
  leagues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leagues: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [membership, setMembership] = useState<Membership>(NEW_MEMBERSHIP);

  const add = useMutation({
    mutationFn: () =>
      api('/users', {
        method: 'POST',
        body: {
          email,
          ...(name.trim() ? { name } : {}),
          ...(leagueId ? { leagueId, ...membershipBody(membership) } : {}),
        },
      }),
    onSuccess: async () => {
      setEmail('');
      setName('');
      setMembership(NEW_MEMBERSHIP);
      await qc.invalidateQueries({ queryKey: PEOPLE });
      if (leagueId) await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
      onOpenChange(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a person"
        description="Creates their account. They don't need to be in a league yet. No email is sent: use “Get password link” and send it to them."
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-name">Name</Label>
            <Input
              id="add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-league">League</Label>
            <Select id="add-league" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
              <option value="">Not in a league yet</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          {leagueId && (
            <MembershipFields
              leagueId={leagueId}
              value={membership}
              onChange={setMembership}
              suggestedNickname={defaultNickname(name)}
            />
          )}
          {add.isError && <Alert variant="destructive">{add.error.message}</Alert>}
          <Button type="submit" size="lg" disabled={add.isPending}>
            Add person
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
