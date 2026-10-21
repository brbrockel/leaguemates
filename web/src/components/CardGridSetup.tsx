import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CARD_GRID_MAX_ROWS, type CardGrid, type GridPoint } from '@teemate/shared';
import { Minus, Plus, RotateCcw, Save, SkipForward, Trash2, Undo2 } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api, type Course, type CourseLayout } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CourseCard, cardImageSrc } from './CourseCard';

const COURSES_KEY = ['courses'];

/** The taps, in order. Each fills one part of the grid; some can be skipped. */
type Step = {
  key: 'row' | 'last' | 'total' | 'name';
  row?: number;
  prompt: string;
  optional: boolean;
};

function stepsFor(layout: CourseLayout): Step[] {
  const first = layout.holes[0]!.number;
  const last = layout.holes[layout.holes.length - 1]!.number;
  const total = layout.holes.length > 9 ? 'Total' : first > 9 ? 'In' : 'Out';
  const line = (row: number): Step => ({
    key: 'row',
    row,
    prompt: `Tap the hole ${first} box on player line ${row + 1}${row === 1 ? '' : ' (skip if the lines below are evenly spaced)'}.`,
    optional: row > 1,
  });
  return [
    {
      key: 'row',
      row: 0,
      prompt: `Tap the hole ${first} box on the first player's line.`,
      optional: false,
    },
    { key: 'last', prompt: `Tap the hole ${last} box on the same line.`, optional: false },
    { key: 'total', prompt: `Tap the ${total} box on the same line.`, optional: true },
    {
      key: 'name',
      prompt:
        "Tap where the first player's name is written. No name column, because this panel folds over another nine's card? Choose that card, or Skip.",
      optional: true,
    },
    line(1),
    line(2),
    line(3),
  ];
}

interface Draft {
  rows: GridPoint[];
  last: GridPoint | null;
  total: GridPoint | null;
  name: GridPoint | null;
  /** Fold-over panel: the nine whose card's name column is used. */
  nameFrom: string | null;
  /** Steps answered so far (a skip counts; a saved grid is all done). */
  done: number;
}

const empty: Draft = { rows: [], last: null, total: null, name: null, nameFrom: null, done: 0 };
const fromGrid = (g: CardGrid): Draft => ({ ...g, nameFrom: g.nameFrom ?? null, done: Infinity });
const SAMPLE = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

/**
 * Site admins mark where a nine's scores go on a picture of the course's card: a few taps,
 * then a preview with sample scores before saving.
 */
