import { allocateStrokes, gridBox, type CardGrid, type Layout } from '@teemate/shared';
import { Download, Share2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { CourseCard } from '@/components/CourseCard';
import { Button } from '@/components/ui/button';
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

export interface VirtualScorecardProps {
  course: { name: string; city: string | null; state: string | null } | null;
  layout: { name: string; tees?: string; holes: HoleInfo[] };
  title: string;
  date: string;
  rows: VirtualRow[];
  matches: VirtualMatch[];
  footer?: ReactNode;
  /** The course's own card, when a site admin has marked where the scores go. */
  courseCard?: { src: string; grid: CardGrid; width: number; height: number } | null;
}

/**
 * The virtual scorecard: the round drawn as a classic paper card (yardage, par and handicap
 * rows, scores circled and boxed in pen, stroke dots), from the course's own data. It always
 * looks like paper, in dark mode too, because it's a picture of a card. It can be shared or
 * saved as an image.
 */
export function VirtualScorecard(props: VirtualScorecardProps) {
  const shot = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState<'course' | 'drawn'>(props.courseCard ? 'course' : 'drawn');
  const courseCard = look === 'course' ? props.courseCard : null;
  const [busy, setBusy] = useState(false);
  /** Made, but the phone wanted a fresh tap before sharing it. */
  const [ready, setReady] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileName = `${[props.course?.name, props.title, props.date]
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')}.png`;
  const canShare = typeof navigator.canShare === 'function';

  // Load the image maker ahead, so the picture is ready while the tap still counts.
  useEffect(() => {
    void import('html-to-image').catch(() => {});
  }, []);

  const send = async (file: File) => {
    try {
      await shareOrSave(file, props.title);
      setReady(null);
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'NotAllowedError') setReady(file);
      else if (name !== 'AbortError') setError(`Couldn't share it: ${(err as Error).message}`);
    }
  };

  const make = async () => {
    setError(null);
    setBusy(true);
    try {
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(shot.current!, { pixelRatio: 2, backgroundColor: '#ffffff' });
      if (!blob) throw new Error("couldn't draw the card");
      await send(new File([blob], fileName, { type: 'image/png' }));
    } catch (err) {
      setError(`Couldn't make the image: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {props.courseCard && (
        <div
          role="radiogroup"
          aria-label="Card"
          className="inline-flex w-fit rounded-lg border bg-muted p-1 text-sm"
        >
          {(
            [
              ['course', 'Course card'],
              ['drawn', 'Drawn card'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={look === k}
              onClick={() => setLook(k)}
              className={cn(
                'rounded-md px-3 py-1 text-muted-foreground',
                look === k && 'bg-card text-foreground shadow-xs',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <figure aria-label={`${props.title} card`} className="m-0">
        {courseCard ? (
          <OnCourseCard {...props} courseCard={courseCard} />
        ) : (
          <PaperCard {...props} />
        )}
      </figure>
      <div className="flex flex-wrap items-center gap-2">
        {ready ? (
          <Button size="sm" onClick={() => void send(ready)}>
            <Share2 /> Image ready: share it
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void make()}>
            {canShare ? <Share2 /> : <Download />}
            {busy ? 'Making image…' : canShare ? 'Share image' : 'Save image'}
          </Button>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
      {/* The picture is taken from this full-width copy, so nothing is cut off. */}
      <div aria-hidden className="pointer-events-none fixed -left-[10000px] top-0" inert>
        {courseCard ? (
          <OnCourseCard {...props} courseCard={courseCard} wide ref={shot} />
        ) : (
          <PaperCard {...props} wide ref={shot} />
        )}
      </div>
    </div>
  );
}

/** Shares the image where the device can (phones), otherwise downloads it. */
async function shareOrSave(file: File, title: string) {
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The part of the card worth showing: from a few lines above the first player line (the
 * hole numbers, tees and par) to a few below the last, leaving out the ads.
 */
function cropAround(grid: CardGrid, aspect: number): [top: number, bottom: number] {
  const ys = grid.rows.map((p) => p[1]);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
  const line = Math.max(0.02 / aspect, Math.min(...gaps.filter((g) => g > 0), 0.1));
  return [Math.max(0, Math.min(...ys) - 6 * line), Math.min(1, Math.max(...ys) + 4.5 * line)];
}

/** The round written on the course's own card, with the results underneath. */
function OnCourseCard({
  courseCard,
  course,
  title,
  date,
  layout,
  rows,
  matches,
  footer,
  wide = false,
  ref,
}: VirtualScorecardProps & {
  courseCard: NonNullable<VirtualScorecardProps['courseCard']>;
  wide?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const { grid, width, height } = courseCard;
  // Wide enough that a box is about a fingertip (22 px) on screen, a little more in the image.
  const box = gridBox(grid, layout.holes.length, height / width);
  const readable = (px: number, least: number) =>
    Math.round(Math.min(2400, Math.max(least, px / box)));
  // On a phone the card is shown at a readable size, scrolled to where the scores are.
  useEffect(() => {
    const el = scroller.current;
    if (!el || wide) return;
    const left = Math.min(grid.rows[0]![0], grid.name?.[0] ?? 1) - 0.02;
    el.scrollLeft = Math.max(0, left * el.scrollWidth);
  }, [grid, wide]);
  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg border-2 text-[color:var(--vc-ink)] shadow-sm"
      style={{ ...PAPER, ...(wide ? { width: readable(30, 1000) } : {}) }}
    >
      <CardTop course={course} title={title} date={date} />
      <div ref={scroller} className={wide ? '' : 'overflow-x-auto'}>
        <div style={wide ? undefined : { minWidth: readable(22, 760) }}>
          <CourseCard
            {...courseCard}
            crop={cropAround(grid, height / width)}
            pars={layout.holes.map((h) => h.par)}
            lines={rows.map((r) => ({
              name: r.name,
              holeScores: r.holeScores,
              absent: r.attendance === 'absent',
            }))}
          />
        </div>
      </div>
      <CardFooter matches={matches} footer={footer} />
    </div>
  );
}

function CardTop({
  course,
  title,
  date,
}: Pick<VirtualScorecardProps, 'course' | 'title' | 'date'>) {
  const where = [course?.city, course?.state].filter(Boolean).join(', ');
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 bg-[color:var(--vc-band)] px-3 py-2 font-serif text-[color:var(--vc-paper)]">
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
  );
}

function CardFooter({ matches, footer }: { matches: VirtualMatch[]; footer?: ReactNode }) {
  return (
    <div className="font-serif">
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

function PaperCard({
  course,
  layout,
  title,
  date,
  rows,
  matches,
  footer,
  wide = false,
  ref,
}: VirtualScorecardProps & { wide?: boolean; ref?: Ref<HTMLDivElement> }) {
  const holes = layout.holes;
  const totalLabel = holes.length > 9 ? 'TOT' : holes[0]!.number > 9 ? 'IN' : 'OUT';
  const sum = (xs: (number | null | undefined)[]) =>
    xs.every((x) => x != null) ? xs.reduce<number>((t, x) => t + x!, 0) : null;
  const yards = sum(holes.map((h) => h.yards));

  return (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden rounded-lg border-2 font-serif text-[color:var(--vc-ink)] shadow-sm',
        wide && 'w-max min-w-[640px]',
      )}
      style={PAPER}
    >
      <CardTop course={course} title={title} date={date} />

      <div className={wide ? '' : 'overflow-x-auto'}>
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

      <CardFooter matches={matches} footer={footer} />
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
