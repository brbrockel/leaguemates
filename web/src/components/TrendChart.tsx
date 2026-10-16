import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface TrendRound {
  date: string;
  season: string;
  gross: number;
  /** Match net, as on the league's sheets: gross less the strokes received that week. */
  net: number | null;
}

const WINDOW = 5;
const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 34 };

/**
 * A player's nine-hole scores round by round, oldest first: each round as a dot and the
 * average of the last five as a line. Gross or net (match net, as on the league's sheets).
 */
export function TrendChart({ rounds }: { rounds: TrendRound[] }) {
  const [measure, setMeasure] = useState<'gross' | 'net'>('gross');
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const points = useMemo(() => {
    const values = rounds
      .map((r) => ({
        ...r,
        value: measure === 'gross' ? r.gross : r.net,
      }))
      .filter((r): r is TrendRound & { value: number } => r.value !== null);
    return values.map((r, i) => {
      const last = values.slice(Math.max(0, i - WINDOW + 1), i + 1);
      return { ...r, avg: last.reduce((a, x) => a + x.value, 0) / last.length };
    });
  }, [rounds, measure]);

  if (points.length < 3) return null;

  const values = points.flatMap((p) => [p.value, p.avg]);
  const lo = Math.floor(Math.min(...values) / 2) * 2 - 1;
  const hi = Math.ceil(Math.max(...values) / 2) * 2 + 1;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const step = Math.max(2, Math.ceil((hi - lo) / 4 / 2) * 2);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  // A label where each season starts.
  const seasonStarts = points
    .map((p, i) => ({ i, season: p.season }))
    .filter((p, i, all) => i === 0 || all[i - 1]!.season !== p.season);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.avg)}`).join(' ');

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const h = hover === null ? null : points[hover]!;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden>
              <circle cx="5" cy="5" r="4" fill="var(--primary)" opacity="0.45" />
            </svg>
            Each round
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="10" aria-hidden>
              <line x1="0" y1="5" x2="16" y2="5" stroke="var(--primary)" strokeWidth="2" />
            </svg>
            Average of the last {WINDOW}
          </span>
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Score shown">
          {(['gross', 'net'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={measure === m}
              onClick={() => setMeasure(m)}
              className={cn(
                'rounded px-2 py-0.5 capitalize',
                measure === m ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          role="img"
          aria-label={`${measure === 'gross' ? 'Gross' : 'Net'} scores over ${points.length} rounds`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {t}
              </text>
            </g>
          ))}
          {seasonStarts.map((s) => (
            <text
              key={s.i}
              x={x(s.i)}
              y={H - 8}
              textAnchor={s.i === 0 ? 'start' : 'middle'}
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {s.season}
            </text>
          ))}
          {h && (
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--muted-foreground)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(p.value)}
              r={hover === i ? 5 : 4}
              fill="var(--primary)"
              opacity={hover === i ? 0.9 : 0.45}
              stroke={hover === i ? 'var(--card)' : 'none'}
              strokeWidth="2"
            />
          ))}
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs shadow-md"
            style={{
              left: `${(x(hover!) / W) * 100}%`,
              transform: `translateX(${hover! > points.length / 2 ? '-105%' : '5%'})`,
            }}
          >
            <div className="font-medium">
              {formatDay(h.date, true)} · {h.season}
            </div>
            <div>
              {measure === 'gross' ? 'Gross' : 'Net'} {h.value}
            </div>
            <div className="text-muted-foreground">
              Average of last {WINDOW}: {h.avg.toFixed(1)}
            </div>
          </div>
        )}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium">Date</th>
              <th className="text-right font-medium">{measure === 'gross' ? 'Gross' : 'Net'}</th>
              <th className="text-right font-medium">Avg of last {WINDOW}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p, i) => (
              <tr key={i} className="border-t">
                <td>{formatDay(p.date, true)}</td>
                <td className="text-right">{p.value}</td>
                <td className="text-right">{p.avg.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
