import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  History,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  CloudRain,
  Lock,
  MessageSquarePlus,
  Shuffle,
  SkipForward,
  Trash2,
  Unlock,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select } from '@/components/ui/input';
import { api, ApiError, type SeasonResultGroup, type SeasonSchedule } from '@/lib/api';
import { aboutTeeTime, formatDay, todayIso } from '@/lib/time';
import { cn } from '@/lib/utils';
import { NoticeDialog, type NoticePreset } from '@/components/AnnouncementsCard';
import { PhotosCard, SeasonBanner } from '@/components/Photos';
import { PlayoffsCard } from '@/components/PlayoffsCard';
import { RosterCard } from '@/components/RosterCard';
import { RoundScanButton } from '@/components/ScanCardButton';
import { ScrambleCard } from '@/components/ScrambleCard';
import { NotFoundPage } from './NotFoundPage';

const STATUS_LABEL = { draft: 'Draft', scheduled: 'Locked', complete: 'Complete' } as const;

export function SeasonPage() {
  const { leagueId = '', seasonId = '' } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const key = ['season', seasonId];
  const schedule = useQuery({
    queryKey: key,
    queryFn: () => api<SeasonSchedule>(`/leagues/${leagueId}/seasons/${seasonId}`),
  });
  const isAdmin = me?.leagues.find((l) => l.id === leagueId)?.role === 'admin';
  const leagueName = me?.leagues.find((l) => l.id === leagueId)?.name ?? '';
  const [mineOnly, setMineOnly] = useState(false);

  const results = useQuery({
    queryKey: ['season-results', seasonId],
    queryFn: () => api<SeasonResultGroup[]>(`/leagues/${leagueId}/seasons/${seasonId}/results`),
  });
  const resultFor = (groupId: string) => results.data?.find((r) => r.groupId === groupId);

  const action = useMutation({
    mutationFn: (path: string) =>
      api<SeasonSchedule>(`/leagues/${leagueId}/seasons/${seasonId}/${path}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: async (data) => {
      qc.setQueryData(key, data);
      await qc.invalidateQueries({ queryKey: ['seasons', leagueId] });
      await qc.invalidateQueries({ queryKey: ['this-week'] });
    },
  });

  const navigate = useNavigate();
  const [swapping, setSwapping] = useState<SeasonSchedule['weeks'][number] | null>(null);
  const [noticeFor, setNoticeFor] = useState<NoticePreset | null>(null);
  const swap = useMutation({
    mutationFn: ({
      weekId,
      playerA,
      playerB,
    }: {
      weekId: string;
      playerA: string;
      playerB: string;
    }) =>
      api<SeasonSchedule>(`/leagues/${leagueId}/seasons/${seasonId}/weeks/${weekId}/swap`, {
        method: 'POST',
        body: { playerA, playerB },
      }),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      setSwapping(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/leagues/${leagueId}/seasons/${seasonId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['seasons', leagueId] });
      await qc.invalidateQueries({ queryKey: ['this-week'] });
      navigate(`/leagues/${leagueId}`, { replace: true });
    },
  });

  const data = schedule.data;
  const names = useMemo(() => new Map(data?.roster.map((r) => [r.playerId, r.nickname])), [data]);
  const handicaps = useMemo(
    () => new Map(data?.roster.map((r) => [r.playerId, r.handicap])),
    [data],
  );
  const myPlayerId = data?.roster.find((r) => r.userId && r.userId === me?.user.id)?.playerId;

  if (schedule.error instanceof ApiError && schedule.error.status === 404) return <NotFoundPage />;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { season, weeks, report } = data;
  const today = todayIso();
  const nextRound = weeks.find((w) => w.status === 'scheduled' && w.date >= today)?.round;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to league">
          <Link to={`/leagues/${leagueId}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {leagueName}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{season.name} season</h1>
          {season.course && (
            <div className="text-sm text-muted-foreground">
              <Link to={`/courses/${season.course.id}`} className="hover:underline">
                {season.course.name}
              </Link>
              {season.nines?.length ? ` · ${season.nines.map((n) => n.name).join(', ')}` : ''}
            </div>
          )}
        </div>
        <Badge className={cn(season.status === 'scheduled' && 'bg-primary/15 text-primary')}>
          {STATUS_LABEL[season.status]}
        </Badge>
      </div>

      <SeasonBanner leagueId={leagueId} seasonId={seasonId} coverPhotoId={season.coverPhotoId} />

      <RosterCard
        leagueId={leagueId}
        season={season}
        roster={data.roster}
        isAdmin={isAdmin}
        onSaved={(d) => qc.setQueryData(key, d)}
      />

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              {season.status === 'complete'
                ? 'A completed season. Standings show the final results as published.'
                : season.status === 'draft'
                  ? weeks.length
                    ? 'Review the schedule. Regenerate for a different mix, then lock it so players can see it on Home.'
                    : `Generate the schedule for ${data.roster.length} players from ${formatDay(season.startDate, true)}.`
                  : 'Locked: players see their rounds on Home. Unlock to regenerate (only before any round is played).'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {report && season.status === 'draft' && (
              <ul className="grid gap-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2
                    className={cn(
                      'size-4',
                      report.pairsMet === report.possiblePairs ? 'text-primary' : 'text-amber-500',
                    )}
                  />
                  Everyone plays everyone: {report.pairsMet} of {report.possiblePairs} pairings
                  {report.maxOpponentRepeats > 1 &&
                    ` (some meet ${report.maxOpponentRepeats} times)`}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2
                    className={cn(
                      'size-4',
                      report.maxGroupMateRepeats <= 3 ? 'text-primary' : 'text-amber-500',
                    )}
                  />
                  Foursomes mixed: no two players share a group more than{' '}
                  {report.maxGroupMateRepeats}×
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2
                    className={cn(
                      'size-4',
                      report.everyoneTeesFirstAndLast ? 'text-primary' : 'text-amber-500',
                    )}
                  />
                  Tee order rotates: everyone goes first and last at least once
                </li>
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {season.status === 'draft' && (
                <Button
                  variant={weeks.length ? 'outline' : 'default'}
                  disabled={action.isPending}
                  onClick={() => action.mutate('generate')}
                >
                  {weeks.length ? <Shuffle /> : <Wand2 />}{' '}
                  {weeks.length ? 'Regenerate' : 'Generate schedule'}
                </Button>
              )}
              {season.status === 'draft' && weeks.length > 0 && (
                <Button disabled={action.isPending} onClick={() => action.mutate('lock')}>
                  <Lock /> Lock schedule
                </Button>
              )}
              {season.status === 'scheduled' && (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => action.mutate('unlock')}
                >
                  <Unlock /> Unlock
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              className="w-fit text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                const typed = window.prompt(
                  `Delete the ${season.name} season and all its rounds and scorecards? Type ${season.name} to confirm.`,
                );
                if (typed === season.name) remove.mutate();
              }}
            >
              <Trash2 /> Delete season
            </Button>
            <Button asChild variant="ghost" className="w-fit">
              <Link
                to={`/leagues/${leagueId}/activity?seasonId=${seasonId}&label=${encodeURIComponent(`${season.name} season activity`)}`}
              >
                <History /> Season activity
              </Link>
            </Button>
            {action.isPending && <p className="text-sm text-muted-foreground">Working…</p>}
            {action.isError && <Alert variant="destructive">{action.error.message}</Alert>}
          </CardContent>
        </Card>
      )}

      <PlayoffsCard
        leagueId={leagueId}
        seasonId={seasonId}
        isAdmin={isAdmin}
        seasonStatus={season.status}
      />

      <ScrambleCard leagueId={leagueId} seasonId={seasonId} seasonStatus={season.status} />

      <PhotosCard
        leagueId={leagueId}
        seasonId={seasonId}
        coverPhotoId={season.coverPhotoId}
        title={`${season.name} photos`}
        showMatch
      />

      <PhotosCard
        leagueId={leagueId}
        seasonId={seasonId}
        kind="card"
        title={`${season.name} scorecards`}
        showMatch
      />

      {weeks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No schedule yet.</p>
      ) : (
        <>
          {myPlayerId && (
            <div
              role="radiogroup"
              aria-label="Show"
              className="inline-flex w-fit rounded-lg border bg-muted p-1"
            >
              {[
                ['All matches', false],
                ['My matches', true],
              ].map(([label, value]) => (
                <button
                  key={String(label)}
                  role="radio"
                  aria-checked={mineOnly === value}
                  onClick={() => setMineOnly(value as boolean)}
                  className={cn(
                    'rounded-md px-4 py-1.5 text-sm text-muted-foreground',
                    mineOnly === value && 'bg-card text-foreground shadow-xs',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {nextRound !== undefined && season.status === 'scheduled' && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => scrollToRound(nextRound)}
              >
                <ArrowDown /> Jump to the next round (Round {nextRound})
              </Button>
              <JumpToRound round={nextRound} />
            </>
          )}
          <ol className="flex flex-col gap-3">
            {weeks.map((w) => {
              const groups = mineOnly
                ? w.groups.filter((g) =>
                    g.matches.some((m) => m.playerA === myPlayerId || m.playerB === myPlayerId),
                  )
                : w.groups;
              const isNext = w.round === nextRound && season.status === 'scheduled';
              return (
                <li key={w.id} id={`round-${w.round}`} className="scroll-mt-24">
                  <Card className={cn('p-4', isNext && 'border-primary/60 ring-1 ring-primary/30')}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {w.isFinal
                          ? 'Finals'
                          : w.playoffRound
                            ? `Playoffs · Round ${w.playoffRound}`
                            : `Round ${w.round}`}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatDay(w.date)} · {w.layout}
                      </span>
                      {isNext && <Badge className="bg-primary/15 text-primary">Next</Badge>}
                      {w.status !== 'scheduled' && (
                        <Badge>{w.status === 'played' ? 'Played' : 'Skipped'}</Badge>
                      )}
                      {isAdmin && season.status === 'scheduled' && w.status === 'scheduled' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto"
                              disabled={action.isPending}
                            >
                              <CloudRain /> Rainout
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                window.confirm(
                                  `Move round ${w.round} and every later round back one week?`,
                                ) && action.mutate(`weeks/${w.id}/rainout`)
                              }
                            >
                              <CalendarClock /> Move back a week (make it up)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                window.confirm(
                                  `Skip round ${w.round}? Nobody gets points and the other dates stay the same.`,
                                ) && action.mutate(`weeks/${w.id}/skip`)
                              }
                            >
                              <SkipForward /> Skip this round
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {isAdmin && season.status === 'draft' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          onClick={() => setSwapping(w)}
                        >
                          <ArrowLeftRight /> Swap
                        </Button>
                      )}
                    </div>
                    {season.status === 'scheduled' &&
                      w.status !== 'skipped' &&
                      results.data &&
                      // A card someone can still enter: any for an admin, otherwise their own.
                      w.groups.some(
                        (g) =>
                          (isAdmin ||
                            g.matches.some(
                              (m) => m.playerA === myPlayerId || m.playerB === myPlayerId,
                            )) &&
                          (!resultFor(g.id) || resultFor(g.id)!.status === 'draft'),
                      ) && (
                        <div className="mb-3">
                          <RoundScanButton
                            leagueId={leagueId}
                            seasonId={seasonId}
                            weekId={w.id}
                            groupLabel={(id) => {
                              const g = w.groups.find((x) => x.id === id);
                              return g ? `${ordinal(g.slot + 1)} off` : 'a foursome';
                            }}
                          />
                        </div>
                      )}
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {groups.map((g) => {
                        const mine = g.matches.some(
                          (m) => m.playerA === myPlayerId || m.playerB === myPlayerId,
                        );
                        return (
                          <li key={g.id}>
                            <GroupCard
                              leagueId={leagueId}
                              to={`/leagues/${leagueId}/seasons/${seasonId}/weeks/${w.id}/groups/${g.id}`}
                              teeTime={g.teeTime}
                              order={g.slot + 1}
                              matches={g.matches}
                              result={resultFor(g.id)}
                              names={names}
                              handicaps={handicaps}
                              me={myPlayerId}
                              mine={mine}
                              onNotice={
                                isAdmin && season.status !== 'draft'
                                  ? () =>
                                      setNoticeFor({
                                        audience: 'group',
                                        groupId: g.id,
                                        label: `round ${w.round}, ${ordinal(g.slot + 1)} off: ${g.matches
                                          .flatMap((m) => [m.playerA, m.playerB])
                                          .map((p) => names.get(p) ?? '?')
                                          .join(', ')}`,
                                      })
                                  : undefined
                              }
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {noticeFor && (
        <NoticeDialog leagueId={leagueId} preset={noticeFor} onClose={() => setNoticeFor(null)} />
      )}
      {swapping && (
        <SwapDialog
          week={swapping}
          names={names}
          onClose={() => setSwapping(null)}
          onSwap={(playerA, playerB) => swap.mutate({ weekId: swapping.id, playerA, playerB })}
          error={swap.isError ? swap.error.message : null}
        />
      )}
    </div>
  );
}

function SwapDialog({
  week,
  names,
  onClose,
  onSwap,
  error,
}: {
  week: SeasonSchedule['weeks'][number];
  names: Map<string, string>;
  onClose: () => void;
  onSwap: (a: string, b: string) => void;
  error: string | null;
}) {
  const ids = week.groups.flatMap((g) => g.matches.flatMap((m) => [m.playerA, m.playerB]));
  const [a, setA] = useState(ids[0] ?? '');
  const [b, setB] = useState(ids[1] ?? '');
  const options = ids
    .slice()
    .sort((x, y) => (names.get(x) ?? '').localeCompare(names.get(y) ?? ''))
    .map((id) => (
      <option key={id} value={id}>
        {names.get(id)}
      </option>
    ));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Swap players in round ${week.round}`}
        description="The two players trade places (opponent and foursome) in this round only."
      >
        <div className="flex flex-col gap-3">
          <Select aria-label="First player" value={a} onChange={(e) => setA(e.target.value)}>
            {options}
          </Select>
          <Select aria-label="Second player" value={b} onChange={(e) => setB(e.target.value)}>
            {options}
          </Select>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button disabled={!a || !b || a === b} onClick={() => onSwap(a, b)}>
            <ArrowLeftRight /> Swap
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A player's name, linking to their player page. */
function PlayerName({
  id,
  names,
  me,
  leagueId,
}: {
  id: string;
  names: Map<string, string>;
  me?: string | undefined;
  leagueId: string;
}) {
  return (
    <Link
      to={`/leagues/${leagueId}/players/${id}`}
      // The group card around it opens the scorecard; a name opens the player instead.
      onClick={(e) => e.stopPropagation()}
      className={cn('hover:underline', id === me && 'font-semibold text-primary')}
    >
      {names.get(id) ?? '?'}
    </Link>
  );
}

const CARD_BADGE = {
  draft: 'Card started',
  submitted: 'Submitted',
  disputed: 'Disputed',
  final: 'Final',
} as const;

const scrollToRound = (round: number) =>
  document.getElementById(`round-${round}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** A floating button back to the next round, shown while that round is off screen. */
function JumpToRound({ round }: { round: number }) {
  // null while the round is on screen; otherwise which way it is.
  const [away, setAway] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const el = document.getElementById(`round-${round}`);
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) =>
      setAway(e!.isIntersecting ? null : e!.boundingClientRect.top < 0 ? 'up' : 'down'),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [round]);
  if (!away) return null;
  return (
    <Button
      className="fixed right-4 bottom-24 z-30 rounded-full shadow-lg md:bottom-6"
      onClick={() => scrollToRound(round)}
      aria-label={`Jump to round ${round}`}
    >
      Round {round} {away === 'up' ? <ArrowUp /> : <ArrowDown />}
    </Button>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function GroupCard({
  leagueId,
  to,
  teeTime,
  order,
  matches,
  result,
  names,
  handicaps,
  me,
  mine,
  onNotice,
}: {
  leagueId: string;
  to: string;
  teeTime: string;
  /** Tee order of this foursome in the round: 1 = first off. */
  order: number;
  matches: { id: string; playerA: string; playerB: string }[];
  result: SeasonResultGroup | undefined;
  names: Map<string, string>;
  /** Current handicaps, shown until a card records the one used that week. */
  handicaps: Map<string, number | null>;
  me?: string | undefined;
  mine: boolean;
  /** Admins: a notice to this foursome. */
  onNotice?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  // The whole card opens the scorecard (names inside link to players, so it can't be a link itself).
  return (
    <div
      onClick={() => void navigate(to)}
      className={cn(
        'block cursor-pointer rounded-lg border px-3 py-2 transition-colors hover:border-primary/50',
        mine && 'border-primary/50 bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <Link to={to} className="hover:text-foreground" onClick={(e) => e.stopPropagation()}>
          <span className="font-semibold text-foreground">{ordinal(order)} off</span>
          {teeTime && ` · ${aboutTeeTime(teeTime)}`}
        </Link>
        <span className="flex items-center gap-2">
          {result && (
            <span className={cn(result.status === 'disputed' && 'text-amber-600')}>
              {CARD_BADGE[result.status]}
            </span>
          )}
          {onNotice && (
            <button
              type="button"
              aria-label={`Notice to the ${ordinal(order)} off foursome`}
              title="Send this foursome a notice"
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onNotice();
              }}
            >
              <MessageSquarePlus className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      {result && result.status !== 'draft' && (
        <div className="mt-1 grid grid-cols-[1fr_2.75rem_2.75rem] text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          <span />
          <span className="text-right">Gross</span>
          <span className="text-right">Net</span>
        </div>
      )}
      {matches.map((m, i) => {
        const r =
          result && result.status !== 'draft'
            ? result.matches.find((x) => x.id === m.id)?.result
            : undefined;
        const gross = (id: string) => result?.rounds.find((x) => x.playerId === id);
        return (
          <div key={m.id} className={cn('py-1', i > 0 && 'border-t border-dashed')}>
            {(['A', 'B'] as const).map((side) => {
              const id = side === 'A' ? m.playerA : m.playerB;
              const won = r?.outcome === side;
              const g = gross(id);
              const absent = r ? r.net[side] === null : g?.attendance === 'absent';
              return (
                <div
                  key={side}
                  className="grid grid-cols-[1fr_2.75rem_2.75rem] items-center text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className={cn('relative pr-4', won && 'font-semibold')}>
                      <PlayerName id={id} names={names} me={me} leagueId={leagueId} />
                      {(g?.handicap ?? handicaps.get(id)) != null && (
                        <span className="ml-1 text-xs font-normal tabular-nums text-muted-foreground">
                          ({g?.handicap ?? handicaps.get(id)})
                        </span>
                      )}
                      {won && (
                        <CheckCircle2
                          className="absolute -top-1 right-0 size-3.5 text-green-600 dark:text-green-500"
                          aria-label="Winner"
                        />
                      )}
                    </span>
                    {side === 'B' && r?.outcome === 'T' && (
                      <span className="ml-1 text-xs text-muted-foreground">Tie</span>
                    )}
                  </span>
                  {r ? (
                    absent ? (
                      <span className="col-span-2 text-right text-xs text-muted-foreground">
                        absent
                      </span>
                    ) : (
                      <>
                        <span className="text-right tabular-nums text-muted-foreground">
                          {g?.gross ?? '–'}
                        </span>
                        <span className={cn('text-right tabular-nums', won && 'font-semibold')}>
                          {r.net[side]}
                        </span>
                      </>
                    )
                  ) : (
                    <span className="col-span-2" />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
