import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Mail, MessageSquare, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api, type RosterPlayer, type SeasonSchedule } from '@/lib/api';
import { smsHref } from '@/lib/sms';
import { cn } from '@/lib/utils';

type Player = RosterPlayer & { handicap: number | null };

/**
 * The season's roster. While the season is a draft, admins pick players from the league,
 * order the spots and set handicaps; the schedule is generated from it. Afterwards it's fixed.
 */
export function RosterCard({
  leagueId,
  season,
  roster,
  isAdmin,
  onSaved,
}: {
  leagueId: string;
  season: SeasonSchedule['season'];
  roster: SeasonSchedule['roster'];
  isAdmin: boolean;
  onSaved: (s: SeasonSchedule) => void;
}) {
  const qc = useQueryClient();
  const isSiteAdmin = Boolean(useMe().data?.user.isSiteAdmin);
  const editable = isAdmin && season.status === 'draft';
  const directory = useQuery({
    queryKey: ['league', leagueId, 'members'],
    queryFn: () =>
      api<{ players: Player[]; members: { userId: string; phone: string | null }[] }>(
        `/leagues/${leagueId}/members`,
      ),
    enabled: editable || isAdmin,
  });
  const [ids, setIds] = useState(roster.map((r) => r.playerId));
  useEffect(() => setIds(roster.map((r) => r.playerId)), [roster]);
  const [adding, setAdding] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api<SeasonSchedule>(`/leagues/${leagueId}/seasons/${season.id}/roster`, {
        method: 'PUT',
        body: { playerIds: ids },
      }),
    onSuccess: onSaved,
  });
  const setHcp = useMutation({
    mutationFn: ({ id, handicap }: { id: string; handicap: number | null }) =>
      api(`/leagues/${leagueId}/players/${id}`, { method: 'PATCH', body: { handicap } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
      await qc.invalidateQueries({ queryKey: ['season', season.id] });
    },
  });

  const all = new Map<string, { nickname: string; handicap: number | null }>(
    roster.map((r) => [r.playerId, { nickname: r.nickname, handicap: r.handicap }]),
  );
  for (const p of directory.data?.players ?? [])
    all.set(p.id, { nickname: p.nickname, handicap: p.handicap });
  const userOf = new Map<string, string | null>(roster.map((r) => [r.playerId, r.userId]));
  for (const p of directory.data?.players ?? []) userOf.set(p.id, p.userId);
  const phoneOf = new Map((directory.data?.members ?? []).map((m) => [m.userId, m.phone] as const));
  const rosterPhones = roster
    .map((r) => (r.userId ? phoneOf.get(r.userId) : null))
    .filter((x): x is string => Boolean(x));
  const changed = ids.join() !== roster.map((r) => r.playerId).join();
  const available = (directory.data?.players ?? []).filter((p) => !ids.includes(p.id));
  const move = (i: number, by: number) => {
    const next = [...ids];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setIds(next);
  };
  const missingHcp = ids.filter((id) => all.get(id)?.handicap === null).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster</CardTitle>
        <CardDescription>
          {editable
            ? 'Set up the roster first: who is playing this season, their spots and handicaps. Then generate the schedule.'
            : `${roster.length} players this season.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isAdmin && !editable && <TextEveryone phones={rosterPhones} count={roster.length} />}
        {editable ? (
          <ol className="divide-y">
            {ids.map((id, i) => {
              const p = all.get(id);
              return (
                <li key={id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <Link
                    to={`/leagues/${leagueId}/players/${id}`}
                    className="min-w-0 flex-1 truncate font-medium hover:underline"
                  >
                    {p?.nickname ?? '?'}
                  </Link>
                  {isSiteAdmin && userOf.get(id) && (
                    <>
                      <EmailLinkButton userId={userOf.get(id)!} nickname={p?.nickname ?? ''} />
                      <TextLinkButton userId={userOf.get(id)!} nickname={p?.nickname ?? ''} />
                    </>
                  )}
                  {editable ? (
                    <>
                      <Input
                        aria-label={`Handicap for ${p?.nickname}`}
                        inputMode="numeric"
                        placeholder="HCP"
                        className={cn(
                          'h-8 w-14 text-center',
                          p?.handicap === null && 'border-amber-500',
                        )}
                        defaultValue={p?.handicap ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                          const handicap = v === '' ? null : Number(v);
                          if (handicap !== p?.handicap) setHcp.mutate({ id, handicap });
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Move ${p?.nickname} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Move ${p?.nickname} down`}
                        disabled={i === ids.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Remove ${p?.nickname}`}
                        onClick={() => setIds(ids.filter((x) => x !== id))}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p?.handicap === null ? 'No HCP' : `HCP ${p?.handicap}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Show spots and handicaps
            </summary>
            <ol className="divide-y">
              {ids.map((id, i) => {
                const p = all.get(id);
                return (
                  <li key={id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums">
                      {i + 1}
                    </span>
                    <Link
                      to={`/leagues/${leagueId}/players/${id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {p?.nickname ?? '?'}
                    </Link>
                    {isSiteAdmin && userOf.get(id) && (
                      <>
                        <EmailLinkButton userId={userOf.get(id)!} nickname={p?.nickname ?? ''} />
                        <TextLinkButton userId={userOf.get(id)!} nickname={p?.nickname ?? ''} />
                      </>
                    )}
                    {editable ? (
                      <>
                        <Input
                          aria-label={`Handicap for ${p?.nickname}`}
                          inputMode="numeric"
                          placeholder="HCP"
                          className={cn(
                            'h-8 w-14 text-center',
                            p?.handicap === null && 'border-amber-500',
                          )}
                          defaultValue={p?.handicap ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                            const handicap = v === '' ? null : Number(v);
                            if (handicap !== p?.handicap) setHcp.mutate({ id, handicap });
                          }}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Move ${p?.nickname} up`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Move ${p?.nickname} down`}
                          disabled={i === ids.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Remove ${p?.nickname}`}
                          onClick={() => setIds(ids.filter((x) => x !== id))}
                        >
                          <X />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {p?.handicap === null ? 'No HCP' : `HCP ${p?.handicap}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        )}
        {editable && (
          <>
            <div className="flex gap-2">
              <Select
                aria-label="Add a player"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
              >
                <option value="">Add a player…</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                    {p.active ? '' : ' (past player)'}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                disabled={!adding}
                onClick={() => {
                  setIds([...ids, adding]);
                  setAdding('');
                }}
              >
                <Plus /> Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              New to the league? Add them under Players on the league page first.
              {ids.length % 4 !== 0 && ' Foursomes work best with a multiple of 4 players.'}
              {missingHcp > 0 &&
                ` ${missingHcp} player${missingHcp === 1 ? ' needs' : 's need'} a handicap.`}
            </p>
            {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
            {changed && (
              <div className="flex items-center gap-3">
                <Button disabled={save.isPending} onClick={() => save.mutate()}>
                  <Check /> Save roster
                </Button>
                <span className="text-xs text-muted-foreground">
                  Saving clears a generated schedule; generate it again after.
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Site admins: emails the player a single-use link to set their password and sign in. The
 * server's mail guard still decides whether it actually goes out.
 */
function EmailLinkButton({ userId, nickname }: { userId: string; nickname: string }) {
  const send = useMutation({
    mutationFn: () =>
      api<{ sent: boolean; to: string }>(`/users/${userId}/password-link/email`, {
        method: 'POST',
      }),
  });
  const status = send.isError
    ? send.error.message
    : send.data
      ? send.data.sent
        ? `Sent to ${send.data.to}`
        : `Held back by the mail guard (${send.data.to})`
      : null;
  return (
    <>
      {status && (
        <span
          role="status"
          className={cn(
            'max-w-[45%] truncate text-xs',
            send.data?.sent ? 'text-primary' : 'text-destructive',
          )}
        >
          {status}
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={`Email ${nickname} a sign-in link`}
        title={status ?? `Email ${nickname} a link to set their password and sign in`}
        disabled={send.isPending}
        onClick={() => {
          if (window.confirm(`Email ${nickname} a link to set their password and sign in?`))
            send.mutate();
        }}
      >
        {send.data?.sent ? <Check /> : <Mail />}
      </Button>
    </>
  );
}

/** League admins: a group text to everyone on the roster with a phone number. */
function TextEveryone({ phones, count }: { phones: string[]; count: number }) {
  if (!phones.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button asChild size="sm" variant="outline">
        <a href={smsHref(phones, 'TeeMate: ')}>
          <MessageSquare /> Text everyone
        </a>
      </Button>
      <span className="text-xs text-muted-foreground">
        {phones.length === count
          ? 'Opens a group text on your phone.'
          : `${phones.length} of ${count} have a phone number.`}
      </span>
    </div>
  );
}

/**
 * Site admins: makes a sign-in link for the player, then "Send text" opens a text to their
 * phone with it filled in, to send from your own phone.
 */
function TextLinkButton({ userId, nickname }: { userId: string; nickname: string }) {
  const make = useMutation({
    mutationFn: () =>
      api<{ link: string; phone: string; hours: number; greeting: string | null }>(
        `/users/${userId}/password-link/text`,
        { method: 'POST' },
      ),
  });
  if (make.data) {
    const d = make.data;
    const body = `${d.greeting ? `Hi ${d.greeting}, here` : 'Here'}'s your TeeMate sign-in link. Set your password and you're in: ${d.link} (works once, for ${d.hours} hours)`;
    return (
      <Button asChild size="sm" variant="secondary" className="h-8">
        <a href={smsHref([d.phone], body)} aria-label={`Send ${nickname} the text`}>
          <MessageSquare /> Send text
        </a>
      </Button>
    );
  }
  return (
    <>
      {make.isError && (
        <span role="status" className="max-w-[45%] truncate text-xs text-destructive">
          {make.error.message}
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={`Text ${nickname} a sign-in link`}
        title={`Text ${nickname} a link to set their password and sign in`}
        disabled={make.isPending}
        onClick={() => make.mutate()}
      >
        <MessageSquare />
      </Button>
    </>
  );
}
