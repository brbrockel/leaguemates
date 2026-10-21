import { allocateStrokes, type Layout } from '@teemate/shared';
import type { CSSProperties, ReactNode } from 'react';
import type { HoleInfo, MatchResultView } from '@/lib/api';
import { formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';

/** One player's line on the card. */
export interface VirtualRow {
  playerId: string;
  name: string;
  handicap: number | null;
  attendance: 'played' | 'absent';
  subName: string;
  holeScores: (number | null)[];
  /** Strokes from their match: dotted on the hardest holes, as players mark a paper card. */
  strokes: number | null;
  /** Match net, when the match has a result. */
  net: number | null;
}

export interface VirtualMatch {
  a: string;
  b: string;
  result: MatchResultView | null;
}

/**
 * The virtual scorecard: the round drawn as a classic paper card (yardage, par and handicap
 * rows, scores circled and boxed in pen, stroke dots), from the course's own data. It always
 * looks like paper, in dark mode too, because it's a picture of a card.
 */
export function VirtualScorecard({
  course,
  layout,
  title,
  date,
  rows,
  matches,
  footer,
}: {
  course: { name: string; city: string | null; state: string | null } | null;
  layout: { name: string; tees?: string; holes: HoleInfo[] };
  title: string;
  date: string;
  rows: VirtualRow[];
  matches: VirtualMatch[];
  footer?: ReactNode;
}) {
  const holes = layout.holes;
  const totalLabel = holes.length > 9 ? 'TOT' : holes[0]!.number > 9 ? 'IN' : 'OUT';
  const sum = (xs: (number | null | undefined)[]) =>
    xs.every((x) => x != null) ? xs.reduce<number>((t, x) => t + x!, 0) : null;
  const yards = sum(holes.map((h) => h.yards));
  const where = [course?.city, course?.state].filter(Boolean).join(', ');

  return (
    <div
      className="overflow-hidden rounded-lg border-2 font-serif text-[color:var(--vc-ink)] shadow-sm"
      style={PAPER}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 bg-[color:var(--vc-band)] px-3 py-2 text-[color:var(--vc-paper)]">
        <div>
          <div className="text-base font-bold uppercase tracking-[0.18em]">
            {course?.name ?? 'Scorecard'}
          </div>
          {where && <div className="text-[11px] tracking-wider opacity-80">{where}</div>}
        </div>
        <div className="text-xs sm:text-right">
          <div className="font-semibold">{title}</div>
          <div className="opacity-80">{formatDay(date, true)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-xs tabular-nums sm:text-sm">
          <thead>
            <tr className="bg-[color:var(--vc-band)] text-[color:var(--vc-paper)]">
              <Head>HOLE</Head>
              {holes.map((h) => (
                <th key={h.number} className={cell}>
                  {h.number}
                </th>
              ))}
              <th className={cell}>{totalLabel}</th>
              <th className={cell}>HCP</th>
              <th className={cell}>NET</th>
            </tr>
            {holes.some((h) => h.yards != null) && (
              <tr className="bg-[color:var(--vc-tee)]">
                <Head>{(layout.tees ?? 'Yards').toUpperCase()}</Head>
                {holes.map((h) => (
                  <td key={h.number} className={cell}>
                    {h.yards ?? ''}
                  </td>
                ))}
                <td className={cell}>{yards ?? ''}</td>
                <td className={cell} colSpan={2} />
              </tr>
            )}
            <tr className="bg-[color:var(--vc-paper)] font-semibold">
              <Head>PAR</Head>
              {holes.map((h) => (
                <td key={h.number} className={cell}>
                  {h.par}
                </td>
              ))}
              <td className={cell}>{sum(holes.map((h) => h.par))}</td>
              <td className={cell} colSpan={2} />
            </tr>
            <tr className="bg-[color:var(--vc-paper)] text-[11px] italic">
              <Head>HANDICAP</Head>
              {holes.map((h) => (
                <td key={h.number} className={cell}>
                  {h.strokeIndex}
                </td>
              ))}
              <td className={cell} colSpan={3} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PlayerRow key={r.playerId} row={r} holes={holes} />
            ))}
          </tbody>
        </table>
      </div>

      {matches.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t-2 border-[color:var(--vc-rule)] px-3 py-2 text-sm">
          {matches.map((m, i) => (
            <li key={i}>
              <MatchSummary match={m} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[color:var(--vc-rule)] px-3 py-1.5 text-[11px]">
        <Legend />
        {footer && <span className="italic">{footer}</span>}
      </div>
    </div>
  );
}

const PAPER = {
  '--vc-paper': '#fbf8ef',
  '--vc-ink': '#1f2a24',
  '--vc-pen': '#1d3f8f',
  '--vc-band': '#1f5130',
  '--vc-tee': '#eef0e6',
  '--vc-rule': '#c9c2ad',
  background: 'var(--vc-paper)',
  borderColor: 'var(--vc-band)',
} as CSSProperties;

const cell = 'border border-[color:var(--vc-rule)] px-0.5 py-1 min-w-7 sm:min-w-8';

function Head({ children }: { children: ReactNode }) {
  return (
    <th
      scope="row"
      className="sticky left-0 z-10 border border-[color:var(--vc-rule)] px-2 py-1 text-left text-[11px] font-bold tracking-wider"
      style={{ background: 'inherit' }}
    >
      {children}
    </th>
  );
}

function PlayerRow({ row, holes }: { row: VirtualRow; holes: HoleInfo[] }) {
  const dots =
    row.strokes && row.attendance === 'played'
      ? allocateStrokes(row.strokes, { holes } as Layout)
      : holes.map(() => 0);
  const gross =
    row.attendance === 'played' && row.holeScores.some((s) => s !== null)
      ? row.holeScores.reduce<number>((t, s) => t + (s ?? 0), 0)
      : null;
  return (
    <tr className="h-10 sm:h-11">
      <th
        scope="row"
        className="sticky left-0 z-10 max-w-24 truncate border border-[color:var(--vc-rule)] px-2 text-left font-semibold"
        style={{ background: 'var(--vc-paper)' }}
      >
        {row.name}
        {row.attendance === 'absent' && (
          <span className="block text-[10px] font-normal italic">
            absent{row.subName ? ` · sub ${row.subName}` : ''}
          </span>
        )}
      </th>
      {holes.map((h, i) => (
        <td key={h.number} className={cn(cell, 'relative')}>
          {dots[i]! > 0 && (
            <span
              className="absolute right-0.5 top-0.5 flex gap-px"
              aria-label={`${dots[i]} stroke${dots[i] === 1 ? '' : 's'}`}
            >
              {Array.from({ length: dots[i]! }, (_, k) => (
                <span key={k} className="size-1 rounded-full bg-[color:var(--vc-ink)]" />
              ))}
            </span>
          )}
          {row.attendance === 'absent' ? (
            <span aria-hidden>–</span>
          ) : (
            <Mark score={row.holeScores[i] ?? null} par={h.par} />
          )}
        </td>
      ))}
      <td className={cn(cell, 'font-bold text-[color:var(--vc-pen)]')}>{gross ?? ''}</td>
      <td className={cell}>{row.handicap ?? ''}</td>
      <td className={cn(cell, 'font-bold text-[color:var(--vc-pen)]')}>{row.net ?? ''}</td>
    </tr>
  );
}

/** A score in pen: circled under par, boxed over, doubled for two or more. */
export function Mark({ score, par }: { score: number | null; par: number }) {
  if (score === null) return null;
  const diff = score - par;
  const label =
    diff <= -2
      ? 'eagle or better'
      : diff === -1
        ? 'birdie'
        : diff === 1
          ? 'bogey'
          : diff >= 2
            ? 'double bogey or worse'
            : 'par';
  return (
    <span
      title={label}
      data-mark={label}
      className={cn(
        'inline-flex size-6 items-center justify-center text-[15px] font-bold text-[color:var(--vc-pen)] sm:size-7',
        diff < 0 && 'rounded-full border-[1.5px] border-[color:var(--vc-pen)]',
        diff > 0 && 'border-[1.5px] border-[color:var(--vc-pen)]',
      )}
      style={
        diff <= -2 || diff >= 2
          ? { boxShadow: '0 0 0 2px var(--vc-paper), 0 0 0 3.5px var(--vc-pen)' }
          : undefined
      }
    >
      {score}
    </span>
  );
}

function MatchSummary({ match: { a, b, result } }: { match: VirtualMatch }) {
  if (!result)
    return (
      <span>
        {a} v {b} <span className="italic opacity-70">· not finished</span>
      </span>
    );
  const net = (v: number | null) => (v === null ? 'absent' : v);
  const strokes = result.strokes.A
    ? `${a} gets ${result.strokes.A}`
    : result.strokes.B
      ? `${b} gets ${result.strokes.B}`
      : 'no strokes';
  const verdict = result.outcome === 'T' ? 'Halved' : `${result.outcome === 'A' ? a : b} wins`;
  return (
    <span>
      {a} <span className="font-bold text-[color:var(--vc-pen)]">{net(result.net.A)}</span> v {b}{' '}
      <span className="font-bold text-[color:var(--vc-pen)]">{net(result.net.B)}</span>
      {' · '}
      <span className="font-semibold">{verdict}</span>
      <span className="italic opacity-70"> · {strokes}</span>
    </span>
  );
}

function Legend() {
  const swatch = (diff: number) => <Mark score={4 + diff} par={4} />;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-hidden>
      <span className="flex items-center gap-1">{swatch(-1)} birdie</span>
      <span className="flex items-center gap-1">{swatch(1)} bogey</span>
      <span className="flex items-center gap-1">{swatch(2)} double+</span>
      <span className="flex items-center gap-1">
        <span className="size-1 rounded-full bg-[color:var(--vc-ink)]" /> stroke
      </span>
    </span>
  );
}