export function CardGridSetup({
  course,
  layout,
  onClose,
}: {
  course: Course;
  layout: CourseLayout;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [imageId, setImageId] = useState(layout.cardGrid?.imageId ?? course.images[0]!.id);
  const [draft, setDraft] = useState<Draft>(
    layout.cardGrid ? fromGrid(layout.cardGrid.grid) : empty,
  );
  /** Earlier states, for Undo. */
  const [history, setHistory] = useState<Draft[]>([]);
  const [zoom, setZoom] = useState(1);
  const image = course.images.find((i) => i.id === imageId)!;
  const steps = stepsFor(layout);
  const step = draft.done < steps.length ? steps[draft.done]! : null;
  const grid: CardGrid | null =
    draft.rows.length >= 2 && draft.last
      ? {
          rows: draft.rows.slice(0, CARD_GRID_MAX_ROWS),
          last: draft.last,
          total: draft.total,
          name: draft.name,
          ...(draft.nameFrom ? { nameFrom: draft.nameFrom } : {}),
        }
      : null;
  // Nines whose card has a name column this one can fold over.
  const lenders = course.layouts.filter(
    (l) => l.id !== layout.id && !l.retiredAt && l.cardGrid?.grid.name && !l.cardGrid.grid.nameFrom,
  );
  const lender = course.layouts.find((l) => l.id === draft.nameFrom);
  const lenderImage = course.images.find((i) => i.id === lender?.cardGrid?.imageId);
  const names =
    lender?.cardGrid && lenderImage
      ? {
          src: cardImageSrc(course.id, lenderImage.id),
          width: lenderImage.width,
          height: lenderImage.height,
          grid: lender.cardGrid.grid,
          holes: lender.holes.length,
        }
      : null;
  const pars = layout.holes.map((h) => h.par);

  const done = (c: Course) => {
    qc.setQueryData<Course[]>(COURSES_KEY, (cs) => cs?.map((x) => (x.id === c.id ? c : x)));
    onClose();
  };
  const path = `/courses/${course.id}/layouts/${layout.id}/card-grid`;
  const save = useMutation({
    mutationFn: () => api<Course>(path, { method: 'PUT', body: { imageId, grid } }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api<Course>(path, { method: 'DELETE' }),
    onSuccess: done,
  });

  const answer = (p: GridPoint | null) => {
    if (!step) return;
    setHistory((h) => [...h, draft]);
    setDraft((d) => {
      const next = { ...d, done: d.done + 1 };
      if (step.key === 'row') {
        // A skipped line ends the taps: the rest continue the last spacing.
        if (!p) return { ...next, done: steps.length };
        next.rows = [...d.rows, p];
      } else next[step.key] = p;
      return next;
    });
  };
  /** Fold-over: names are written in another nine's name column. */
  const borrowNames = (from: string) => {
    setHistory((h) => [...h, draft]);
    setDraft((d) => ({ ...d, name: null, nameFrom: from, done: d.done + 1 }));
  };
  const tap = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    answer([clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]);
  };
  const undo = () => {
    setDraft(history[history.length - 1] ?? empty);
    setHistory((h) => h.slice(0, -1));
  };
  const restart = () => {
    setDraft(empty);
    setHistory([]);
  };

  const marks: { p: GridPoint; label: string }[] = [
    ...draft.rows.map((p, i) => ({ p, label: `${i + 1}` })),
    ...(draft.last ? [{ p: draft.last, label: '→' }] : []),
    ...(draft.total ? [{ p: draft.total, label: 'Σ' }] : []),
    ...(draft.name ? [{ p: draft.name, label: 'A' }] : []),
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Course card: ${layout.name}`}
        description="Mark where scores go on the club's card, so the virtual scorecard can write them on it."
        className="sm:max-w-5xl"
      >
        <div className="flex flex-col gap-3">
          {course.images.length > 1 && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Card picture">
              {course.images.map((img, i) => (
                <button
                  key={img.id}
                  role="radio"
                  aria-checked={img.id === imageId}
                  aria-label={img.caption ?? `Picture ${i + 1}`}
                  onClick={() => {
                    setImageId(img.id);
                    restart();
                  }}
                  className={cn(
                    'overflow-hidden rounded-md border-2',
                    img.id === imageId ? 'border-primary' : 'border-transparent opacity-70',
                  )}
                >
                  <img src={cardImageSrc(course.id, img.id)} alt="" className="h-14 w-auto" />
                </button>
              ))}
            </div>
          )}

          <p className="min-h-10 text-sm font-medium" aria-live="polite">
            {step
              ? step.prompt
              : grid
                ? 'Check the sample scores sit in the boxes, then save.'
                : 'Mark at least two player lines.'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={undo} disabled={history.length === 0}>
              <Undo2 /> Undo
            </Button>
            {step?.optional && (
              <Button variant="outline" size="sm" onClick={() => answer(null)}>
                <SkipForward /> Skip
              </Button>
            )}
            {step?.key === 'name' &&
              lenders.map((l) => (
                <Button key={l.id} variant="outline" size="sm" onClick={() => borrowNames(l.id)}>
                  Names are on the {l.name} card
                </Button>
              ))}
            <Button variant="outline" size="sm" onClick={restart}>
              <RotateCcw /> Start over
            </Button>
            <span className="ml-auto inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((z) => z - 1)}
              >
                <Minus />
              </Button>
              <span className="w-8 text-center text-xs tabular-nums">{zoom}×</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Zoom in"
                disabled={zoom >= 4}
                onClick={() => setZoom((z) => z + 1)}
              >
                <Plus />
              </Button>
            </span>
          </div>

          <div className="max-h-[60dvh] overflow-auto rounded-lg border">
            <div style={{ width: `${zoom * 100}%`, minWidth: 600 }}>
              <CourseCard
                src={cardImageSrc(course.id, image.id)}
                width={image.width}
                height={image.height}
                grid={step ? null : grid}
                names={step ? null : names}
                pars={pars}
                lines={
                  step || !grid
                    ? []
                    : SAMPLE.map((name, row) => ({
                        name,
                        holeScores: pars.map((p, i) => p + ((i + row) % 3 === 0 ? 1 : 0)),
                      }))
                }
              >
                {step && (
                  <div
                    data-testid="card-tap-area"
                    className="absolute inset-0 cursor-crosshair"
                    onClick={tap}
                  >
                    {marks.map((m, i) => (
                      <span
                        key={i}
                        className="absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white ring-2 ring-white"
                        style={{ left: `${m.p[0] * 100}%`, top: `${m.p[1] * 100}%` }}
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                )}
              </CourseCard>
            </div>
          </div>

          {(save.isError || remove.isError) && (
            <Alert variant="destructive">{(save.error ?? remove.error)!.message}</Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!grid || Boolean(step) || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save /> Save
            </Button>
            {layout.cardGrid && (
              <Button
                variant="ghost"
                disabled={remove.isPending}
                onClick={() =>
                  window.confirm(`Stop using the course card for ${layout.name}?`) &&
                  remove.mutate()
                }
              >
                <Trash2 /> Remove
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
