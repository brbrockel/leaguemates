import '@fontsource/caveat/700.css';
import {
  foldOver,
  gridBox,
  gridHole,
  gridOffset,
  type CardGrid,
  type GridPoint,
} from '@teemate/shared';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/** A line written on the card: a player's name and scores. */
export interface PenLine {
  name: string;
  holeScores: (number | null)[];
  absent?: boolean;
}

/** Blue ballpoint, in a handwriting face. */
const PEN = '#1d3f8f';

/**
 * The course's own printed card with the round written on it: names, scores (circled under
 * par, boxed over), and totals, at the boxes a site admin marked on the picture.
 */
export function CourseCard({
  src,
  width,
  height,
  grid,
  pars,
  lines,
  ref,
  className,
  crop,
  names,
  children,
}: {
  src: string;
  width: number;
  height: number;
  /** Nothing is written without one. */
  grid: CardGrid | null;
  pars: number[];
  lines: PenLine[];
  ref?: Ref<HTMLDivElement>;
  className?: string;
  /** Show only this band of the picture (fractions of its height). */
  crop?: [top: number, bottom: number];
  /**
   * Fold-over panels: another nine's card whose name column sits to the left, as when the
   * panel is folded over it. Names are written there.
   */
  names?: { src: string; width: number; height: number; grid: CardGrid; holes: number } | null;
  /** Drawn over the card, e.g. the marks while setting it up. */
  children?: ReactNode;
}) {
  const n = pars.length;
  // With a name column from another card, the picture is that strip and then this card.
  const fold = grid && names ? foldOver({ grid, width, height, holes: n }, names) : null;
  const full = width + (fold?.width ?? 0);
  /** A point on this card, as a fraction of the whole (strip included). */
  const own = ([x, y]: GridPoint): GridPoint => [((fold?.width ?? 0) + x * width) / full, y];
  // Writing fills about two thirds of a box; sizes are in container widths, so they scale.
  const box = grid ? ((gridBox(grid, n, height / width) * width) / full) * 100 : 0;
  const pen: CSSProperties = {
    color: PEN,
    fontFamily: "Caveat, 'Bradley Hand', 'Segoe Print', cursive",
    fontWeight: 700,
    fontSize: `${box * 0.85}cqw`,
    lineHeight: 1,
  };
  const at = ([x, y]: GridPoint, align: 'center' | 'left' = 'center'): CSSProperties => ({
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    transform: align === 'center' ? 'translate(-50%, -50%)' : 'translate(0, -50%)',
    whiteSpace: 'nowrap',
  });

  const card = (
    <div
      className="relative w-full select-none overflow-hidden bg-white"
      style={{ containerType: 'inline-size', aspectRatio: `${full} / ${height}` }}
    >
      {fold && names && (
        <div
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${(fold.width / full) * 100}%` }}
        >
          <img
            src={names.src}
            alt=""
            draggable={false}
            className="absolute left-0 max-w-none"
            style={{
              width: `${((names.width * fold.scale) / fold.width) * 100}%`,
              top: `${(fold.top / height) * 100}%`,
            }}
          />
        </div>
      )}
      <img
        src={src}
        alt=""
        width={width}
        height={height}
        draggable={false}
        className="absolute inset-y-0 right-0 h-full"
        style={{ width: `${(width / full) * 100}%` }}
      />
      <div style={pen} aria-hidden>
        {grid &&
          lines.map((line, row) => {
            const played = line.holeScores.filter((s): s is number => s !== null);
            return (
              <div key={row}>
                {(fold || grid.name) && (
                  <span
                    style={at(
                      fold
                        ? [fold.nameX / full, lineY(grid, row)]
                        : own(gridOffset(grid, row, grid.name!)),
                      'left',
                    )}
                  >
                    {line.name}
                    {line.absent && <span style={{ fontSize: '0.7em' }}> (absent)</span>}
                  </span>
                )}
                {!line.absent &&
                  pars.map((par, i) =>
                    line.holeScores[i] == null ? null : (
                      <span key={i} style={at(own(gridHole(grid, n, row, i)))}>
                        <PenMark score={line.holeScores[i]!} par={par} />
                      </span>
                    ),
                  )}
                {grid.total && !line.absent && played.length === n && (
                  <span style={at(own(gridOffset(grid, row, grid.total)))}>
                    {played.reduce((t, s) => t + s, 0)}
                  </span>
                )}
              </div>
            );
          })}
      </div>
      {children}
    </div>
  );
  const [top, bottom] = crop ?? [0, 1];
  return (
    <div
      ref={ref}
      className={cn('relative w-full overflow-hidden bg-white', className)}
      style={{ aspectRatio: `${full} / ${height * (bottom - top)}` }}
    >
      <div className="absolute inset-x-0" style={{ top: `${(-top / (bottom - top)) * 100}%` }}>
        {card}
      </div>
    </div>
  );
}

/** How far down player line `row` is (fraction of the card's height). */
const lineY = (grid: CardGrid, row: number) => gridHole(grid, 2, row, 0)[1];

/** A handwritten score: circled under par, boxed over, twice for two or more. */
function PenMark({ score, par }: { score: number; par: number }) {
  const diff = score - par;
  const ring = (round: boolean): CSSProperties => ({
    border: `0.07em solid ${PEN}`,
    borderRadius: round ? '50%' : '0.08em',
  });
  const double = (round: boolean): CSSProperties => ({
    ...ring(round),
    // A second ring with the card showing through between them.
    outline: `0.07em solid ${PEN}`,
    outlineOffset: '0.07em',
  });
  return (
    <span
      data-mark={diff < 0 ? 'under' : diff > 0 ? 'over' : 'par'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.05em',
        height: '1.05em',
        ...(diff <= -2 || diff >= 2 ? double(diff < 0) : diff !== 0 ? ring(diff < 0) : {}),
      }}
    >
      {score}
    </span>
  );
}

/** The card picture's address. */
export const cardImageSrc = (courseId: string, imageId: string) =>
  `/api/courses/${courseId}/images/${imageId}`;
