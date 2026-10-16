import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Gavel, Play, SkipForward, Trophy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { api, type PlayoffBracket, type PlayoffDecision } from '@/lib/api';
import { formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { winnerRow } from '@/lib/winner';

export const DECIDED_BY: Record<PlayoffDecision, string> = {
  net: 'on net',
  card_match: 'on the cards',
  forfeit: 'opponent absent',
  seed: 'higher seed',
  commissioner: 'admin decision',
};

type Match = PlayoffBracket['rounds'][number]['matches'][number];

export function PlayoffsCard({
  leagueId,
  seasonId,
  isAdmin,
  seasonStatus,
}: {
  leagueId: string;
  seasonId: string;
  isAdmin: boolean;
  seasonStatus: string;
}) {
  const qc = useQueryClient();
  const base = `/leagues/${leagueId}/seasons/${seasonId}`;
  const key = ['playoffs', seasonId];
  const bracket = useQuery({
    queryKey: key,
    queryFn: () => api<PlayoffBracket>(`${base}/playoffs`),
  });
  const [deciding, setDeciding] = useState<Match | null>(null);

  const act = useMutation({
    mutationFn: (path: string) =>
      api<PlayoffBracket>(`${base}/playoffs/${path}`, { method: 'POST' }),
    onSuccess: async (b) => {
      qc.setQueryData(key, b);
      await qc.invalidateQueries({ queryKey: ['season', seasonId] });
      await qc.invalidateQueries({ queryKey: ['this-week'] });
    },
  });

  const b = bracket.data;
  if (!b || b.format === 'none') return null;
  if (b.rounds.length === 0 && (seasonStatus !== 'scheduled' || (!b.canStart && !isAdmin)))
    return null;

  const last = b.rounds.at(-1);
  const readyToAdvance = last && !last.isFinal && last.matches.every((m) => m.winner);
  const cardPath = (weekId: string, groupId: string) => `${base}/weeks/${weekId}/groups/${groupId}`;

  return (
    <Card className={cn(b.champion && 'border-amber-500/50')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="size-5 text-amber-500" aria-hidden /> Playoffs
        </CardTitle>
        <CardDescription>
          {b.format === 'knockout'
            ? 'Seeded knockout (1 v 16, 2 v 15, …), then the Finals foursome.'
            : 'The top four play the Finals foursome.'}{' '}
          Ties: matching cards, then the higher seed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {b.champion && (
          <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-3">
            <Trophy className="size-7 text-amber-500" aria-hidden />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Champion</div>
              <Link
                to={`/leagues/${leagueId}/players/${b.champion.playerId}`}
                className="text-lg font-semibold hover:underline"
              >
                {b.champion.nickname}
              </Link>
            </div>
          </div>
        )}

        {b.rounds.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {b.regularRoundsLeft > 0
              ? `Starts when the regular season is done (${b.regularRoundsLeft} round${b.regularRoundsLeft === 1 ? '' : 's'} left).`
              : 'Seeds come from the final regular-season standings.'}
          </p>
        )}

        {b.rounds.map((r) => (
          <section key={r.weekId} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {r.isFinal ? 'Finals' : `Round ${r.round}`}{' '}
              <span className="font-normal text-muted-foreground">· {formatDay(r.date)}</span>
            </h3>
            {r.isFinal ? (
              <Link
                to={cardPath(r.weekId, r.groups[0]!.id)}
                className="block rounded-lg border px-3 py-2 hover:border-primary/50"
              >
                {r.finals?.standings.length ? (
                  <ol className="text-sm">
                    {r.finals.standings.map((s) => (
                      <li
                        key={s.id}
                        className={cn(
                          'flex justify-between',
                          s.id === r.finals?.winner && winnerRow,
                        )}
                      >
                        <span>
                          {s.position}. {s.nickname}
                        </span>
                        <span className="tabular-nums text-muted-foreground">net {s.net}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-sm">
                    {r.finalists?.map((f, i) => (
                      <span key={f.playerId}>
                        {i > 0 && ' · '}({f.seed}) {f.nickname}
                      </span>
                    ))}
                    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      Open the Finals card <ChevronRight className="size-3" />
                    </span>
                  </div>
                )}
                {r.finals?.winner && r.finals.decidedBy !== 'net' && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Won {DECIDED_BY[r.finals.decidedBy]}
                  </div>
                )}
              </Link>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {r.matches.map((m) => (
                  <li key={m.id}>
                    <Link
                      to={cardPath(r.weekId, m.groupId)}
                      className="block rounded-lg border px-3 py-2 text-sm hover:border-primary/50"
                    >
                      {[m.a, m.b].map((p) => (
                        <div
                          key={p.playerId}
                          className={cn(
                            'flex justify-between',
                            m.winner === p.playerId && winnerRow,
                          )}
                        >
                          <span>
                            <span className="text-xs text-muted-foreground">({p.seed})</span>{' '}
                            {p.nickname}
                          </span>
                          {m.winner === p.playerId && <span className="text-xs">advances</span>}
                        </div>
                      ))}
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {m.winner
                          ? `Won ${DECIDED_BY[m.decidedBy ?? 'net']}${m.decidedReason ? ` (${m.decidedReason})` : ''}`
                          : m.decidedBy === 'commissioner'
                            ? 'Both absent: an admin decides'
                            : m.card
                              ? 'Card in progress'
                              : 'Not played yet'}
                      </div>
                    </Link>
                    {isAdmin && !m.winner && m.decidedBy === 'commissioner' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        onClick={() => setDeciding(m)}
                      >
                        <Gavel /> Decide
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {isAdmin && b.canStart && (
          <Button
            className="w-fit"
            disabled={act.isPending}
            onClick={() =>
              window.confirm('Start the playoffs? Seeds are taken from the current standings.') &&
              act.mutate('start')
            }
          >
            <Play /> Start playoffs
          </Button>
        )}
        {isAdmin && readyToAdvance && (
          <Button className="w-fit" disabled={act.isPending} onClick={() => act.mutate('advance')}>
            <SkipForward /> {last!.matches.length === 4 ? 'Start the Finals' : 'Next round'}
          </Button>
        )}
        {act.isError && <Alert variant="destructive">{act.error.message}</Alert>}
        {b.rounds.length > 0 && !b.champion && <Badge className="w-fit">In progress</Badge>}
      </CardContent>
      {deciding && (
        <DecideDialog
          match={deciding}
          path={`${base}/playoffs/matches/${deciding.id}/decide`}
          onClose={() => setDeciding(null)}
          onDone={(nb) => {
            qc.setQueryData(key, nb);
            setDeciding(null);
          }}
        />
      )}
    </Card>
  );
}

function DecideDialog({
  match,
  path,
  onClose,
  onDone,
}: {
  match: Match;
  path: string;
  onClose: () => void;
  onDone: (b: PlayoffBracket) => void;
}) {
  const [winnerId, setWinnerId] = useState(match.a.playerId);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: () => api<PlayoffBracket>(path, { method: 'POST', body: { winnerId, reason } }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    decide.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Decide this match"
        description={`${match.a.nickname} v ${match.b.nickname}. The decision and reason are logged.`}
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Label htmlFor="winner">Advances</Label>
          <Select id="winner" value={winnerId} onChange={(e) => setWinnerId(e.target.value)}>
            {[match.a, match.b].map((p) => (
              <option key={p.playerId} value={p.playerId}>
                ({p.seed}) {p.nickname}
              </option>
            ))}
          </Select>
          <Label htmlFor="reason">Reason</Label>
          <Input
            id="reason"
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Both absent: higher seed advances"
          />
          {decide.isError && <Alert variant="destructive">{decide.error.message}</Alert>}
          <Button type="submit" disabled={decide.isPending}>
            Save decision
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
