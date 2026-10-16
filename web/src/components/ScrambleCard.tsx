import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Check, Shuffle, Trash2, Trophy, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, type ScrambleTeamView, type ScrambleView } from '@/lib/api';
import { aboutTeeTime, formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';

/** The post-season team scramble: set up by an admin, one card per team, ranked by net. */
export function ScrambleCard({
  leagueId,
  seasonId,
  seasonStatus,
}: {
  leagueId: string;
  seasonId: string;
  seasonStatus: string;
}) {
  const qc = useQueryClient();
  const base = `/leagues/${leagueId}/seasons/${seasonId}/scramble`;
  const key = ['scramble', seasonId];
  const q = useQuery({ queryKey: key, queryFn: () => api<ScrambleView>(base) });
  const [swapping, setSwapping] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (r: { path: string; method: 'POST' | 'PUT' | 'DELETE'; body?: object }) =>
      api<ScrambleView>(`${base}${r.path}`, {
        method: r.method,
        ...(r.body ? { body: r.body } : {}),
      }),
    onSuccess: (v) => qc.setQueryData(key, v),
  });

  const v = q.data;
  if (!v) return null;
  if (!v.scramble) {
    if (!v.canManage || seasonStatus === 'draft') return null;
    if (!v.ready)
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5 text-primary" aria-hidden /> Team scramble
            </CardTitle>
            <CardDescription>Set up after {v.waitingFor}.</CardDescription>
          </CardHeader>
        </Card>
      );
    return (
      <SetupCard
        defaults={v.defaults}
        onCreate={(body) => act.mutate({ path: '', method: 'POST', body })}
        pending={act.isPending}
        error={act.error?.message}
      />
    );
  }

  const s = v.scramble;
  const teams = [...v.teams].sort(
    (a, b) => (a.position ?? 99) - (b.position ?? 99) || a.number - b.number,
  );
  const canEditTeams = v.canManage && !s.started;

  const pick = (playerId: string, team: ScrambleTeamView) => {
    if (!picked || team.members.some((m) => m.playerId === picked)) {
      setPicked(playerId === picked ? null : playerId);
      return;
    }
    const next = v.teams.map((t) =>
      t.members.map((m) =>
        m.playerId === picked ? playerId : m.playerId === playerId ? picked : m.playerId,
      ),
    );
    setPicked(null);
    act.mutate({ path: '/teams', method: 'PUT', body: { teams: next } });
  };

  return (
    <Card className={cn(s.complete && 'border-amber-500/50')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5 text-primary" aria-hidden /> Team scramble
        </CardTitle>
        <CardDescription>
          {formatDay(s.date, true)} · {s.layout.name} · team handicap {s.allowance.join('/')}% from
          the lowest handicap up. Lowest net wins; ties go to the cards.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {swapping && (
          <Alert>
            {picked
              ? 'Now tap a player on another team to swap them.'
              : 'Tap a player, then a player on another team, to swap them.'}
          </Alert>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {teams.map((t) => (
            <li
              key={t.id}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm',
                s.complete && t.position === 1 && 'border-amber-500/60 bg-amber-500/5',
              )}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => !swapping && setOpen(open === t.id ? null : t.id)}
              >
                <span className="font-semibold">
                  {s.complete && t.position === 1 && (
                    <Trophy className="mr-1 inline size-4 text-amber-500" aria-label="Winner" />
                  )}
                  Team {t.number}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {t.teeTime && aboutTeeTime(t.teeTime)} · HCP {t.handicap}
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  {t.net !== null ? (
                    <>
                      <span className="font-semibold">net {t.net}</span>
                      <span className="ml-1 text-xs text-muted-foreground">({t.gross})</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t.holeScores.some((x) => x !== null) ? 'In progress' : 'No scores'}
                    </span>
                  )}
                </span>
              </button>
              <div className="mt-1 flex flex-wrap gap-1">
                {t.members.map((m) =>
                  swapping ? (
                    <button
                      type="button"
                      key={m.playerId}
                      onClick={() => pick(m.playerId, t)}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 text-xs',
                        picked === m.playerId && 'border-primary bg-primary/15',
                      )}
                    >
                      {m.nickname} {m.handicap}
                    </button>
                  ) : (
                    <span key={m.playerId} className="text-xs text-muted-foreground">
                      {m.nickname} ({m.handicap})
                    </span>
                  ),
                )}
              </div>
              {t.position !== null && t.onCards && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Position {t.position} on the cards
                </div>
              )}
              {open === t.id && !swapping && (
                <TeamScores
                  team={t}
                  holes={s.layout.holes}
                  pending={act.isPending}
                  onSave={(holeScores) =>
                    act.mutate({
                      path: `/teams/${t.id}/scores`,
                      method: 'PUT',
                      body: { holeScores, version: t.version },
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {act.isError && <Alert variant="destructive">{act.error.message}</Alert>}
        {v.canManage && (
          <div className="flex flex-wrap gap-2">
            {canEditTeams && (
              <>
                <Button
                  size="sm"
                  variant={swapping ? 'secondary' : 'outline'}
                  onClick={() => {
                    setSwapping(!swapping);
                    setPicked(null);
                  }}
                >
                  <ArrowLeftRight /> {swapping ? 'Done swapping' : 'Swap players'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ path: '/regenerate', method: 'POST', body: {} })}
                >
                  <Shuffle /> Rebalance
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={act.isPending}
              onClick={() =>
                window.confirm('Delete the scramble and any scores entered?') &&
                act.mutate({ path: '', method: 'DELETE' })
              }
            >
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamScores({
  team,
  holes,
  pending,
  onSave,
}: {
  team: ScrambleTeamView;
  holes: { number: number; par: number }[];
  pending: boolean;
  onSave: (holeScores: (number | null)[]) => void;
}) {
  const [scores, setScores] = useState(team.holeScores);
  const total = scores.reduce<number>((s, x) => s + (x ?? 0), 0);
  return (
    <div className="mt-2 border-t pt-2">
      <div className="grid grid-cols-9 gap-1 text-center text-xs">
        {holes.map((h, i) => (
          <div key={h.number} className="flex flex-col gap-0.5">
            <span className="font-semibold">{h.number}</span>
            <span className="text-muted-foreground">{h.par}</span>
            {team.canEnter ? (
              <Input
                aria-label={`Team ${team.number}, hole ${h.number}`}
                inputMode="numeric"
                className="h-9 px-0 text-center"
                value={scores[i] ?? ''}
                onChange={(e) => {
                  const d = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                  setScores(scores.map((x, j) => (j === i ? (d ? Number(d) : null) : x)));
                }}
              />
            ) : (
              <span className="py-2 tabular-nums">{scores[i] ?? '–'}</span>
            )}
          </div>
        ))}
      </div>
      {team.canEnter && (
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" disabled={pending} onClick={() => onSave(scores)}>
            <Check /> Save
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Gross {total} · net {total - team.handicap}
          </span>
        </div>
      )}
    </div>
  );
}

function SetupCard({
  defaults,
  onCreate,
  pending,
  error,
}: {
  defaults: Extract<ScrambleView, { scramble: null }>['defaults'];
  onCreate: (body: object) => void;
  pending: boolean;
  error: string | undefined;
}) {
  const [show, setShow] = useState(false);
  const [date, setDate] = useState(defaults.date);
  const [layoutId, setLayoutId] = useState(defaults.layouts[0]?.id ?? '');
  const [teamSize, setTeamSize] = useState(defaults.teamSize);
  const [allowance, setAllowance] = useState(defaults.allowance.join(', '));
  const [playing, setPlaying] = useState(() => new Set(defaults.players.map((p) => p.playerId)));
  const parsed = allowance
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const allowanceOk =
    parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 100);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate({ date, layoutId, teamSize, allowance: parsed, playerIds: [...playing] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5 text-primary" aria-hidden /> Team scramble
        </CardTitle>
        <CardDescription>
          After the playoffs. Teams are balanced by handicap; you can swap players after.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!show ? (
          <Button variant="outline" onClick={() => setShow(true)}>
            Set up the scramble
          </Button>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scr-date">Date</Label>
                <Input
                  id="scr-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scr-nine">Nine</Label>
                <Select
                  id="scr-nine"
                  value={layoutId}
                  onChange={(e) => setLayoutId(e.target.value)}
                >
                  {defaults.layouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scr-size">Team size</Label>
                <Select
                  id="scr-size"
                  value={teamSize}
                  onChange={(e) => setTeamSize(Number(e.target.value))}
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="scr-allow">Allowance %</Label>
                <Input
                  id="scr-allow"
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                  aria-invalid={!allowanceOk}
                  className={cn(!allowanceOk && 'border-destructive')}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Allowance: percent of each player's handicap, lowest handicap first. 20, 15, 10, 5 is
              common for teams of four.
            </p>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">Playing ({playing.size})</legend>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {defaults.players.map((p) => (
                  <label key={p.playerId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={playing.has(p.playerId)}
                      onChange={(e) => {
                        const next = new Set(playing);
                        if (e.target.checked) next.add(p.playerId);
                        else next.delete(p.playerId);
                        setPlaying(next);
                      }}
                    />
                    {p.nickname}
                    <span className="text-xs text-muted-foreground">{p.handicap ?? 'no HCP'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={pending || !allowanceOk || playing.size < 2 || !layoutId}
              >
                <Check /> Make teams
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShow(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
