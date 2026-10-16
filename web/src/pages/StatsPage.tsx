import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { HoleTable, type NineStats } from '@/components/HoleTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api';

export interface HoleStatsView {
  seasons: { id: string; name: string }[];
  nines: NineStats[];
}

/** League → Stats: how each hole plays, from every card entered hole by hole (EH-014). */
export function StatsPage() {
  const { leagueId = '' } = useParams();
  const [seasonId, setSeasonId] = useState('');
  const stats = useQuery({
    queryKey: ['hole-stats', leagueId, seasonId],
    queryFn: () =>
      api<HoleStatsView>(
        `/leagues/${leagueId}/stats/holes${seasonId ? `?seasonId=${seasonId}` : ''}`,
      ),
  });
  const s = stats.data;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to={`/leagues/${leagueId}`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> League
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BarChart3 className="size-6 text-primary" aria-hidden /> Hole stats
        </h1>
        <p className="text-sm text-muted-foreground">
          How each hole plays, from every card entered hole by hole. Rank 1 plays hardest against
          par. Imported history has totals only, so it isn't included.
        </p>
      </div>
      {s && s.seasons.length > 1 && (
        <Select
          aria-label="Season"
          className="sm:w-56"
          value={seasonId}
          onChange={(e) => setSeasonId(e.target.value)}
        >
          <option value="">All seasons</option>
          {s.seasons.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      )}
      {!s ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : s.nines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hole-by-hole scores yet. They appear once cards are entered hole by hole and submitted.
        </p>
      ) : (
        s.nines.map((nine) => (
          <Card key={nine.layoutId}>
            <CardHeader>
              <CardTitle>
                {nine.course} · {nine.name}
              </CardTitle>
              <CardDescription>
                {nine.rounds} {nine.rounds === 1 ? 'round' : 'rounds'}
                {nine.rounds < 20 && ' (early days: a few rounds can swing these a lot)'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HoleTable nine={nine} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
