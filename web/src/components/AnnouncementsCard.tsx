import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, type Announcement } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

const key = (leagueId: string) => ['announcements', leagueId];

/**
 * League notices. `compact` (Home) shows the latest few with a link to the rest;
 * the full card (League page) lets admins post, edit and delete. Nothing is emailed.
 */
export function AnnouncementsCard({
  leagueId,
  isAdmin = false,
  compact = false,
}: {
  leagueId: string;
  isAdmin?: boolean;
  compact?: boolean;
}) {
  const list = useQuery({
    queryKey: [...key(leagueId), compact ? 3 : 20],
    queryFn: () =>
      api<Announcement[]>(`/leagues/${leagueId}/announcements?limit=${compact ? 3 : 20}`),
  });
  const [posting, setPosting] = useState(false);
  const items = list.data ?? [];
  if (compact && items.length === 0) return null;
  const canEdit = isAdmin && !compact;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-primary" aria-hidden /> Announcements
          </CardTitle>
          {canEdit && <CardDescription>Shown in the app only. Nobody is emailed.</CardDescription>}
        </div>
        {canEdit && !posting && (
          <Button size="sm" onClick={() => setPosting(true)}>
            <Plus /> Post
          </Button>
        )}
        {compact && (
          <Link
            to={`/leagues/${leagueId}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            All
          </Link>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {posting && <AnnouncementForm leagueId={leagueId} onDone={() => setPosting(false)} />}
        {items.length === 0 && !posting && (
          <p className="text-sm text-muted-foreground">No announcements yet.</p>
        )}
        <ul className="divide-y">
          {items.map((a) => (
            <AnnouncementItem
              key={a.id}
              leagueId={leagueId}
              a={a}
              canEdit={canEdit}
              clamp={compact}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AnnouncementItem({
  leagueId,
  a,
  canEdit,
  clamp,
}: {
  leagueId: string;
  a: Announcement;
  canEdit: boolean;
  clamp: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/leagues/${leagueId}/announcements/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(leagueId) }),
  });

  if (editing)
    return (
      <li className="py-3">
        <AnnouncementForm leagueId={leagueId} existing={a} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className="flex gap-2 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-medium">
          {a.pinned && <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" />}
          {a.title}
        </div>
        {a.body && (
          <p
            className={cn(
              'mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground',
              clamp && 'line-clamp-3',
            )}
          >
            {a.body}
          </p>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          {[a.author, timeAgo(a.createdAt), a.updatedAt && 'edited'].filter(Boolean).join(' · ')}
        </div>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Edit ${a.title}`}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Delete ${a.title}`}
            disabled={remove.isPending}
            onClick={() => window.confirm(`Delete "${a.title}"?`) && remove.mutate()}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

function AnnouncementForm({
  leagueId,
  existing,
  onDone,
}: {
  leagueId: string;
  existing?: Announcement;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const save = useMutation({
    mutationFn: () =>
      api(`/leagues/${leagueId}/announcements${existing ? `/${existing.id}` : ''}`, {
        method: existing ? 'PATCH' : 'POST',
        body: { title, body, pinned },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: key(leagueId) });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const id = existing?.id ?? 'new';
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={`a-title-${id}`}>Title</Label>
      <Input
        id={`a-title-${id}`}
        required
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="No golf tonight: course closed"
      />
      <Label htmlFor={`a-body-${id}`}>Details</Label>
      <textarea
        id={`a-body-${id}`}
        rows={4}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-lg border bg-card px-3 py-2 text-base shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        Pin to the top
      </label>
      {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || !title.trim()}>
          <Check /> {existing ? 'Save' : 'Post'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
