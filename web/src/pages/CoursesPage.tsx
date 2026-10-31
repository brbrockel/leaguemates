import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Lock,
  Pencil,
  Pin,
  Plus,
  Trash2,
  ScrollText,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMe } from '@/auth/session';
import { CardGridSetup } from '@/components/CardGridSetup';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PhotoPicker } from '@/components/PhotoPicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, ApiError, type Course, type CourseHole, type CourseLayout } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NotFoundPage } from './NotFoundPage';

const COURSES_KEY = ['courses'];

function useCourses() {
  return useQuery({ queryKey: COURSES_KEY, queryFn: () => api<Course[]>('/courses') });
}

/** Marks the pinned course: listed first and used for new seasons. */
function DefaultBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn('gap-1 bg-primary/15 text-primary', className)}
      title="Pinned to the top and used for new seasons"
    >
      <Pin className="size-3 fill-current" aria-hidden /> Default course
    </Badge>
  );
}

const place = (c: Course) => [c.city, c.state].filter(Boolean).join(', ');

/** Straight-line miles between two points. */
function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const SORT_KEY = 'leaguemates-course-sort';

export function CoursesPage() {
  const { data: me } = useMe();
  const courses = useCourses();
  const [sort, setSortState] = useState<'distance' | 'name'>(() => {
    try {
      return localStorage.getItem(SORT_KEY) === 'name' ? 'name' : 'distance';
    } catch {
      return 'distance';
    }
  });
  const setSort = (v: 'distance' | 'name') => {
    setSortState(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      // Remembering the choice is only a convenience.
    }
  };
  const home = courses.data?.find((c) => c.pinned);
  const away = (c: Course) =>
    home?.lat != null && home.lng != null && c.lat != null && c.lng != null
      ? miles({ lat: home.lat, lng: home.lng }, { lat: c.lat, lng: c.lng })
      : null;
  // The default course stays on top; the rest by distance from it (unknown last) or by name.
  const list = [...(courses.data ?? [])].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (sort === 'distance' ? (away(a) ?? 999) - (away(b) ?? 999) : 0) ||
      a.name.localeCompare(b.name),
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
        <p className="text-sm text-muted-foreground">Shared by every league.</p>
      </div>
      <div className="flex items-center gap-2 text-sm" role="group" aria-label="Sort courses">
        <span className="text-muted-foreground">Sort by</span>
        {(['distance', 'name'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={sort === v ? 'secondary' : 'ghost'}
            aria-pressed={sort === v}
            onClick={() => setSort(v)}
          >
            {v === 'distance' ? 'Distance' : 'Name'}
          </Button>
        ))}
      </div>
      <Card className="p-0">
        <ul className="divide-y">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                to={`/courses/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {c.name}
                    {c.pinned && <DefaultBadge />}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      !c.pinned && away(c) !== null ? `${away(c)!.toFixed(1)} mi` : null,
                      place(c),
                      c.notes,
                      c.layouts.some((l) => !l.retiredAt) ? null : 'no card yet',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      {me?.user.isSiteAdmin && <CourseForm />}
    </div>
  );
}

/** New course, or edits an existing one's name and place. */
function CourseForm({ course, onDone }: { course?: Course; onDone?: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(course?.name ?? '');
  const [city, setCity] = useState(course?.city ?? '');
  const [state, setState] = useState(course?.state ?? '');
  const [notes, setNotes] = useState(course?.notes ?? '');
  const [website, setWebsite] = useState(course?.website ?? '');
  const [pinned, setPinned] = useState(course?.pinned ?? false);
  const save = useMutation({
    mutationFn: () =>
      api<Course>(course ? `/courses/${course.id}` : '/courses', {
        method: course ? 'PATCH' : 'POST',
        body: {
          name,
          city: city || null,
          state: state || null,
          notes: notes || null,
          website: website || null,
          pinned,
        },
      }),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: COURSES_KEY });
      if (course) onDone?.();
      else void navigate(`/courses/${c.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const form = (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_6rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="course-name">Name</Label>
          <Input id="course-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="course-city">City</Label>
          <Input id="course-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="course-state">State</Label>
          <Input id="course-state" value={state} onChange={(e) => setState(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="course-notes">Notes</Label>
        <Input
          id="course-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Public · 18 holes"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="course-website">Website</Label>
        <Input
          id="course-website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        Default course: pinned to the top and used for new seasons
      </label>
      {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !name.trim()}>
          {course ? (
            <>
              <Check /> Save
            </>
          ) : (
            <>
              <Plus /> Add course
            </>
          )}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
  if (course) return form;
  return (
    <Card>
      <CardHeader>
        <CardTitle>New course</CardTitle>
        <CardDescription>Add its nines on the next screen.</CardDescription>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}

export function CoursePage() {
  const { courseId = '' } = useParams();
  const { data: me } = useMe();
  const courses = useCourses();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const canEdit = Boolean(me?.user.isSiteAdmin);

  if (!courses.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const course = courses.data.find((c) => c.id === courseId);
  if (!course) return <NotFoundPage />;
  const current = course.layouts.filter((l) => !l.retiredAt);
  const retired = course.layouts.filter((l) => l.retiredAt);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to="/courses"
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Courses
        </Link>
        {editing ? (
          <CourseForm course={course} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <h1 className="text-2xl font-semibold tracking-tight">{course.name}</h1>
              {course.pinned && <DefaultBadge className="mt-1" />}
              <p className="text-sm text-muted-foreground">
                {[place(course), course.notes].filter(Boolean).join(' · ')}
              </p>
              {course.website && (
                <a
                  href={course.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {course.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                </a>
              )}
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </div>
        )}
      </div>

      {(course.images.length > 0 || canEdit) && <CardImages course={course} canEdit={canEdit} />}

      {current.map((l) => (
        <LayoutCard key={l.id} course={course} layout={l} canEdit={canEdit} />
      ))}

      {canEdit &&
        (adding ? (
          <Card>
            <CardHeader>
              <CardTitle>New layout</CardTitle>
              <CardDescription>A nine (or eighteen) from one set of tees.</CardDescription>
            </CardHeader>
            <CardContent>
              <LayoutForm course={course} onDone={() => setAdding(false)} />
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" className="w-fit" onClick={() => setAdding(true)}>
            <Plus /> Add a layout
          </Button>
        ))}

      {retired.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Earlier versions ({retired.length})
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {retired.map((l) => (
              <LayoutCard key={l.id} course={course} layout={l} canEdit={false} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function LayoutCard({
  course,
  layout,
  canEdit,
}: {
  course: Course;
  layout: CourseLayout;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState(false);
  const remove = useMutation({
    mutationFn: () =>
      api<Course>(`/courses/${course.id}/layouts/${layout.id}`, { method: 'DELETE' }),
    onSuccess: (c) =>
      qc.setQueryData<Course[]>(COURSES_KEY, (cs) => cs?.map((x) => (x.id === c.id ? c : x))),
  });
  const locked = layout.cards > 0;

  return (
    <Card className={cn(layout.retiredAt && 'opacity-75')}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{layout.name}</CardTitle>
          <CardDescription>
            {layout.tees} tees · par {layout.par}
            {layout.yards !== null && ` · ${layout.yards.toLocaleString()} yards`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {layout.retiredAt ? (
            <Badge>Replaced</Badge>
          ) : (
            locked && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title="Par and stroke index are locked because scorecards use this layout."
              >
                <Lock className="size-3" /> {layout.cards} card{layout.cards === 1 ? '' : 's'}
              </span>
            )
          )}
          {canEdit && !editing && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              {!locked && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Delete ${layout.name}`}
                  disabled={remove.isPending}
                  onClick={() => window.confirm(`Delete ${layout.name}?`) && remove.mutate()}
                >
                  <Trash2 />
                </Button>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {remove.isError && <Alert variant="destructive">{remove.error.message}</Alert>}
        {editing ? (
          <LayoutForm course={course} layout={layout} onDone={() => setEditing(false)} />
        ) : (
          <HoleTable holes={layout.holes} />
        )}
        {canEdit && !layout.retiredAt && course.images.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ScrollText className="size-4" aria-hidden />
            {layout.cardGrid
              ? 'Scores are written on the course card.'
              : 'The virtual scorecard can write scores on the course card.'}
            <Button variant="outline" size="sm" onClick={() => setMarking(true)}>
              {layout.cardGrid ? 'Change' : 'Set up the course card'}
            </Button>
          </div>
        )}
        {marking && (
          <CardGridSetup course={course} layout={layout} onClose={() => setMarking(false)} />
        )}
      </CardContent>
    </Card>
  );
}

/** Scorecard-style table: holes across, par / stroke index / yards down. */
function HoleTable({ holes }: { holes: CourseHole[] }) {
  const rows: [string, (h: CourseHole) => number | null][] = [
    ['Par', (h) => h.par],
    ['Hcp', (h) => h.strokeIndex],
    ...(holes.some((h) => h.yards !== null)
      ? [['Yards', (h: CourseHole) => h.yards] as [string, (h: CourseHole) => number | null]]
      : []),
  ];
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full text-center text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1.5 pr-2 text-left font-medium">Hole</th>
            {holes.map((h) => (
              <th key={h.number} className="min-w-7 py-1.5 font-semibold text-foreground">
                {h.number}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t">
              <th className="py-1.5 pr-2 text-left font-medium text-muted-foreground">{label}</th>
              {holes.map((h) => (
                <td key={h.number} className={cn('py-1.5', label === 'Yards' && 'text-[0.65rem]')}>
                  {value(h) ?? '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const blankNine = (first: number): CourseHole[] =>
  Array.from({ length: 9 }, (_, i) => ({ number: first + i, par: 4, strokeIndex: 0, yards: null }));

const digits = (v: string, max: number) => v.replace(/[^0-9]/g, '').slice(0, max);

/**
 * Edits a layout, or adds one. When scorecards use the layout, par and stroke index are
 * locked: changing them saves a new version that replaces this one.
 */
function LayoutForm({
  course,
  layout,
  onDone,
}: {
  course: Course;
  layout?: CourseLayout;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(layout?.name ?? '');
  const [tees, setTees] = useState(layout?.tees ?? 'White');
  const [holes, setHoles] = useState<CourseHole[]>(layout?.holes ?? blankNine(1));
  const locked = Boolean(layout && layout.cards > 0);
  const scoringChanged =
    layout !== undefined &&
    holes.some(
      (h, i) => h.par !== layout.holes[i]?.par || h.strokeIndex !== layout.holes[i]?.strokeIndex,
    );
  const asNewVersion = locked && scoringChanged;

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, tees, holes };
      if (layout && !asNewVersion)
        return api<Course>(`/courses/${course.id}/layouts/${layout.id}`, { method: 'PUT', body });
      const r = await api<{ course: Course }>(`/courses/${course.id}/layouts`, {
        method: 'POST',
        body: { ...body, ...(asNewVersion ? { replaces: layout!.id } : {}) },
      });
      return r.course;
    },
    onSuccess: (c) => {
      qc.setQueryData<Course[]>(COURSES_KEY, (cs) => cs?.map((x) => (x.id === c.id ? c : x)));
      onDone();
    },
  });

  const set = (i: number, patch: Partial<CourseHole>) =>
    setHoles((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      asNewVersion &&
      !window.confirm(
        `${layout!.cards} scorecard${layout!.cards === 1 ? ' uses' : 's use'} this layout. Save a new version for future rounds? Past cards keep the old one.`,
      )
    )
      return;
    save.mutate();
  };
  const sis = holes.map((h) => h.strokeIndex);
  const badSi = (si: number) => si < 1 || si > 18 || sis.filter((x) => x === si).length > 1;
  const invalid = !name.trim() || holes.some((h) => h.par < 3 || h.par > 6 || badSi(h.strokeIndex));

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`name-${layout?.id ?? 'new'}`}>Name</Label>
          <Input
            id={`name-${layout?.id ?? 'new'}`}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Front 9"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`tees-${layout?.id ?? 'new'}`}>Tees</Label>
          <Input
            id={`tees-${layout?.id ?? 'new'}`}
            required
            value={tees}
            onChange={(e) => setTees(e.target.value)}
          />
        </div>
      </div>
      {!layout && (
        <div className="flex gap-2 text-sm">
          Holes
          {[1, 10].map((first) => (
            <Button
              key={first}
              type="button"
              size="sm"
              variant={holes[0]?.number === first ? 'secondary' : 'ghost'}
              onClick={() => setHoles(blankNine(first))}
            >
              {first}–{first + 8}
            </Button>
          ))}
        </div>
      )}
      <table className="text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="w-12 pb-1 text-left font-medium">Hole</th>
            <th className="pb-1 font-medium">Par</th>
            <th className="pb-1 font-medium">Hcp</th>
            <th className="pb-1 font-medium">Yards</th>
          </tr>
        </thead>
        <tbody>
          {holes.map((h, i) => (
            <tr key={h.number}>
              <td className="py-1 font-semibold tabular-nums">{h.number}</td>
              <td className="p-1">
                <Input
                  aria-label={`Par, hole ${h.number}`}
                  inputMode="numeric"
                  className="h-9 text-center"
                  value={h.par || ''}
                  onChange={(e) => set(i, { par: Number(digits(e.target.value, 1)) })}
                />
              </td>
              <td className="p-1">
                <Input
                  aria-label={`Hole handicap, hole ${h.number}`}
                  inputMode="numeric"
                  className={cn(
                    'h-9 text-center',
                    h.strokeIndex > 0 && badSi(h.strokeIndex) && 'border-destructive',
                  )}
                  value={h.strokeIndex || ''}
                  onChange={(e) => set(i, { strokeIndex: Number(digits(e.target.value, 2)) })}
                />
              </td>
              <td className="p-1">
                <Input
                  aria-label={`Yards, hole ${h.number}`}
                  inputMode="numeric"
                  className="h-9 text-center"
                  value={h.yards ?? ''}
                  onChange={(e) => {
                    const v = digits(e.target.value, 3);
                    set(i, { yards: v ? Number(v) : null });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        Hcp is the hole handicap from the card (1 is the hardest hole), used once each. Yards are
        for display only.
      </p>
      {asNewVersion && (
        <Alert>
          Scorecards use this layout, so a par or index change is saved as a new version. Past cards
          keep their results.
        </Alert>
      )}
      {save.isError && (
        <Alert variant="destructive">
          {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || invalid}>
          <Check /> {asNewVersion ? 'Save as new version' : layout ? 'Save' : 'Add layout'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Pictures of the course's printed scorecard; tap one to open it full size. */
function CardImages({ course, canEdit }: { course: Course; canEdit: boolean }) {
  const qc = useQueryClient();
  const done = (c: Course) =>
    qc.setQueryData<Course[]>(COURSES_KEY, (cs) => cs?.map((x) => (x.id === c.id ? c : x)));
  const add = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<Course>(`/courses/${course.id}/images`, { method: 'POST', body });
    },
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<Course>(`/courses/${course.id}/images/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });
  const src = (id: string) => `/api/courses/${course.id}/images/${id}`;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Scorecard</CardTitle>
          <CardDescription>The club's printed card. Tap to open it full size.</CardDescription>
        </div>
        {canEdit && (
          <>
            <PhotoPicker
              size="sm"
              label="Add a picture"
              pending={add.isPending}
              onFiles={([f]) => add.mutate(f!)}
            />
          </>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {add.isError && <Alert variant="destructive">{add.error.message}</Alert>}
        {course.images.length === 0 && (
          <p className="text-sm text-muted-foreground">No pictures of the card yet.</p>
        )}
        {course.images.map((img) => (
          <figure key={img.id} className="flex flex-col gap-1">
            <a
              href={src(img.id)}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border bg-white"
            >
              <img
                src={src(img.id)}
                alt={img.caption ?? `${course.name} scorecard`}
                width={img.width}
                height={img.height}
                loading="lazy"
                className="h-auto w-full"
              />
            </a>
            {(img.caption || canEdit) && (
              <figcaption className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{img.caption}</span>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => window.confirm('Remove this picture?') && remove.mutate(img.id)}
                  >
                    <Trash2 /> Remove
                  </Button>
                )}
              </figcaption>
            )}
          </figure>
        ))}
      </CardContent>
    </Card>
  );
}
