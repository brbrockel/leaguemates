import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Save } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api, type CoverCrop } from '@/lib/api';
import { cn } from '@/lib/utils';

/** The banner's shape when a photo is framed. */
const WIDE = 16 / 9;
const MAX_ZOOM = 5;

/** A photo showing only `crop` (or all of it), at the crop's shape. */
export function CroppedPhoto({
  src,
  alt,
  width,
  height,
  crop,
  className,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  crop: CoverCrop | null;
  className?: string;
}) {
  if (!crop)
    return (
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={cn('h-auto w-full object-cover', className)}
      />
    );
  return (
    <div
      className={cn('relative w-full overflow-hidden', className)}
      style={{ aspectRatio: `${crop.w * width} / ${crop.h * height}` }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / crop.w}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }}
      />
    </div>
  );
}

/** Zoom and centre (in photo pixels) to the crop they show, kept inside the photo. */
function toCrop(width: number, height: number, zoom: number, cx: number, cy: number): CoverCrop {
  const [w0, h0] = width / height > WIDE ? [height * WIDE, height] : [width, width / WIDE];
  const w = w0 / zoom;
  const h = h0 / zoom;
  const x = Math.min(Math.max(cx - w / 2, 0), width - w);
  const y = Math.min(Math.max(cy - h / 2, 0), height - h);
  return { x: x / width, y: y / height, w: w / width, h: h / height };
}

/**
 * Admins frame the season photo: zoom in and drag (or use the arrow keys) so the people fill
 * the banner. The photo itself isn't changed.
 */
export function CoverCropEditor({
  leagueId,
  seasonId,
  photo,
  crop,
  onClose,
}: {
  leagueId: string;
  seasonId: string;
  photo: { id: string; src: string; width: number; height: number; alt: string };
  crop: CoverCrop | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { width, height } = photo;
  const [w0] = width / height > WIDE ? [height * WIDE] : [width];
  const [zoom, setZoom] = useState(crop ? Math.min(MAX_ZOOM, w0 / (crop.w * width)) : 1);
  const [centre, setCentre] = useState<[number, number]>(
    crop
      ? [(crop.x + crop.w / 2) * width, (crop.y + crop.h / 2) * height]
      : [width / 2, height / 2],
  );
  const shown = toCrop(width, height, zoom, centre[0], centre[1]);
  const drag = useRef<{ x: number; y: number; centre: [number, number] } | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const save = useMutation({
    mutationFn: (c: CoverCrop | null) =>
      api(`/leagues/${leagueId}/seasons/${seasonId}/cover`, {
        method: 'PUT',
        body: { photoId: photo.id, crop: c },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['season', seasonId] });
      onClose();
    },
  });

  /** Moves the view by a fraction of what's shown (dragging right shows more of the left). */
  const pan = (dx: number, dy: number, from: [number, number] = centre) => {
    const c = toCrop(
      width,
      height,
      zoom,
      from[0] - dx * shown.w * width,
      from[1] - dy * shown.h * height,
    );
    setCentre([(c.x + c.w / 2) * width, (c.y + c.h / 2) * height]);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, centre };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || !box?.width) return;
    pan((e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height, d.centre);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.05;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    pan(m[0], m[1]);
  };
  const zoomTo = (z: number) => setZoom(Math.min(MAX_ZOOM, Math.max(1, Math.round(z * 100) / 100)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Frame the season photo"
        description="Zoom in and drag the photo so the people fill the banner. The photo itself isn't changed."
        className="sm:max-w-3xl"
      >
        <div className="flex flex-col gap-3">
          <div
            ref={frame}
            role="application"
            aria-label="Photo framing: drag or use the arrow keys to move it"
            tabIndex={0}
            className="cursor-grab touch-none overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKeyDown}
          >
            <CroppedPhoto {...photo} crop={shown} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => zoomTo(zoom - 0.25)}
            >
              <Minus />
            </Button>
            <input
              type="range"
              aria-label="Zoom"
              min={1}
              max={MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(e) => zoomTo(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => zoomTo(zoom + 0.25)}
            >
              <Plus />
            </Button>
          </div>
          {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={save.isPending} onClick={() => save.mutate(shown)}>
              <Save /> Save
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
              Show the whole photo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
