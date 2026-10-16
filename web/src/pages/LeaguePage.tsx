import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calculator,
  Camera,
  Check,
  History,
  Map,
  Pencil,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, ApiError, type LeagueAccess, type LeagueRole } from '@/lib/api';
import { AnnouncementsCard } from '@/components/AnnouncementsCard';
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{league.data.name}</h1>
        <Badge>{league.data.role === 'viewer' ? 'Viewing' : isAdmin ? 'Admin' : 'User'}</Badge>
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
          <Button asChild variant="outline" size="sm">
            <Link to="/courses">
              <Map /> Courses
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/leagues/${leagueId}/settings`}>
              <Settings /> {isAdmin ? 'Settings' : 'Rules'}
            </Link>
          </Button>
        </div>
      </div>

      <AnnouncementsCard leagueId={leagueId} isAdmin={isAdmin} />

      <SeasonsCard leagueId={leagueId} isAdmin={isAdmin} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Players</CardTitle>
            <CardDescription>
              Everyone who plays in the league. Each season's roster and spots are set on the season
              page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.data?.players.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No players yet.{isAdmin && ' Add them by the names used on the schedule.'}
              </p>
            )}
            <ul className="divide-y">
              {members.data?.players
                .filter((p) => p.active)
                .map((p) => (
                  <PlayerRow key={p.id} leagueId={leagueId} player={p} canEdit={isAdmin} />
                ))}
            </ul>
            {members.data?.players.some((p) => !p.active) && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Past players ({members.data.players.filter((p) => !p.active).length})
                </summary>
                <ul className="divide-y">
                  {members.data.players
                    .filter((p) => !p.active)
                    .map((p) => (
                      <PlayerRow key={p.id} leagueId={leagueId} player={p} canEdit={isAdmin} />
                    ))}
                </ul>
              </details>
            )}
            {isAdmin && <AddPlayerForm leagueId={leagueId} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              People in this league.{' '}
              {league.data.role === 'viewer'
                ? 'Contact details are for members only.'
                : "Members can see each other's contact details."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.data?.members.length === 0 && (
              <p className="text-sm text-muted-foreground">Nobody has been added yet.</p>
            )}
            <ul className="divide-y">
              {members.data?.members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-start justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.name ?? (m.email || 'Member')}</div>
                    {m.email && (
                      <ContactLinks email={m.email} phone={m.phone} address={m.address} />
                    )}
                  </div>
                  <Badge>{m.role === 'admin' ? 'Admin' : 'User'}</Badge>
                </li>
              ))}
            </ul>
            {isAdmin && (
              <AddMemberForm
                leagueId={leagueId}
                memberIds={members.data?.members.map((m) => m.userId) ?? []}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PlayerRow({
  leagueId,
  player,
  canEdit,
}: {
  leagueId: string;
  player: Player;
  canEdit: boolean;
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

  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <Link
          to={`/leagues/${leagueId}/players/${player.id}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {player.nickname}
        </Link>
        {player.fullName && (
          <div className="truncate text-xs text-muted-foreground">{player.fullName}</div>
        )}
      </div>
      <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
        {player.handicap === null ? 'No HCP' : `HCP ${player.handicap}`}
      </span>
      {!player.userId && player.active && (
        <span className="hidden text-xs text-muted-foreground sm:inline">Not signed up</span>
      )}
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

function AddPlayerForm({ leagueId }: { leagueId: string }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [nickname, setNickname] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api(`/leagues/${leagueId}/players`, {
        method: 'POST',
        body: {
          ...(fullName.trim() ? { fullName } : {}),
          ...(nickname.trim() ? { nickname } : {}),
        },
      }),
    onSuccess: async () => {
      setFullName('');
      setNickname('');
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t pt-4">
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
            placeholder={fullName.trim().split(/\s+/)[0] || 'Doc'}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The nickname is what shows on schedules and standings. Leave it blank to use the first name.
      </p>
      {add.isError && <Alert variant="destructive">{add.error.message}</Alert>}
      <Button
        type="submit"
        variant="secondary"
        className="w-fit"
        disabled={add.isPending || (!fullName.trim() && !nickname.trim())}
      >
        <UserPlus /> Add player
      </Button>
    </form>
  );
}

/** Adds someone who already has an account (site admins create accounts on People). */
function AddMemberForm({ leagueId, memberIds }: { leagueId: string; memberIds: string[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [membership, setMembership] = useState<Membership>(NEW_MEMBERSHIP);
  const directory = useQuery({
    queryKey: ['people-directory'],
    queryFn: () => api<{ id: string; name: string | null; email: string }[]>('/users/directory'),
    enabled: open,
  });
  const available = (directory.data ?? []).filter((p) => !memberIds.includes(p.id));
  const chosen = available.find((p) => p.email === email);
  const add = useMutation({
    mutationFn: () =>
      api('/users', {
        method: 'POST',
        body: { email, leagueId, ...membershipBody(membership) },
      }),
    onSuccess: async () => {
      setEmail('');
      setMembership(NEW_MEMBERSHIP);
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  if (!open)
    return (
      <Button variant="secondary" className="mt-4 w-fit" onClick={() => setOpen(true)}>
        <UserPlus /> Add member
      </Button>
    );
  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="member-person">Person</Label>
        <Select
          id="member-person"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        >
          <option value="">Choose someone…</option>
          {available.map((p) => (
            <option key={p.id} value={p.email}>
              {p.name ? `${p.name} (${p.email})` : p.email}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          Not listed? A site admin adds new people on the People page.
        </p>
      </div>
      {email && (
        <MembershipFields
          leagueId={leagueId}
          value={membership}
          onChange={setMembership}
          suggestedNickname={chosen?.name?.split(/\s+/)[0] ?? ''}
        />
      )}
      {add.isError && <Alert variant="destructive">{add.error.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending || !email}>
          <UserPlus /> Add to league
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
