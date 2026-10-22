import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultNickname } from '@teemate/shared';
import {
  BarChart3,
  Calculator,
  Camera,
  Check,
  ChevronDown,
  History,
  Map as MapIcon,
  Pencil,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useIsGuest, useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, ApiError, type LeagueAccess, type LeagueRole } from '@/lib/api';
import { ContactLinks } from '@/components/ContactLinks';
import {
  MembershipFields,
  membershipBody,
  NEW_MEMBERSHIP,
  type Membership,
} from '@/components/MembershipFields';
import { SeasonsCard } from '@/components/SeasonsCard';
import { NotFoundPage } from './NotFoundPage';

interface League {
  id: string;
  name: string;
  slug: string;
  role: LeagueAccess;
}
interface Members {
  members: {
    userId: string;
    email: string;
    name: string | null;
    phone: string | null;
    address: string | null;
    role: LeagueRole;
  }[];
  players: Player[];
}
interface Player {
  id: string;
  nickname: string;
  fullName: string | null;
  handicap: number | null;
  userId: string | null;
  active: boolean;
}

export function LeaguePage() {
  const { leagueId = '' } = useParams();
  const guest = useIsGuest();
  const { data: me } = useMe();
  // The list starts open where there's room (a computer), folded on a phone.
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const league = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => api<League>(`/leagues/${leagueId}`),
  });
  const members = useQuery({
    queryKey: ['league', leagueId, 'members'],
    queryFn: () => api<Members>(`/leagues/${leagueId}/members`),
    enabled: league.isSuccess,
  });

  if (league.error instanceof ApiError && league.error.status === 404) return <NotFoundPage />;
  if (!league.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const isAdmin = league.data.role === 'admin';
  const rows = members.data ? people(members.data) : null;
  // Spots nobody has signed in to, for giving a member one of them.
  const unlinked = members.data?.players.filter((p) => !p.userId) ?? [];
  // Only site admins make accounts, so only they get the Invite link.
  const canInvite = Boolean(me?.user.isSiteAdmin);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{league.data.name}</h1>
        <Badge>
          {guest ? 'Guest' : league.data.role === 'viewer' ? 'Viewing' : isAdmin ? 'Admin' : 'User'}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to={`/leagues/${leagueId}/activity`}>
                  <History /> Activity
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/people">
                  <Users /> People
                </Link>
              </Button>
            </>
          )}
          {!guest && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to={`/leagues/${leagueId}/photos`}>
                  <Camera /> Photos
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to={`/leagues/${leagueId}/handicaps`}>
                  <Calculator /> Handicaps
                </Link>
              </Button>
            </>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={`/leagues/${leagueId}/stats`}>
              <BarChart3 /> Stats
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/courses">
              <MapIcon /> Courses
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/leagues/${leagueId}/settings`}>
              <Settings /> {isAdmin ? 'Settings' : 'Rules'}
            </Link>
          </Button>
        </div>
      </div>

      <SeasonsCard leagueId={leagueId} isAdmin={isAdmin} />

      <Card>
        <CardHeader>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-2 text-left"
          >
            <CardTitle>Members</CardTitle>
            {rows && (
              <span className="text-sm text-muted-foreground">
                {rows.playing.length} playing
                {rows.notPlaying.length > 0 && ` · ${rows.notPlaying.length} not playing`}
              </span>
            )}
            <ChevronDown
              className={cn(
                'ml-auto size-5 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
          <CardDescription>
            Everyone in the league. Tap a nickname for their scores and stats.
            {!guest &&
              (league.data.role === 'viewer'
                ? ' Contact details are for members only.'
                : " Members can see each other's contact details.")}
          </CardDescription>
        </CardHeader>
        {open && (
          <CardContent>
            {rows && rows.playing.length + rows.notPlaying.length + rows.past.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nobody yet.{isAdmin && ' Add players by the names used on the schedule.'}
              </p>
            )}
            <ul className="divide-y">
              {rows?.playing.map((r) => (
                <PersonRow
                  key={r.key}
                  leagueId={leagueId}
                  person={r}
                  canEdit={isAdmin}
                  canInvite={canInvite}
                  unlinked={unlinked}
                />
              ))}
              {rows?.notPlaying.map((r) => (
                <PersonRow
                  key={r.key}
                  leagueId={leagueId}
                  person={r}
                  canEdit={isAdmin}
                  canInvite={canInvite}
                  unlinked={unlinked}
                />
              ))}
            </ul>
            {rows && rows.past.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Past players ({rows.past.length})
                </summary>
                <ul className="divide-y">
                  {rows.past.map((r) => (
                    <PersonRow
                      key={r.key}
                      leagueId={leagueId}
                      person={r}
                      canEdit={isAdmin}
                      canInvite={canInvite}
                      unlinked={unlinked}
                    />
                  ))}
                </ul>
              </details>
            )}
            {isAdmin && (
              <AddToLeagueForm
                leagueId={leagueId}
                memberIds={members.data?.members.map((m) => m.userId) ?? []}
              />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

type Member = Members['members'][number];

/** One row per person: a player spot, the account behind it, or both. */
interface Person {
  key: string;
  player: Player | null;
  member: Member | null;
}

/** Joins spots to accounts: playing, accounts with no spot, and past players. */
function people(data: Members): { playing: Person[]; notPlaying: Person[]; past: Person[] } {
  const byUser = new Map(data.members.map((m) => [m.userId, m]));
  const withSpot = data.players.map((p) => ({
    key: p.id,
    player: p,
    member: p.userId ? (byUser.get(p.userId) ?? null) : null,
  }));
  const linked = new Set(data.players.map((p) => p.userId));
  const accountOnly = data.members
    .filter((m) => !linked.has(m.userId))
    .map((m) => ({ key: m.userId, player: null, member: m }));
  const label = (r: Person) =>
    (r.player?.nickname ?? r.member?.name ?? r.member?.email ?? '').toLowerCase();
  const sorted = (xs: Person[]) => xs.sort((a, b) => label(a).localeCompare(label(b)));
  return {
    playing: sorted(withSpot.filter((r) => r.player.active)),
    notPlaying: sorted(accountOnly),
    past: sorted(withSpot.filter((r) => !r.player.active)),
  };
}

/** Playing (with handicap), not playing, or past: a dot and a word, never colour alone. */
function Status({ person }: { person: Person }) {
  const p = person.player;
  const playing = p?.active ?? false;
  const text = !p
    ? 'Not playing'
    : !p.active
      ? 'Past'
      : p.handicap === null
        ? 'Playing · no HCP'
        : `Playing · HCP ${p.handicap}`;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span
        className={cn('size-2 rounded-full', playing ? 'bg-primary' : 'bg-muted-foreground/40')}
        aria-hidden
      />
      {text}
    </span>
  );
}

function PersonRow({
  leagueId,
  person,
  canEdit,
  canInvite,
  unlinked,
}: {
  leagueId: string;
  person: Person;
  canEdit: boolean;
  canInvite: boolean;
  /** Spots with no account, offered when giving a member a spot. */
  unlinked: Player[];
}) {
  if (person.player) {
    return (
      <PlayerRow
        leagueId={leagueId}
        player={person.player}
        member={person.member}
        canEdit={canEdit}
        canInvite={canInvite}
      />
    );
  }
  const m = person.member!;
  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{m.name ?? (m.email || 'Member')}</span>
            {m.role === 'admin' && <Badge>Admin</Badge>}
          </div>
          {m.email && <ContactLinks email={m.email} phone={m.phone} address={m.address} />}
        </div>
        <Status person={person} />
      </div>
      {canEdit && <GiveSpot leagueId={leagueId} member={m} unlinked={unlinked} />}
    </li>
  );
}

/** Admins give a member with no spot one: a player nobody has signed in to, or a new one. */
function GiveSpot({
  leagueId,
  member,
  unlinked,
}: {
  leagueId: string;
  member: Member;
  unlinked: Player[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [player, setPlayer] = useState('new');
  const [nickname, setNickname] = useState('');
  const give = useMutation({
    mutationFn: () =>
      api(`/leagues/${leagueId}/members/${member.userId}/player`, {
        method: 'POST',
        body:
          player === 'new'
            ? nickname.trim()
              ? { nickname: nickname.trim() }
              : {}
            : { playerId: player },
      }),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    give.mutate();
  };
  if (!open)
    return (
      <Button variant="outline" size="sm" className="mt-2" onClick={() => setOpen(true)}>
        <UserPlus /> Give a spot
      </Button>
    );
  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`spot-${member.userId}`}>Player</Label>
        <Select
          id={`spot-${member.userId}`}
          value={player}
          onChange={(e) => setPlayer(e.target.value)}
        >
          <option value="new">New player</option>
          {unlinked.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nickname}
              {p.active ? '' : ' (past player)'}
            </option>
          ))}
        </Select>
      </div>
      {player === 'new' && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`spot-nickname-${member.userId}`}>Nickname</Label>
          <Input
            id={`spot-nickname-${member.userId}`}
            className="w-36"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={defaultNickname(member.name) || 'First name'}
          />
        </div>
      )}
      <Button type="submit" size="sm" disabled={give.isPending}>
        <Check /> Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {give.isError && (
        <Alert variant="destructive" className="basis-full">
          {give.error.message}
        </Alert>
      )}
    </form>
  );
}

function PlayerRow({
  leagueId,
  player,
  member,
  canEdit,
  canInvite,
}: {
  leagueId: string;
  player: Player;
  /** The account behind the spot, if any. */
  member: Member | null;
  canEdit: boolean;
  canInvite: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(player.nickname);
  const [fullName, setFullName] = useState(player.fullName ?? '');
  const [handicap, setHandicap] = useState(player.handicap === null ? '' : String(player.handicap));
  const [active, setActive] = useState(player.active);
  const save = useMutation({
    mutationFn: () =>
      api(`/leagues/${leagueId}/players/${player.id}`, {
        method: 'PATCH',
        body: {
          nickname,
          fullName,
          handicap: handicap === '' ? null : Number(handicap),
          active,
        },
      }),
    onSuccess: async () => {
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_5rem]">
            <Input
              aria-label={`Full name for ${player.nickname}`}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
            />
            <Input
              aria-label={`Nickname for ${player.nickname}`}
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Nickname"
            />
            <Input
              aria-label={`Handicap for ${player.nickname}`}
              inputMode="numeric"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              placeholder="HCP"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Still playing (uncheck for a past player)
          </label>
          {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              <Check /> Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  const secondary = player.fullName ?? member?.name ?? null;
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <Link
            to={`/leagues/${leagueId}/players/${player.id}`}
            className="font-medium hover:text-primary hover:underline"
          >
            {player.nickname}
          </Link>
          {member?.role === 'admin' && <Badge>Admin</Badge>}
          {/* Admins see who still needs an account (the history import made spots only). */}
          {canEdit &&
            !player.userId &&
            player.active &&
            (canInvite ? (
              <Link
                to={`/people?add=1&league=${leagueId}&player=${player.id}&name=${encodeURIComponent(player.fullName ?? '')}`}
                className="text-xs text-primary underline decoration-dotted underline-offset-2"
              >
                No account · Invite
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">No account</span>
            ))}
        </div>
        {secondary && secondary !== player.nickname && (
          <div className="truncate text-xs text-muted-foreground">{secondary}</div>
        )}
        {member?.email && (
          <ContactLinks email={member.email} phone={member.phone} address={member.address} />
        )}
      </div>
      <Status person={{ key: player.id, player, member }} />
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Edit ${player.nickname}`}
          onClick={() => {
            setNickname(player.nickname);
            setFullName(player.fullName ?? '');
            setHandicap(player.handicap === null ? '' : String(player.handicap));
            setActive(player.active);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
      )}
    </li>
  );
}

