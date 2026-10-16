import { cn } from '@/lib/utils';

export interface HoleStat {
  number: number;
  par: number;
  strokeIndex: number;
  n: number;
  avg: number | null;
  toPar: number | null;
  rank: number | null;
  mix: { birdie: number; par: number; bogey: number; double: number };
  mine: { n: number; avg: number | null } | null;
}

export interface NineStats {
  layoutId: string;
  name: string;
  course: string;
  rounds: number;
  mine: number | null;
  holes: HoleStat[];
}

const signed = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(2)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * One nine, hole by hole: how it plays (average, over par with a bar, difficulty rank, mix
 * of results) or, with `mine`, the player against the field.
 */
export function HoleTable({ nine, mine = false }: { nine: NineStats; mine?: boolean }) {
  const maxOver = Math.max(0.5, ...nine.holes.map((h) => Math.abs(h.toPar ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-medium">Hole</th>
            <th className="text-center font-medium">Par</th>
            {mine ? (
              <>
                <th className="text-right font-medium">You</th>
                <th className="text-right font-medium">Field</th>
                <th className="pl-3 text-left font-medium">You vs field</th>
              </>
            ) : (
              <>
                <th className="text-right font-medium">Avg</th>
                <th className="pl-3 text-left font-medium">Over par</th>
                <th className="text-center font-medium" title="1 = plays hardest">
                  Rank
                </th>
                <th className="hidden text-right font-medium sm:table-cell">Birdie+</th>
                <th className="hidden text-right font-medium sm:table-cell">Par</th>
                <th className="hidden text-right font-medium sm:table-cell">Bogey</th>
                <th className="hidden text-right font-medium sm:table-cell">Double+</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {nine.holes.map((h) => {
            const diff =
              h.mine?.avg != null && h.avg != null
                ? Math.round((h.mine.avg - h.avg) * 100) / 100
                : null;
            return (
              <tr key={h.number} className="border-t">
                <td className="py-1.5">
                  {h.number}
                  <span className="ml-1 text-xs text-muted-foreground">SI {h.strokeIndex}</span>
                </td>
                <td className="text-center">{h.par}</td>
                {mine ? (
                  <>
                    <td className="text-right font-medium">{h.mine?.avg?.toFixed(2) ?? '–'}</td>
                    <td className="text-right text-muted-foreground">{h.avg?.toFixed(2) ?? '–'}</td>
                    <td className="pl-3">
                      {diff === null ? (
                        ''
                      ) : (
                        <span
                          className={cn(diff > 0 ? 'text-foreground' : 'text-muted-foreground')}
                        >
                          {diff === 0 ? 'Even' : `${signed(diff)} ${diff > 0 ? 'worse' : 'better'}`}
                        </span>
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="text-right font-medium">{h.avg?.toFixed(2) ?? '–'}</td>
                    <td className="pl-3">
                      {h.toPar !== null && (
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-20 shrink-0 rounded-sm bg-muted" aria-hidden>
                            <span
                              className="block h-2 rounded-sm bg-primary"
                              style={{
                                width: `${(Math.max(0, h.toPar) / maxOver) * 100}%`,
                              }}
                            />
                          </span>
                          {signed(h.toPar)}
                        </span>
                      )}
                    </td>
                    <td className="text-center">{h.rank ?? '–'}</td>
                    <td className="hidden text-right sm:table-cell">{pct(h.mix.birdie)}</td>
                    <td className="hidden text-right sm:table-cell">{pct(h.mix.par)}</td>
                    <td className="hidden text-right sm:table-cell">{pct(h.mix.bogey)}</td>
                    <td className="hidden text-right sm:table-cell">{pct(h.mix.double)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
