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
import { Input, Select } from '@/components/ui/input';
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
import { winnerRow } from '@/lib/winner';

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
  const [rearranging, setRearranging] = useState<string | null>(null);
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
                      {season.status === 'scheduled' &&
                        w.status === 'scheduled' &&
                        (isAdmin ||
                          w.groups.some((g) =>
                            g.matches.some(
                              (m) => m.playerA === myPlayerId || m.playerB === myPlayerId,
                            ),
                          )) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto"
                            onClick={() => setRearranging(w.id)}
                          >
                            <Shuffle /> Rearrange
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
                              outs={new Map((w.absences ?? []).map((a) => [a.playerId, a.subName]))}
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
      {rearranging && schedule.data && (
        <RearrangeDialog
          leagueId={leagueId}
          seasonId={seasonId}
          week={schedule.data.weeks.find((x) => x.id === rearranging)!}
          names={names}
          started={(groupId) => Boolean(resultFor(groupId))}
          isAdmin={isAdmin}
          onChanged={(data) => qc.setQueryData(key, data)}
          onClose={() => setRearranging(null)}
        />
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
  outs,
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
  /** Players who said they can't make it, with their sub's name. */
  outs?: Map<string, string | null> | undefined;
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
                  className={cn(
                    'grid grid-cols-[1fr_2.75rem_2.75rem] items-center text-sm',
                    won && winnerRow,
                  )}
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
                      <span
                        className="ml-1 text-xs text-muted-foreground"
                        title={
                          r.why === 'absence'
                            ? "Recorded as a tie on the league's sheet: one player was absent (the sheet kept a stand-in score)."
                            : r.why === 'recorded'
                              ? "Recorded as a tie on the league's sheet."
                              : undefined
                        }
                      >
                        Tie
                        {r.why === 'absence'
                          ? ' · absent'
                          : r.why === 'recorded'
                            ? ' · as recorded'
                            : ''}
                      </span>
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
                  ) : outs?.has(id) ? (
                    <span className="col-span-2 text-right text-xs text-muted-foreground">
                      out{outs.get(id) ? ` · sub ${outs.get(id)}` : ''}
                    </span>
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

/**
 * Game day: change the tee order (a foursome up or down; the tee times stay put) or swap two
 * matches between foursomes. A foursome whose card is started can't be regrouped.
 */
function RearrangeDialog({
  leagueId,
  seasonId,
  week,
  names,
  started,
  isAdmin,
  onChanged,
  onClose,
}: {
  leagueId: string;
  seasonId: string;
  isAdmin: boolean;
  week: SeasonSchedule['weeks'][number];
  names: Map<string, string>;
  started: (groupId: string) => boolean;
  onChanged: (s: SeasonSchedule) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<{ matchId: string; groupId: string } | null>(null);
  const base = `/leagues/${leagueId}/seasons/${seasonId}/weeks/${week.id}`;
  const change = useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: 'POST' | 'PUT' | 'DELETE';
      body?: object;
    }) => api<SeasonSchedule>(`${base}/${path}`, { method, ...(body ? { body } : {}) }),
    onSuccess: (data) => {
      setPicked(null);
      onChanged(data);
    },
  });
  const pick = (matchId: string, groupId: string) => {
    if (!picked || picked.groupId === groupId) {
      setPicked(picked?.matchId === matchId ? null : { matchId, groupId });
      return;
    }
    change.mutate({ path: 'regroup', body: { matchA: picked.matchId, matchB: matchId } });
  };
  const groups = [...week.groups].sort((a, b) => a.slot - b.slot);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Rearrange round ${week.round}`}
        description="Move a foursome up or down the tee order (tee times stay put), or tap a match, then a match in another foursome, to swap them. Opponents never change."
      >
        <ol className="flex flex-col gap-2">
          {groups.map((g, i) => {
            const locked = started(g.id);
            return (
              <li key={g.id} className="rounded-lg border p-2">
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <span className="font-semibold text-foreground">{ordinal(i + 1)} off</span>
                  {g.teeTime && ` · ${aboutTeeTime(g.teeTime)}`}
                  {locked && ' · card started'}
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Move ${ordinal(i + 1)} off earlier`}
                      disabled={i === 0 || change.isPending}
                      onClick={() =>
                        change.mutate({
                          path: 'tee-order',
                          body: { groupId: g.id, direction: 'up' },
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Move ${ordinal(i + 1)} off later`}
                      disabled={i === groups.length - 1 || change.isPending}
                      onClick={() =>
                        change.mutate({
                          path: 'tee-order',
                          body: { groupId: g.id, direction: 'down' },
                        })
                      }
                    >
                      <ArrowDown />
                    </Button>
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {g.matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={locked || change.isPending}
                      aria-pressed={picked?.matchId === m.id}
                      onClick={() => pick(m.id, g.id)}
                      className={cn(
                        'rounded-md border px-2 py-1 text-left text-sm disabled:opacity-50',
                        picked?.matchId === m.id && 'border-primary bg-primary/10',
                      )}
                    >
                      {names.get(m.playerA)} v {names.get(m.playerB)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
        {picked && (
          <p className="mt-2 text-xs text-muted-foreground">
            Now tap a match in another foursome to swap with.
          </p>
        )}
        {isAdmin && (
          <Absences
            week={week}
            names={names}
            started={started}
            onChange={(playerId, sub) =>
              change.mutate(
                sub === null
                  ? { path: `absences/${playerId}`, method: 'DELETE' }
                  : { path: `absences/${playerId}`, method: 'PUT', body: { subName: sub || null } },
              )
            }
          />
        )}
        {change.isError && (
          <Alert variant="destructive" className="mt-2">
            {change.error.message}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Admins: who's out this round (said ahead of time), and marking someone out or back in. */
function Absences({
  week,
  names,
  started,
  onChange,
}: {
  week: SeasonSchedule['weeks'][number];
  names: Map<string, string>;
  started: (groupId: string) => boolean;
  onChange: (playerId: string, sub: string | null) => void;
}) {
  const [who, setWho] = useState('');
  const [sub, setSub] = useState('');
  const outs = week.absences ?? [];
  const open = week.groups
    .filter((g) => !started(g.id))
    .flatMap((g) => g.matches.flatMap((m) => [m.playerA, m.playerB]))
    .filter((id) => !outs.some((a) => a.playerId === id))
    .sort((a, b) => (names.get(a) ?? '').localeCompare(names.get(b) ?? ''));
  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">Who's out</h3>
      {outs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody has said they can't make it.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {outs.map((a) => (
            <li key={a.playerId} className="flex items-center justify-between gap-2">
              <span>
                {names.get(a.playerId)}
                {a.subName && <span className="text-muted-foreground"> · sub {a.subName}</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onChange(a.playerId, null)}>
                Back in
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Player who's out"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">Mark someone out…</option>
            {open.map((id) => (
              <option key={id} value={id}>
                {names.get(id)}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Sub (optional)"
            placeholder="Sub (optional)"
            className="w-40"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!who}
            onClick={() => {
              onChange(who, sub.trim());
              setWho('');
              setSub('');
            }}
          >
            Mark out
          </Button>
        </div>
      )}
    </div>
  );
}
