import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, ChevronLeft, ChevronRight, ImageIcon, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useIsGuest, useMe } from '@/auth/session';
import { api, type PhotoView } from '@/lib/api';
import { formatDay, timeAgo } from '@/lib/time';

const src = (leagueId: string, id: string, size: 'full' | 'thumb') =>
  `/api/leagues/${leagueId}/photos/${id}/${size}`;

/** Photos for a league, or one foursome's photos with `groupId`. Members only. */
export function PhotosCard({
  leagueId,
  groupId,
  seasonId,
  coverPhotoId,
  kind = 'photo',
  title = 'Photos',
  showMatch = false,
}: {
  leagueId: string;
  groupId?: string;
  /** A season's page: its team photos and match photos; uploads become season photos. */
  seasonId?: string;
  /** The season's chosen photo, to mark it in the viewer. */
  coverPhotoId?: string | null;
  /** 'card': photos of paper scorecards (taken from each scorecard's Scan button). */
  kind?: 'photo' | 'card';
  title?: string;
  showMatch?: boolean;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.leagues.find((l) => l.id === leagueId)?.role === 'admin';
  const setCover = useMutation({
    mutationFn: ({ season, photoId }: { season: string; photoId: string }) =>
      api(`/leagues/${leagueId}/seasons/${season}/cover`, { method: 'PUT', body: { photoId } }),
    onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['season', v.season] }),
  });
  const filter =
    (groupId ? `?groupId=${groupId}` : seasonId ? `?seasonId=${seasonId}` : '') +
    (kind === 'card' ? `${groupId || seasonId ? '&' : '?'}kind=card` : '');
  const key = ['photos', leagueId, filter || 'all'];
  // Photos show people, so guests don't see them.
  const guest = me?.user.isGuest ?? false;
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<PhotoView[]>(`/leagues/${leagueId}/photos${filter}`),
    enabled: !guest,
  });
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const body = new FormData();
        body.append('file', f);
        if (groupId) body.append('groupId', groupId);
        else if (seasonId) body.append('seasonId', seasonId);
        await api(`/leagues/${leagueId}/photos`, { method: 'POST', body });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['photos', leagueId] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/leagues/${leagueId}/photos/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setViewing(null);
      await qc.invalidateQueries({ queryKey: ['photos', leagueId] });
    },
  });

  const items = q.data ?? [];
  const current = viewing === null ? null : items[viewing];
  if (guest) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Camera className="size-5 text-primary" aria-hidden /> {title}
          </CardTitle>
          <CardDescription>
            {kind === 'card'
              ? 'Photos of the paper cards, from each scorecard’s Scan button. Kept for checking scores.'
              : 'Only league members can see these.'}
            {kind === 'photo' &&
              isAdmin &&
              seasonId &&
              ' Open a photo and choose Set as season photo to put it at the top.'}
          </CardDescription>
        </div>
        {kind === 'photo' && (
          <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <Camera /> {upload.isPending ? 'Uploading…' : 'Add photos'}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) upload.mutate(files);
          }}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {upload.isError && <Alert variant="destructive">{upload.error.message}</Alert>}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="block aspect-square w-full overflow-hidden rounded-md bg-muted"
                  onClick={() => setViewing(i)}
                  aria-label={p.caption ?? `Photo ${i + 1}`}
                >
                  <img
                    src={src(leagueId, p.id, 'thumb')}
                    alt={p.caption ?? ''}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setViewing(null);
            if (e.key === 'ArrowLeft') setViewing(Math.max(0, viewing! - 1));
            if (e.key === 'ArrowRight') setViewing(Math.min(items.length - 1, viewing! + 1));
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="min-w-0 flex-1 text-sm">
              {current.caption && <div className="truncate font-medium">{current.caption}</div>}
              <div className="text-xs text-white/70">
                {[current.uploader, timeAgo(current.createdAt)].filter(Boolean).join(' · ')}
                {showMatch && current.teamPhoto && current.seasonId && (
                  <>
                    {' · '}
                    <Link
                      className="underline"
                      to={`/leagues/${leagueId}/seasons/${current.seasonId}`}
                    >
                      {current.seasonName} season
                    </Link>
                  </>
                )}
                {showMatch &&
                  current.date &&
                  current.seasonId &&
                  current.weekId &&
                  current.groupId && (
                    <>
                      {' · '}
                      <Link
                        className="underline"
                        to={`/leagues/${leagueId}/seasons/${current.seasonId}/weeks/${current.weekId}/groups/${current.groupId}`}
                      >
                        {formatDay(current.date, true)} card
                      </Link>
                    </>
                  )}
              </div>
            </div>
            {kind === 'photo' &&
              isAdmin &&
              (seasonId ?? current.seasonId) &&
              (current.id === coverPhotoId ||
              (setCover.isSuccess && setCover.variables?.photoId === current.id) ? (
                <span className="flex items-center gap-1 text-xs text-white/80">
                  <Check className="size-4" /> Season photo
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white hover:bg-white/10 hover:text-white"
                  disabled={setCover.isPending}
                  onClick={() =>
                    setCover.mutate({
                      season: (seasonId ?? current.seasonId)!,
                      photoId: current.id,
                    })
                  }
                >
                  <ImageIcon />
                  {seasonId || !current.seasonName
                    ? 'Set as season photo'
                    : `Set as ${current.seasonName} photo`}
                </Button>
              ))}
            {current.canDelete && (
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                aria-label="Delete photo"
                disabled={remove.isPending}
                onClick={() => window.confirm('Delete this photo?') && remove.mutate(current.id)}
              >
                <Trash2 />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              aria-label="Close"
              onClick={() => setViewing(null)}
            >
              <X />
            </Button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
            <img
              src={src(leagueId, current.id, 'full')}
              alt={current.caption ?? ''}
              className="max-h-full max-w-full object-contain"
            />
            {viewing! > 0 && (
              <button
                type="button"
                aria-label="Previous photo"
                className="absolute left-2 rounded-full bg-black/50 p-2"
                onClick={() => setViewing(viewing! - 1)}
              >
                <ChevronLeft />
              </button>
            )}
            {viewing! < items.length - 1 && (
              <button
                type="button"
                aria-label="Next photo"
                className="absolute right-2 rounded-full bg-black/50 p-2"
                onClick={() => setViewing(viewing! + 1)}
              >
                <ChevronRight />
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** The season's photo across the top of its page: the one an admin chose, else the newest team photo. */
export function SeasonBanner({
  leagueId,
  seasonId,
  coverPhotoId,
}: {
  leagueId: string;
  seasonId: string;
  coverPhotoId?: string | null;
}) {
  const guest = useIsGuest();
  const q = useQuery({
    queryKey: ['photos', leagueId, `?seasonId=${seasonId}`],
    queryFn: () => api<PhotoView[]>(`/leagues/${leagueId}/photos?seasonId=${seasonId}`),
    enabled: !guest,
  });
  // The chosen photo, else the newest team photo.
  const team =
    (coverPhotoId &&
      (q.data?.find((p) => p.id === coverPhotoId) ?? {
        id: coverPhotoId,
        caption: null,
        width: undefined,
        height: undefined,
      })) ||
    q.data?.find((p) => p.teamPhoto);
  if (!team || guest) return null;
  return (
    <figure className="overflow-hidden rounded-xl border bg-muted">
      <img
        src={src(leagueId, team.id, 'full')}
        alt={team.caption ?? 'Team photo'}
        width={team.width}
        height={team.height}
        className="h-auto max-h-[60vh] w-full object-cover"
      />
      {team.caption && (
        <figcaption className="px-4 py-2 text-sm text-muted-foreground">{team.caption}</figcaption>
      )}
    </figure>
  );
}
