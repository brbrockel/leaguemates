import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, type Course, type SeasonSummary } from '@/lib/api';
import { formatDay } from '@/lib/time';

const STATUS = { draft: 'Draft', scheduled: 'Locked', complete: 'Complete' } as const;
/** Seasons listed under the featured one before the rest fold away. */
const SHOWN = 3;

export function useSeasons(leagueId: string) {
  return useQuery({
    queryKey: ['seasons', leagueId],
    queryFn: () => api<SeasonSummary[]>(`/leagues/${leagueId}/seasons`),
    enabled: Boolean(leagueId),
  });
}

/** The third Wednesday of April next year, as a reasonable default start. */
function defaultStart(): { name: string; date: string } {
  const year = new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0);
  const d = new Date(year, 3, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 14);
  const iso = `${year}-04-${String(d.getDate()).padStart(2, '0')}`;
  return { name: String(year), date: iso };
}

export function SeasonsCard({ leagueId, isAdmin }: { leagueId: string; isAdmin: boolean }) {
  const seasons = useSeasons(leagueId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initial = defaultStart();
  const [name, setName] = useState(initial.name);
  const [startDate, setStartDate] = useState(initial.date);
  const [creating, setCreating] = useState(false);
  // Courses with nines entered; the default (pinned) course comes first.
  const courses = useQuery({
    queryKey: ['courses'],
    queryFn: () => api<Course[]>('/courses'),
    enabled: creating,
  });
  const playable = (courses.data ?? [])
    .map((c) => ({ ...c, layouts: c.layouts.filter((l) => !l.retiredAt) }))
    .filter((c) => c.layouts.length > 0);
  const [courseId, setCourseId] = useState('');
  const course = playable.find((c) => c.id === courseId) ?? playable[0];
  const [picked, setPicked] = useState<string[] | null>(null);
  const nines = picked ?? course?.layouts.slice(0, 2).map((l) => l.id) ?? [];

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/leagues/${leagueId}/seasons`, {
        method: 'POST',
        body: { name, startDate, ...(course ? { courseId: course.id, layoutIds: nines } : {}) },
      }),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: ['seasons', leagueId] });
      navigate(`/leagues/${leagueId}/seasons/${s.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  // The season being played stands out on top (else the latest finished one); the rest
  // follow newest first, with all but a few tucked under "Older seasons".
  const all = seasons.data ?? [];
  const featured =
    all.find((x) => x.status === 'scheduled') ?? all.find((x) => x.status === 'complete');
  const rest = all.filter((x) => x !== featured);
  const recent = rest.slice(0, SHOWN);
  const older = rest.slice(SHOWN);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seasons</CardTitle>
        <CardDescription>Schedules, tee times and pairings for each season.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {seasons.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No seasons yet.</p>
        )}
        {featured && <FeaturedSeason leagueId={leagueId} season={featured} />}
        {recent.length > 0 && (
          <ul className="divide-y">
            {recent.map((s) => (
              <SeasonRow key={s.id} leagueId={leagueId} season={s} />
            ))}
          </ul>
        )}
        {older.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronRight
                className="size-4 transition-transform group-open:rotate-90"
                aria-hidden
              />
              Older seasons ({older.length})
            </summary>
            <ul className="divide-y">
              {older.map((s) => (
                <SeasonRow key={s.id} leagueId={leagueId} season={s} />
              ))}
            </ul>
          </details>
        )}
        {isAdmin &&
          (creating ? (
            <form
              onSubmit={submit}
              className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="season-name">Season</Label>
                <Input
                  id="season-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="season-start">First round</Label>
                <Input
                  id="season-start"
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-3">
                <Label htmlFor="season-course">Course</Label>
                <Select
                  id="season-course"
                  value={course?.id ?? ''}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setPicked(null);
                  }}
                >
                  {playable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.pinned ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
                {course && (
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-sm font-medium">
                      Nines (rotated week to week, in this order)
                    </legend>
                    {course.layouts.map((l) => (
                      <label key={l.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={nines.includes(l.id)}
                          onChange={(e) =>
                            setPicked(
                              e.target.checked
                                ? course.layouts
                                    .map((x) => x.id)
                                    .filter((id) => id === l.id || nines.includes(id))
                                : nines.filter((id) => id !== l.id),
                            )
                          }
                        />
                        {l.name}
                        <span className="text-xs text-muted-foreground">
                          {l.tees} · par {l.par}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
              <Button type="submit" disabled={create.isPending || nines.length === 0}>
                Create
              </Button>
              {create.isError && (
                <Alert variant="destructive" className="sm:col-span-3">
                  {create.error.message}
                </Alert>
              )}
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Starts from last season's roster, which you can change on the season page. Rounds
                are weekly from the first date; the starter can still switch the nine on the day.
              </p>
            </form>
          ) : (
            <Button variant="secondary" className="w-fit" onClick={() => setCreating(true)}>
              <CalendarPlus /> New season
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}

/** The season in play: a big tap target with where it stands. */
function FeaturedSeason({ leagueId, season: s }: { leagueId: string; season: SeasonSummary }) {
  const playing = s.status === 'scheduled';
  const round = Math.min(s.weeks, (s.past ?? 0) + 1);
  return (
    <Link
      to={`/leagues/${leagueId}/seasons/${s.id}`}
      className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
    >
      <CalendarDays className="size-6 shrink-0 text-primary" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-primary">
          {playing ? 'This season' : 'Last season'}
        </span>
        <span className="text-lg font-semibold leading-tight">{s.name}</span>
        <span className="text-sm text-muted-foreground">
          {playing
            ? s.nextDate
              ? `Round ${round} of ${s.weeks} · next ${formatDay(s.nextDate)}`
              : `${s.weeks} rounds · all played`
            : `${s.weeks} rounds · complete`}
        </span>
      </div>
      <ChevronRight className="ml-auto size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function SeasonRow({ leagueId, season: s }: { leagueId: string; season: SeasonSummary }) {
  return (
    <li>
      <Link
        to={`/leagues/${leagueId}/seasons/${s.id}`}
        className="flex items-center gap-3 py-3 hover:text-primary"
      >
        <span className="font-medium">{s.name}</span>
        <Badge>{STATUS[s.status]}</Badge>
        <span className="truncate text-sm text-muted-foreground">
          {s.weeks ? `${s.weeks} rounds` : `Starts ${formatDay(s.startDate)}`}
        </span>
        <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}
