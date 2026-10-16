import { Navigate, useParams } from 'react-router';
import { useSeasons } from '@/components/SeasonsCard';

/** The Schedule tab: opens the league's current season (locked first, else the newest). */
export function SchedulePage() {
  const { leagueId = '' } = useParams();
  const seasons = useSeasons(leagueId);
  if (!seasons.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const current = seasons.data.find((s) => s.status === 'scheduled') ?? seasons.data[0];
  if (!current) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          There's no season yet. An admin creates one from the League page.
        </p>
      </div>
    );
  }
  return <Navigate to={`/leagues/${leagueId}/seasons/${current.id}`} replace />;
}
