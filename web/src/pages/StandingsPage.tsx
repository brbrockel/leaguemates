import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMe } from '@/auth/session';
import { useSeasons } from '@/components/SeasonsCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api, type SeasonStatRow, type StandingsView } from '@/lib/api';

export function StandingsPage() {
  const { leagueId = '' } = useParams();
  const { data: me } = useMe();
  const seasons = useSeasons(leagueId);
  const [chosen, setChosen] = useState('');
  const visible = (seasons.data ?? []).filter((s) => s.status !== 'draft');
  const season =
    visible.find((s) => s.id === chosen) ??
    visible.find((s) => s.status === 'scheduled') ??
    visible[0];
  const standings = useQuery({
    queryKey: ['standings', season?.id],
    queryFn: () => api<StandingsView>(`/leagues/${leagueId}/seasons/${season!.id}/standings`),
    enabled: Boolean(season),
  });
  const stats = useQuery({
    queryKey: ['season-stats', season?.id],
    queryFn: () => api<SeasonStatRow[]>(`/leagues/${leagueId}/seasons/${season!.id}/stats`),
    enabled: Boolean(season),
  });

  if (!seasons.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!season) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Standings</h1>
        <p className="text-sm text-muted-foreground">
          Standings appear once a season's schedule is locked.
        </p>
      </div>
    );
  }
  const data = standings.data;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {me?.leagues.find((l) => l.id === leagueId)?.name}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{season.name} standings</h1>
          </div>
          {visible.length > 1 && (
            <Select
              aria-label="Season"
              className="h-9 w-32"
              value={season.id}
              onChange={(e) => setChosen(e.target.value)}
            >
              {visible.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {data
            ? data.official
              ? 'Final standings as published in the league spreadsheet.'
              : data.roundsCounted === 0
                ? 'No rounds scored yet.'
                : `After ${data.roundsCounted} round${data.roundsCounted === 1 ? '' : 's'}${data.provisional ? ' · includes cards still open for disputes' : ''}`
            : 'Loading…'}
        </p>
      </div>
      {data && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 p-2.5 text-right font-medium">#</th>
                <th className="p-2.5 text-left font-medium">Player</th>
                <th className="w-9 p-2.5 font-medium">W</th>
                <th className="w-9 p-2.5 font-medium">L</th>
                <th className="w-9 p-2.5 font-medium">T</th>
                <th className="w-12 p-2.5 pr-4 text-right font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                return (
                  <tr key={r.playerId} className="border-t">
                    <td className="p-2.5 text-right tabular-nums text-muted-foreground">
                      {r.rank}
                    </td>
                    <td className="p-2.5 font-medium">
                      {r.rank === 1 && data.roundsCounted > 0 && (
                        <Trophy
                          className="mr-1.5 inline size-4 text-amber-500"
                          aria-label="Leader"
                        />
                      )}
                      <Link
                        to={`/leagues/${leagueId}/players/${r.playerId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {r.nickname}
                      </Link>
                    </td>
                    <td className="p-2.5 text-center tabular-nums">{r.W}</td>
                    <td className="p-2.5 text-center tabular-nums">{r.L}</td>
                    <td className="p-2.5 text-center tabular-nums">{r.T}</td>
                    <td className="p-2.5 pr-4 text-right font-semibold tabular-nums">{r.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Win 3 · Tie 1 · Loss 0. Ties in points are ordered by wins, then head-to-head, then the
        lower total net over the rounds both played.
      </p>
      {stats.data && stats.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scoring</CardTitle>
            <CardDescription>
              9-hole scores this season, lowest average first. Net is gross less the player’s
              handicap.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 text-left font-medium">Player</th>
                  <th className="pb-2 text-center font-medium">Rds</th>
                  <th className="pb-2 text-center font-medium">Avg</th>
                  <th className="pb-2 text-center font-medium">Best</th>
                  <th className="pb-2 text-right font-medium">Net avg</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.map((r) => (
                  <tr key={r.playerId} className="border-t">
                    <td className="py-2 font-medium">
                      <Link
                        to={`/leagues/${leagueId}/players/${r.playerId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {r.nickname}
                      </Link>
                    </td>
                    <td className="py-2 text-center tabular-nums">{r.rounds}</td>
                    <td className="py-2 text-center tabular-nums">
                      {r.scoringAverage?.toFixed(1)}
                    </td>
                    <td className="py-2 text-center tabular-nums">{r.best}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {r.netAverage?.toFixed(1) ?? '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
