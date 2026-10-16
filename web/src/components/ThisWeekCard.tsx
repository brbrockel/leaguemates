import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Flag, Users } from 'lucide-react';
import { Link } from 'react-router';
import { ScanCardButton } from '@/components/ScanCardButton';
import { Card } from '@/components/ui/card';
import { api, type ThisWeekEntry } from '@/lib/api';
import { formatDay, formatTeeTime, todayIso } from '@/lib/time';

export function ThisWeek() {
  const entries = useQuery({
    queryKey: ['this-week'],
    queryFn: () => api<ThisWeekEntry[]>('/me/this-week'),
  });
  const upcoming = (entries.data ?? []).filter((e) => e.next);
  if (upcoming.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      {upcoming.map((e) => {
        const n = e.next!;
        const when = n.date === todayIso() ? 'Today' : formatDay(n.date);
        return (
          <div key={e.leagueId} className="flex flex-col gap-2">
            <Link
              to={
                n.groupId
                  ? `/leagues/${e.leagueId}/seasons/${n.seasonId}/weeks/${n.weekId}/groups/${n.groupId}`
                  : `/leagues/${e.leagueId}/seasons/${n.seasonId}`
              }
              className="group"
            >
              <Card className="overflow-hidden border-primary/30 transition-colors group-hover:border-primary/60">
                <div className="bg-primary px-5 py-4 text-primary-foreground">
                  <div className="text-xs uppercase tracking-wide opacity-80">
                    {e.leagueName} ·{' '}
                    {n.isFinal
                      ? 'Finals'
                      : n.playoffRound
                        ? `Playoffs · Round ${n.playoffRound}`
                        : `Round ${n.round} of ${n.rounds}`}
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    {n.teeTime && <span className="text-sm opacity-90">about</span>}
                    <span className="text-3xl font-semibold tabular-nums">
                      {n.teeTime ? formatTeeTime(n.teeTime) : 'Bye'}
                    </span>
                    <span className="text-sm opacity-90">{when}</span>
                  </div>
                  {n.teeTime && (
                    <div className="text-xs opacity-80">
                      Estimated: groups go off in order, so your time can shift on the day.
                    </div>
                  )}
                </div>
                <div className="grid gap-2 px-5 py-4 text-sm">
                  {n.opponent && (
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground" aria-hidden />
                      You play <span className="font-semibold">{n.opponent}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Flag className="size-4 text-muted-foreground" aria-hidden />
                    {n.layout}
                  </div>
                  {n.foursome.length > 0 && (
                    <div className="flex items-start gap-2">
                      <CalendarClock className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                      <span>
                        Your group:{' '}
                        {n.foursome.map(([a, b], i) => (
                          <span key={i}>
                            {i > 0 && ' · '}
                            {a} vs {b}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {n.groupId && (
                    <div className="pt-1 font-medium text-primary">Open scorecard →</div>
                  )}
                </div>
              </Card>
            </Link>
            {n.groupId && n.date <= todayIso() && (
              <ScanCardButton
                leagueId={e.leagueId}
                seasonId={n.seasonId}
                weekId={n.weekId}
                groupId={n.groupId}
                label="Scan your foursome’s card"
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
