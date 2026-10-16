import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api, ApiError, type MatchResultLetter, type PlayerHistory } from '@/lib/api';
import { formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { NotFoundPage } from './NotFoundPage';

const RESULT_STYLE: Record<MatchResultLetter, string> = {
  W: 'bg-primary/15 text-primary',
  L: 'bg-destructive/10 text-destructive',
  T: 'bg-muted text-muted-foreground',
};

const record = (r: { W: number; L: number; T: number }) => `${r.W}-${r.L}-${r.T}`;

export function PlayerPage() {
  const { leagueId = '', playerId = '' } = useParams();
  const history = useQuery({
    queryKey: ['player-history', leagueId, playerId],
    queryFn: () => api<PlayerHistory>(`/leagues/${leagueId}/players/${playerId}/history`),
  });
  const [season, setSeason] = useState<string | null>(null);

  if (history.error instanceof ApiError && history.error.status === 404) return <NotFoundPage />;
  const h = history.data;
  if (!h) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const shownSeason = season ?? h.seasons[0]?.seasonId ?? 'all';
  const matches = h.matches.filter((m) => shownSeason === 'all' || m.seasonId === shownSeason);
  const s = h.stats;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to={`/leagues/${leagueId}`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> League
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{h.player.nickname}</h1>
        <p className="text-sm text-muted-foreground">
          {[h.player.fullName, h.player.handicap !== null && `HCP ${h.player.handicap}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Record"
          value={record(s.record)}
          hint={s.winPct !== null ? `${s.winPct}% wins` : undefined}
        />
        <Stat label="Rounds" value={String(s.rounds)} />
        <Stat
          label="Average"
          value={s.scoringAverage?.toFixed(1) ?? '–'}
          hint={s.netAverage !== null ? `net ${s.netAverage.toFixed(1)}` : undefined}
        />
        <Stat
          label="Best round"
          value={s.best ? String(s.best.gross) : '–'}
          hint={s.best ? formatDay(s.best.date, true) : undefined}
        />
      </div>

      {h.seasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By season</CardTitle>
            <CardDescription>
              Regular season. Finishes are from the published standings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 text-left font-medium">Season</th>
                  <th className="pb-2 text-center font-medium">W-L-T</th>
                  <th className="pb-2 text-right font-medium">Pts</th>
                  <th className="pb-2 text-right font-medium">Finish</th>
                </tr>
              </thead>
              <tbody>
                {h.seasons.map((x) => (
                  <tr key={x.seasonId} className="border-t">
                    <td className="py-2 font-medium">{x.season}</td>
                    <td className="py-2 text-center tabular-nums">{record(x)}</td>
                    <td className="py-2 text-right tabular-nums">{x.points}</td>
                    <td className="py-2 text-right tabular-nums">
                      {x.rank === 1 && (
                        <Trophy
                          className="mr-1 inline size-3.5 text-amber-500"
                          aria-label="First"
                        />
                      )}
                      {x.rank ?? '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Matches</CardTitle>
            {h.seasons.length > 0 && (
              <Select
                aria-label="Season"
                className="h-9 w-32"
                value={shownSeason}
                onChange={(e) => setSeason(e.target.value)}
              >
                {h.seasons.map((x) => (
                  <option key={x.seasonId} value={x.seasonId}>
                    {x.season}
                  </option>
                ))}
                <option value="all">All seasons</option>
              </Select>
            )}
          </CardHeader>
          <CardContent>
            {matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scored matches yet.</p>
            ) : (
              <ul className="divide-y">
                {matches.map((m) => (
                  <li key={m.matchId}>
                    <Link
                      to={`/leagues/${leagueId}/seasons/${m.seasonId}/weeks/${m.weekId}/groups/${m.groupId}`}
                      className="flex items-center gap-3 py-2 text-sm hover:text-primary"
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          m.result ? RESULT_STYLE[m.result] : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {m.result ?? '–'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          v {m.opponent}
                          {m.playoffRound !== null && (
                            <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">
                              Playoffs
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDay(m.date, shownSeason === 'all')}
                        </div>
                      </div>
                      <div className="text-right text-xs tabular-nums text-muted-foreground">
                        {m.absent ? (
                          'Absent'
                        ) : (
                          <>
                            <div className="text-sm text-foreground">{m.gross ?? '–'}</div>
                            {m.net !== null && <div>net {m.net}</div>}
                          </>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Head-to-head</CardTitle>
            <CardDescription>
              Regular-season matches against each opponent, all seasons.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {h.headToHead.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-medium">Opponent</th>
                    <th className="pb-2 text-center font-medium">W-L-T</th>
                    <th className="pb-2 text-right font-medium">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {h.headToHead.map((o) => (
                    <tr key={o.opponentId} className="border-t">
                      <td className="py-2">
                        <Link
                          to={`/leagues/${leagueId}/players/${o.opponentId}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {o.opponent}
                        </Link>
                      </td>
                      <td
                        className={cn(
                          'py-2 text-center tabular-nums',
                          o.W > o.L && 'text-primary',
                          o.L > o.W && 'text-destructive',
                        )}
                      >
                        {record(o)}
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {formatDay(o.last, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-0 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
