import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api, ApiError, type HandicapSuggestions } from '@/lib/api';
import { formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { NotFoundPage } from './NotFoundPage';

type Row = HandicapSuggestions['players'][number];

/** The rule in plain words, e.g. "Best 10 of the last 20 rounds: 75% of the average over 35, rounded down, at most 18." */
function describeRule(r: HandicapSuggestions['rule']) {
  const which =
    r.best > 0
      ? `Best ${r.best} of the last ${r.rounds} rounds`
      : `Average of the last ${r.rounds} rounds`;
  return `${which}: ${r.allowance}% of the average over ${r.base}, ${r.rounding === 'down' ? 'rounded down' : 'rounded'}, at most ${r.max}. Needs ${r.minimumRounds} rounds.`;
}

export function HandicapsPage() {
  const { leagueId = '' } = useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.leagues.find((l) => l.id === leagueId)?.role === 'admin';
  const key = ['handicaps', leagueId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<HandicapSuggestions>(`/leagues/${leagueId}/handicaps`),
  });
  const [open, setOpen] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: (playerIds?: string[]) =>
      api<HandicapSuggestions & { changed: number }>(`/leagues/${leagueId}/handicaps/apply`, {
        method: 'POST',
        body: playerIds ? { playerIds } : {},
      }),
    onSuccess: async (d) => {
      qc.setQueryData(key, d);
      await qc.invalidateQueries({ queryKey: ['league', leagueId, 'members'] });
    },
  });

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
  const d = q.data;
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const changes = d.players.filter((p) => p.suggested !== null && p.suggested !== p.current);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to={`/leagues/${leagueId}`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> League
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Handicaps</h1>
        <p className="text-sm text-muted-foreground">
          {describeRule(d.rule)}
          {d.includedLeague && ` Includes rounds from ${d.includedLeague.name}.`}{' '}
          <Link to={`/leagues/${leagueId}/settings`} className="underline">
            {isAdmin ? 'Change the rule' : 'League rules'}
          </Link>
        </p>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={changes.length === 0 || apply.isPending}
            onClick={() =>
              window.confirm(
                `Update ${changes.length} handicap${changes.length === 1 ? '' : 's'}? The change is logged.`,
              ) && apply.mutate(undefined)
            }
          >
            <Check /> Apply {changes.length} change{changes.length === 1 ? '' : 's'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Suggestions never change a handicap until an admin applies them.
          </span>
        </div>
      )}
      {apply.isError && <Alert variant="destructive">{apply.error.message}</Alert>}
      {apply.data && (
        <Alert>
          Updated {apply.data.changed} handicap{apply.data.changed === 1 ? '' : 's'}.
        </Alert>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="p-2.5 text-left font-medium">Player</th>
              <th className="w-14 p-2.5 font-medium">Now</th>
              <th className="w-20 p-2.5 font-medium">Suggested</th>
              <th className="hidden w-14 p-2.5 font-medium sm:table-cell">Avg</th>
              <th className="w-8 p-2.5" />
            </tr>
          </thead>
          <tbody>
            {d.players.map((p) => (
              <PlayerRows
                key={p.playerId}
                p={p}
                open={open === p.playerId}
                onToggle={() => setOpen(open === p.playerId ? null : p.playerId)}
                canApply={isAdmin}
                applying={apply.isPending}
                onApply={() => apply.mutate([p.playerId])}
                includedName={d.includedLeague?.name}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PlayerRows({
  p,
  open,
  onToggle,
  canApply,
  applying,
  onApply,
  includedName,
}: {
  p: Row;
  open: boolean;
  onToggle: () => void;
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
  includedName: string | undefined;
}) {
  const diff = p.suggested !== null && p.current !== null ? p.suggested - p.current : null;
  const changed = p.suggested !== null && p.suggested !== p.current;
  return (
    <>
      <tr className="cursor-pointer border-t hover:bg-accent/40" onClick={onToggle}>
        <td className="p-2.5 font-medium">{p.nickname}</td>
        <td className="p-2.5 text-center tabular-nums">{p.current ?? '–'}</td>
        <td
          className={cn(
            'p-2.5 text-center font-semibold tabular-nums',
            !changed && 'font-normal text-muted-foreground',
          )}
        >
          {p.suggested ?? <span className="text-xs font-normal">needs rounds</span>}
          {diff !== null && diff !== 0 && (
            <span
              className={cn(
                'ml-1 inline-flex items-center text-xs',
                diff < 0 ? 'text-primary' : 'text-amber-600 dark:text-amber-400',
              )}
            >
              {diff < 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
              {Math.abs(diff)}
            </span>
          )}
        </td>
        <td className="hidden p-2.5 text-center tabular-nums text-muted-foreground sm:table-cell">
          {p.average ?? '–'}
        </td>
        <td className="p-2.5">
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={5} className="p-3">
            {p.window.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {p.totalRounds} round{p.totalRounds === 1 ? '' : 's'} so far: not enough for a
                suggestion yet.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  Last {p.window.length} rounds, oldest first.{' '}
                  <strong className="text-foreground">Bold</strong> scores were averaged (
                  {p.average}).
                  {includedName &&
                    p.window.some((w) => w.league === 'included') &&
                    ` Dotted ones are from ${includedName}.`}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {p.window.map((w, i) => (
                    <li
                      key={i}
                      title={formatDay(w.date, true)}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 text-xs tabular-nums',
                        w.counted
                          ? 'border-primary/40 bg-primary/10 font-semibold'
                          : 'text-muted-foreground',
                        w.league === 'included' && 'border-dotted',
                      )}
                    >
                      {w.gross}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {canApply && changed && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={applying}
                onClick={(e) => {
                  e.stopPropagation();
                  onApply();
                }}
              >
                <Check /> Set {p.nickname} to {p.suggested}
              </Button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
