import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeagueSettings } from '@teemate/shared';
import { ArrowLeft, Check, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ME_KEY, useMe } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, ApiError, type LeagueAccess } from '@/lib/api';
import { NotFoundPage } from './NotFoundPage';

interface League {
  id: string;
  name: string;
  role: LeagueAccess;
  settings: LeagueSettings;
  visibility: 'private' | 'public';
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  disabled: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      required
      disabled={disabled}
      value={Number.isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
    />
  );
}

/** Comma-separated percentages; keeps the text as typed and reports valid lists only. */
function AllowanceInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: number[];
  onChange: (v: number[]) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(value.join(', '));
  return (
    <Input
      id={id}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const nums = e.target.value
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 100))
          onChange(nums);
      }}
    />
  );
}

export function LeagueSettingsPage() {
  const { leagueId = '' } = useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const league = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => api<League>(`/leagues/${leagueId}`),
  });
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [s, setS] = useState<LeagueSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (league.data) {
      setName(league.data.name);
      setVisibility(league.data.visibility ?? 'private');
      setS(league.data.settings);
    }
  }, [league.data]);

  const save = useMutation({
    mutationFn: () =>
      api<League>(`/leagues/${leagueId}`, {
        method: 'PATCH',
        body: { name, visibility, settings: s },
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(['league', leagueId], updated);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      setSaved(true);
    },
  });

  if (league.error instanceof ApiError && league.error.status === 404) return <NotFoundPage />;
  if (!league.data || !s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const readOnly = league.data.role !== 'admin';

  const update = <K extends keyof LeagueSettings>(key: K, value: LeagueSettings[K]) => {
    setSaved(false);
    setS({ ...s, [key]: value });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to league">
          <Link to={`/leagues/${leagueId}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">League settings</h1>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? 'The rules for this league. Only admins can change them.'
              : 'Changes are logged with who made them.'}
          </p>
        </div>
      </div>

      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>League</CardTitle>
          </CardHeader>
          <CardContent>
            <Field id="league-name" label="Name">
              <Input
                id="league-name"
                required
                minLength={2}
                value={name}
                onChange={(e) => (setSaved(false), setName(e.target.value))}
              />
            </Field>
            <div className="mt-3">
              <Field
                id="league-visibility"
                label="Who can see this league"
                hint={
                  visibility === 'private'
                    ? 'Private: only its members can see it.'
                    : "Public: anyone with a TeeMate account can view schedules, standings and results. Only members can enter cards or post, and members' contact details stay hidden."
                }
              >
                <Select
                  id="league-visibility"
                  value={visibility}
                  onChange={(e) => (
                    setSaved(false),
                    setVisibility(e.target.value as 'private' | 'public')
                  )}
                >
                  <option value="private">Private (members only)</option>
                  <option value="public">Public (anyone signed in can view)</option>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scoring</CardTitle>
            <CardDescription>
              Points per match. The higher handicap always gets the full difference in strokes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            {(['win', 'tie', 'loss'] as const).map((k) => (
              <Field key={k} id={`points-${k}`} label={k[0]!.toUpperCase() + k.slice(1)}>
                <NumberInput
                  id={`points-${k}`}
                  min={0}
                  max={10}
                  disabled={readOnly}
                  value={s.points[k]}
                  onChange={(n) => update('points', { ...s.points, [k]: n })}
                />
              </Field>
            ))}
          </CardContent>
        </Card>

        <HowScoringWorks points={s.points} />

        <Card>
          <CardHeader>
            <CardTitle>Handicaps</CardTitle>
            <CardDescription>
              How suggested handicaps are worked out from recent 9-hole scores. Admins review
              suggestions on the{' '}
              <Link to={`/leagues/${leagueId}/handicaps`} className="underline">
                Handicaps
              </Link>{' '}
              page before applying them. Sub rounds never count.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field id="hcp-rounds" label="Rounds looked at" hint="The player's last N rounds">
              <NumberInput
                id="hcp-rounds"
                min={1}
                max={40}
                disabled={readOnly}
                value={s.handicap.rounds}
                onChange={(n) => update('handicap', { ...s.handicap, rounds: n })}
              />
            </Field>
            <Field id="hcp-best" label="Best rounds counted" hint="Lowest K of those; 0 = all">
              <NumberInput
                id="hcp-best"
                min={0}
                max={40}
                disabled={readOnly}
                value={s.handicap.best}
                onChange={(n) => update('handicap', { ...s.handicap, best: n })}
              />
            </Field>
            <Field id="hcp-base" label="Score for handicap 0" hint="Par is 36">
              <NumberInput
                id="hcp-base"
                min={27}
                max={45}
                disabled={readOnly}
                value={s.handicap.base}
                onChange={(n) => update('handicap', { ...s.handicap, base: n })}
              />
            </Field>
            <Field id="hcp-allowance" label="Allowance %" hint="Share of (average − that score)">
              <NumberInput
                id="hcp-allowance"
                min={50}
                max={100}
                disabled={readOnly}
                value={s.handicap.allowance}
                onChange={(n) => update('handicap', { ...s.handicap, allowance: n })}
              />
            </Field>
            <Field id="hcp-rounding" label="Rounding">
              <Select
                id="hcp-rounding"
                disabled={readOnly}
                value={s.handicap.rounding}
                onChange={(e) =>
                  update('handicap', {
                    ...s.handicap,
                    rounding: e.target.value as LeagueSettings['handicap']['rounding'],
                  })
                }
              >
                <option value="down">Round down</option>
                <option value="nearest">Round to nearest</option>
              </Select>
            </Field>
            <Field id="hcp-max" label="Maximum handicap">
              <NumberInput
                id="hcp-max"
                min={1}
                max={36}
                disabled={readOnly}
                value={s.handicap.max}
                onChange={(n) => update('handicap', { ...s.handicap, max: n })}
              />
            </Field>
            <Field
              id="hcp-min"
              label="Minimum rounds"
              hint="Fewer than this: keep the current handicap"
            >
              <NumberInput
                id="hcp-min"
                min={1}
                max={40}
                disabled={readOnly}
                value={s.handicap.minimumRounds}
                onChange={(n) => update('handicap', { ...s.handicap, minimumRounds: n })}
              />
            </Field>
            <Field
              id="hcp-include"
              label="Also count rounds from"
              hint="Earlier seasons kept in another league, matched by nickname"
            >
              <Select
                id="hcp-include"
                disabled={readOnly}
                value={s.handicap.includeLeagueId ?? ''}
                onChange={(e) =>
                  update('handicap', { ...s.handicap, includeLeagueId: e.target.value || null })
                }
              >
                <option value="">This league only</option>
                {me?.leagues
                  .filter((l) => l.id !== leagueId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Used when the season schedule is generated.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field
              id="weeks"
              label="Regular-season weeks"
              hint="15 = everyone plays everyone once with 16 players"
            >
              <NumberInput
                id="weeks"
                min={1}
                max={40}
                disabled={readOnly}
                value={s.season.regularSeasonWeeks}
                onChange={(n) => update('season', { regularSeasonWeeks: n })}
              />
            </Field>
            <Field id="nines" label="Nine played">
              <Select
                id="nines"
                value={s.nines}
                onChange={(e) => update('nines', e.target.value as LeagueSettings['nines'])}
              >
                <option value="alternate">Alternate front and back</option>
                <option value="front">Always front nine</option>
                <option value="back">Always back nine</option>
              </Select>
            </Field>
            <Field id="first-tee" label="First tee time">
              <Input
                id="first-tee"
                type="time"
                required
                value={s.teeTimes.firstTeeTime}
                onChange={(e) =>
                  update('teeTimes', { ...s.teeTimes, firstTeeTime: e.target.value })
                }
              />
            </Field>
            <Field id="interval" label="Minutes between groups">
              <NumberInput
                id="interval"
                min={5}
                max={30}
                disabled={readOnly}
                value={s.teeTimes.intervalMinutes}
                onChange={(n) => update('teeTimes', { ...s.teeTimes, intervalMinutes: n })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team scramble</CardTitle>
            <CardDescription>
              Defaults when an admin sets up the post-season scramble. Team handicap is a share of
              each player's handicap, lowest handicap first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field id="scr-size" label="Team size">
              <NumberInput
                id="scr-size"
                min={2}
                max={6}
                disabled={readOnly}
                value={s.scramble.teamSize}
                onChange={(n) => update('scramble', { ...s.scramble, teamSize: n })}
              />
            </Field>
            <Field id="scr-allowance" label="Allowance %" hint="e.g. 20, 15, 10, 5">
              <AllowanceInput
                id="scr-allowance"
                disabled={readOnly}
                value={s.scramble.allowance}
                onChange={(allowance) => update('scramble', { ...s.scramble, allowance })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Playoffs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field id="playoff-format" label="Format">
              <Select
                id="playoff-format"
                value={s.playoffs.format}
                onChange={(e) =>
                  update('playoffs', {
                    ...s.playoffs,
                    format: e.target.value as LeagueSettings['playoffs']['format'],
                  })
                }
              >
                <option value="knockout">Seeded knockout, then Finals foursome</option>
                <option value="final_foursome">Final foursome only</option>
                <option value="none">No playoffs</option>
              </Select>
            </Field>
            <Field
              id="tiebreak"
              label="Tie-break"
              hint="Net scores, counting back from the last hole"
            >
              <Select
                id="tiebreak"
                value={s.playoffs.tiebreak}
                onChange={(e) =>
                  update('playoffs', {
                    ...s.playoffs,
                    tiebreak: e.target.value as LeagueSettings['playoffs']['tiebreak'],
                  })
                }
              >
                <option value="standard">Last 6, last 3, last hole</option>
                <option value="par5s_first">Par 5s first, then last 6/3/1</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scorecards</CardTitle>
          </CardHeader>
          <CardContent>
            <Field
              id="dispute"
              label="Hours to dispute a card"
              hint="After this, a submitted card becomes final"
            >
              <NumberInput
                id="dispute"
                min={0}
                max={168}
                disabled={readOnly}
                value={s.scorecards.disputeWindowHours}
                onChange={(n) => update('scorecards', { disputeWindowHours: n })}
              />
            </Field>
          </CardContent>
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="sticky bottom-20 z-30 flex items-center gap-3 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-4">
          <Button type="submit" disabled={save.isPending}>
            <Save /> Save changes
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-primary">
              <Check className="size-4" /> Saved
            </span>
          )}
          {save.isError && <span className="text-sm text-destructive">{save.error.message}</span>}
        </div>
      )}
    </form>
  );
}

/** The league's scoring rules in plain words, as the spreadsheet always worked. */
function HowScoringWorks({ points }: { points: { win: number; tie: number; loss: number } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How scoring works</CardTitle>
        <CardDescription>The same way the league's spreadsheet always worked.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm">
          <Rule term="Gross">Every stroke you take, before any handicap.</Rule>
          <Rule term="Strokes">
            In each match the higher handicap gets the difference between the two handicaps as
            strokes; the lower handicap gets none. Handicaps 7 and 13: the 13 gets 6.
          </Rule>
          <Rule term="Net">
            Gross minus the strokes you get in that match. The lower net wins the match; the same
            net is a tie. Example: Jerry (7) shoots 47 and Keith (13) shoots 55, so Keith's net is
            55 − 6 = 49 and Jerry wins, 47 to 49.
          </Rule>
          <Rule term="Points">
            Win {points.win}, tie {points.tie}, loss {points.loss}.
          </Rule>
          <Rule term="One player absent">
            A sub may play, but the sub's score never counts. The player who showed up wins only
            with a net lower than the absent player's par + handicap (36 + 13 = 49 on a par-36
            nine); otherwise it's a tie. The player who showed up can't lose.
          </Rule>
          <Rule term="Both absent">A tie.</Rule>
          <Rule term="Standings">
            Points first. Level on points: more wins, then head-to-head points between the tied
            players, then the lower total of gross minus handicap over the rounds they all played.
            The same order seeds the playoffs.
          </Rule>
          <Rule term="Playoffs">
            A tied playoff match is decided on the cards (matching the last holes); an absent player
            loses.
          </Rule>
          <Rule term="Past seasons">
            Imported seasons keep the results and standings the league recorded on its sheets, even
            where a recorded tie and the scores don't agree (usually an absence).
          </Rule>
        </dl>
      </CardContent>
    </Card>
  );
}

function Rule({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="font-medium">{term}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  );
}
