import { useMutation } from '@tanstack/react-query';
import { Camera, ScanLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PracticeReading {
  provider: 'claude' | 'ocr';
  layout: { name: string; holes: { number: number; par: number }[] };
  rows: {
    nameOnCard: string;
    playerId: string | null;
    player: string | null;
    holeScores: (number | null)[];
    uncertain: number[];
    absent: boolean;
  }[];
  notes: string[];
  left: number;
  players: { playerId: string; nickname: string; handicap: number | null }[];
}

/** One row as the person corrects it: who it is ('' = leave it out) and the scores. */
interface Row {
  nameOnCard: string;
  playerId: string;
  scores: string[];
  read: (number | null)[];
  uncertain: number[];
}

const OMIT = '';

/**
 * Account: try scanning a paper card (or a screenshot) to see what the reader gets, then
 * check it the way you would on game day: match each name to a league player (or leave the
 * row out) and fix any score it misread. Nothing is saved.
 */
export function PracticeScanCard() {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const scan = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<PracticeReading>('/me/card-scan/practice', { method: 'POST', body });
    },
    onSuccess: (r) =>
      setRows(
        r.rows.map((x) => ({
          nameOnCard: x.nameOnCard,
          playerId: x.absent ? OMIT : (x.playerId ?? OMIT),
          scores: x.holeScores.map((s) => (s === null ? '' : String(s))),
          read: x.holeScores,
          uncertain: x.uncertain,
        })),
      ),
  });
  const r = scan.data;
  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const setScore = (i: number, h: number, v: string) =>
    update(i, {
      scores: rows[i]!.scores.map((s, k) => (k === h ? v.replace(/\D/g, '').slice(0, 2) : s)),
    });

  const used = rows.map((x) => x.playerId).filter((id) => id !== OMIT);
  const doubled = new Set(used.filter((id, i) => used.indexOf(id) !== i));
  const kept = rows.filter((x) => x.playerId !== OMIT);
  const incomplete = kept.filter((x) => x.scores.some((s) => s === '')).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="size-5 text-primary" aria-hidden /> Practice a card scan
        </CardTitle>
        <CardDescription>
          Take a photo of a scorecard (or pick one) and check what TeeMate reads, the way you would
          on game day: match each name to a league player, leave out rows that aren't players, and
          fix any score it got wrong. Nothing is saved, so use any card you like.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={scan.isPending}
            onClick={() => input.current?.click()}
          >
            <Camera />{' '}
            {scan.isPending ? 'Reading the card…' : r ? 'Try another card' : 'Scan a card'}
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            aria-label="Card photo"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) scan.mutate(f);
            }}
          />
        </div>
        {scan.isError && <Alert variant="destructive">{scan.error.message}</Alert>}
        {r && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Read by {r.provider === 'claude' ? 'the AI reader' : 'basic text recognition'} as{' '}
              {r.layout.name}. {r.rows.length} {r.rows.length === 1 ? 'row' : 'rows'} found.
              {rows.some((x) => x.uncertain.length) && ' Amber scores are worth a second look.'}
            </p>
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="py-1 pr-2 text-left font-medium">Player</th>
                      {r.layout.holes.map((h) => (
                        <th key={h.number} className="w-9 text-center font-medium">
                          {h.number}
                          <span className="block font-normal">{h.par}</span>
                        </th>
                      ))}
                      <th className="w-12 text-center font-medium">Total</th>
                      <th className="w-12 text-center font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const omitted = row.playerId === OMIT;
                      const total = row.scores.every((s) => s !== '')
                        ? row.scores.reduce((a, s) => a + Number(s), 0)
                        : null;
                      const hcp = r.players.find((p) => p.playerId === row.playerId)?.handicap;
                      return (
                        <tr key={i} className={cn('border-t', omitted && 'opacity-50')}>
                          <td className="py-1.5 pr-2">
                            <span className="block text-xs text-muted-foreground">
                              “{row.nameOnCard || '?'}” on the card
                            </span>
                            <Select
                              aria-label={`Player for ${row.nameOnCard || `row ${i + 1}`}`}
                              className={cn(
                                'h-8 w-40',
                                doubled.has(row.playerId) && 'border-destructive',
                              )}
                              value={row.playerId}
                              onChange={(e) => update(i, { playerId: e.target.value })}
                            >
                              <option value={OMIT}>Leave out</option>
                              {r.players.map((p) => (
                                <option key={p.playerId} value={p.playerId}>
                                  {p.nickname}
                                </option>
                              ))}
                            </Select>
                          </td>
                          {row.scores.map((s, h) => (
                            <td key={h} className="px-0.5 text-center">
                              <input
                                aria-label={`${row.nameOnCard || `Row ${i + 1}`} hole ${h + 1}`}
                                inputMode="numeric"
                                disabled={omitted}
                                value={s}
                                onChange={(e) => setScore(i, h, e.target.value)}
                                className={cn(
                                  'h-8 w-8 rounded border bg-card text-center',
                                  row.uncertain.includes(h) &&
                                    'border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-200',
                                  s !== String(row.read[h] ?? '') && 'border-primary font-semibold',
                                )}
                              />
                            </td>
                          ))}
                          <td className="text-center font-medium">
                            {omitted ? '' : (total ?? '–')}
                          </td>
                          <td className="text-center">
                            {omitted || total === null || hcp == null ? '' : total - hcp}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {doubled.size > 0 && (
              <Alert variant="destructive">
                Two rows are matched to the same player. Pick the right one for each.
              </Alert>
            )}
            {rows.length > 0 && doubled.size === 0 && (
              <Alert>
                {kept.length} {kept.length === 1 ? 'player' : 'players'} matched
                {incomplete
                  ? `; ${incomplete} still ${incomplete === 1 ? 'has' : 'have'} a blank hole.`
                  : ', every hole filled in.'}{' '}
                On game day this is the point where you'd save the card.
              </Alert>
            )}
            {r.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              {r.left} practice {r.left === 1 ? 'scan' : 'scans'} left today.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