/**
 * Admins add anyone from one form: someone new (a spot on the schedule, no account yet), or a
 * person who already has an account, with their role and whether they play.
 */
function AddToLeagueForm({ leagueId, memberIds }: { leagueId: string; memberIds: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  /** '' until chosen, 'new' for someone new, else the email of a person with an account. */
  const [who, setWho] = useState('');
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const [membership, setMembership] = useState<Membership>(NEW_MEMBERSHIP);
  const directory = useQuery({
    queryKey: ['people-directory'],
    queryFn: () => api<{ id: string; name: string | null; email: string }[]>('/users/directory'),
    enabled: open,
  });
  const available = (directory.data ?? []).filter((p) => !memberIds.includes(p.id));
  const chosen = available.find((p) => p.email === who);
  const reset = () => {
    setWho('');
    setFullName('');
    setNickname('');
    setMembership(NEW_MEMBERSHIP);
  };
  const add = useMutation({
    mutationFn: () =>
      who === 'new'
        ? api(`/leagues/${leagueId}/players`, {
            method: 'POST',
            body: {
              ...(fullName.trim() ? { fullName } : {}),
              ...(nickname.trim() ? { nickname } : {}),
            },
          })
        : api('/users', {
            method: 'POST',
            body: { email: who, leagueId, ...membershipBody(membership) },
          }),
    onSuccess: async () => {
      reset();
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const ready = who === 'new' ? Boolean(fullName.trim() || nickname.trim()) : Boolean(who);

  if (!open)
    return (
      <Button variant="secondary" className="mt-4 w-fit" onClick={() => setOpen(true)}>
        <UserPlus /> Add to league
      </Button>
    );
  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="add-who">Who</Label>
        <Select id="add-who" required value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose…</option>
          <option value="new">Someone new (no account yet)</option>
          {available.map((p) => (
            <option key={p.id} value={p.email}>
              {p.name ? `${p.name} (${p.email})` : p.email}
            </option>
          ))}
        </Select>
      </div>
      {who === 'new' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="player-full-name">Full name</Label>
              <Input
                id="player-full-name"
                autoComplete="off"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="David Smith"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="player-nickname">Nickname</Label>
              <Input
                id="player-nickname"
                autoComplete="off"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={defaultNickname(fullName) || 'Doc'}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            They get a spot on schedules and standings; the nickname is what shows there (blank:
            first name and last initial). A site admin can give them an account later from the
            People page.
          </p>
        </>
      )}
      {who && who !== 'new' && (
        <MembershipFields
          leagueId={leagueId}
          value={membership}
          onChange={setMembership}
          suggestedNickname={defaultNickname(chosen?.name)}
        />
      )}
      {add.isError && <Alert variant="destructive">{add.error.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending || !ready}>
          <UserPlus /> Add to league
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
