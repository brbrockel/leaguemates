import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { scoreMatch, type Layout } from '@teemate/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Flag,
  History,
  Save,
  ScrollText,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useMe } from '@/auth/session';
import { PhotosCard } from '@/components/Photos';
import { VirtualScorecard } from '@/components/VirtualScorecard';
import { cardImageSrc } from '@/components/CourseCard';
import type { CardReading, ScanResult } from '@/components/ScanCardButton';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { api, ApiError, type CardStatus, type ScorecardView } from '@/lib/api';
import { aboutTeeTime, formatDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DECIDED_BY } from '@/components/PlayoffsCard';
import { NotFoundPage } from './NotFoundPage';
import { winnerRow, winnerTint } from '@/lib/winner';

interface Entry {
  playerId: string;
  handicap: number | null;
  attendance: 'played' | 'absent';
  subName: string;
  holeScores: (number | null)[];
}

const STATUS: Record<CardStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: '' },
  submitted: { label: 'Submitted', className: 'bg-primary/15 text-primary' },
  disputed: { label: 'Disputed', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  final: { label: 'Final', className: 'bg-primary text-primary-foreground' },
};

function toEntries(view: ScorecardView, holes: number): Entry[] {
  return view.players.map((p) => {
    const r = view.card?.rounds.find((x) => x.playerId === p.playerId);
    // Before the card exists, anyone who said they can't make it starts absent.
    const out = !r && p.out;
    return {
      playerId: p.playerId,
      handicap: r?.handicap ?? p.handicap,
      attendance: r?.attendance ?? (out ? 'absent' : 'played'),
      subName: r?.subName ?? (out ? (p.out!.subName ?? '') : ''),
      holeScores: r?.holeScores ?? Array.from({ length: holes }, () => null),
    };
  });
}

export function ScorecardPage() {
  const { leagueId = '', seasonId = '', weekId = '', groupId = '' } = useParams();
  const path = `/leagues/${leagueId}/seasons/${seasonId}/weeks/${weekId}/groups/${groupId}/scorecard`;
  const key = ['scorecard', groupId];
  const qc = useQueryClient();
  const { data: me } = useMe();
  const view = useQuery({ queryKey: key, queryFn: () => api<ScorecardView>(path) });

  const [layoutId, setLayoutId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  /** Cells a card scan wasn't sure about: playerId -> hole positions to check. */
  const [check, setCheck] = useState<Record<string, number[]>>({});
  /** Totals written on a scanned card, to check the holes against as they're corrected. */
  const [written, setWritten] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  const [disputing, setDisputing] = useState(false);
  const [showVirtual, setShowVirtual] = useState(false);

  // Load the server's card into the form whenever a fresh version arrives.
  useEffect(() => {
    if (!view.data) return;
    const lid = view.data.card?.layoutId ?? view.data.plannedLayoutId;
    const holes = view.data.layouts.find((l) => l.id === lid)?.holes.length ?? 9;
    setLayoutId(lid);
    setEntries(toEntries(view.data, holes));
    setDirty(false);
  }, [view.data]);

  // A card scanned from the schedule or Home arrives with the navigation: apply it once.
  const location = useLocation();
  const navigate = useNavigate();
  const [scanned] = useState(
    () => (location.state as { scanned?: ScanResult } | null)?.scanned ?? null,
  );
  const [appliedScan, setAppliedScan] = useState(false);
  const applyScanRef = useRef<((r: CardReading) => void) | null>(null);
  useEffect(() => {
    if (!scanned || appliedScan || !view.data || entries.length === 0) return;
    setAppliedScan(true);
    applyScanRef.current?.(scanned.reading);
    // Don't re-apply on refresh or Back.
    void navigate(location.pathname, { replace: true, state: null });
  }, [scanned, appliedScan, view.data, entries.length, navigate, location.pathname]);

  const onSaved = async (data: ScorecardView) => {
    qc.setQueryData(key, data);
    await qc.invalidateQueries({ queryKey: ['season-results', seasonId] });
    await qc.invalidateQueries({ queryKey: ['standings'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api<ScorecardView>(path, {
        method: 'PUT',
        body: {
          layoutId,
          ...(view.data?.card ? { version: view.data.card.version } : {}),
          ...(reason.trim() ? { reason } : {}),
          rounds: entries.map((e) => ({
            playerId: e.playerId,
            attendance: e.attendance,
            subName: e.attendance === 'absent' ? e.subName || null : null,
            holeScores: e.holeScores,
            ...(view.data?.permissions.needsReason || view.data?.permissions.canApprove
              ? { handicap: e.handicap ?? 0 }
              : {}),
          })),
        },
      }),
    onSuccess: onSaved,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return api<ScorecardView>(`${path}/submit`, { method: 'POST' });
    },
    onSuccess: onSaved,
  });
  const approve = useMutation({
    mutationFn: () => api<ScorecardView>(`${path}/approve`, { method: 'POST' }),
    onSuccess: onSaved,
  });

  const data = view.data;
  const layout = data?.layouts.find((l) => l.id === layoutId);
  const live = useMemo(() => {
    if (!data || !layout) return [];
    const byId = new Map(entries.map((e) => [e.playerId, e]));
    const complete = (e: Entry) =>
      e.attendance === 'absent' || e.holeScores.every((s) => s !== null);
    return data.matches.map((m) => {
      const a = byId.get(m.playerA);
      const b = byId.get(m.playerB);
      if (!a || !b || a.handicap === null || b.handicap === null || !complete(a) || !complete(b))
        return { ...m, result: null };
      const asPlayer = (e: Entry) => ({
        id: e.playerId,
        handicap: e.handicap ?? 0,
        attendance: e.attendance,
        ...(e.attendance === 'played' ? { holeScores: e.holeScores as number[] } : {}),
      });
      return { ...m, result: scoreMatch(asPlayer(a), asPlayer(b), layout as Layout) };
    });
  }, [data, entries, layout]);

  if (view.error instanceof ApiError && view.error.status === 404) return <NotFoundPage />;
  if (!data || !layout || entries.length === 0)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  const perms = data.permissions;
  const isLeagueAdmin = me?.leagues.find((l) => l.id === leagueId)?.role === 'admin';
  // Out for the front nine, In for the back, Tot for an 18.
  const totalLabel = layout.holes.length > 9 ? 'Tot' : layout.holes[0]!.number > 9 ? 'In' : 'Out';
  const totalsOnly = Boolean(
    data.card &&
    data.card.rounds.length > 0 &&
    data.card.rounds.every((r) => r.holeScores.length === 0),
  );
  if (totalsOnly)
    return (
      <ImportedCard
        view={data}
        backTo={`/leagues/${leagueId}/seasons/${seasonId}`}
        leagueId={leagueId}
      />
    );
  const editable = perms.canEdit;
  const roundTitle = data.playoff?.isFinal
    ? 'Finals'
    : data.playoff
      ? `Playoffs · Round ${data.playoff.round}`
      : `Round ${data.round}`;
  const status: CardStatus = data.card?.status ?? 'draft';
  const nick = (id: string) => data.players.find((p) => p.playerId === id)?.nickname ?? '?';
  const gross = (e: Entry) =>
    e.attendance === 'absent' ? null : e.holeScores.reduce<number>((s, x) => s + (x ?? 0), 0);
  const filled = (e: Entry) => e.holeScores.filter((x) => x !== null).length;
  /** Every hole filled in, but not adding up to the total written on the scanned card. */
  const offTotal = (e: Entry) =>
    e.attendance === 'played' &&
    written[e.playerId] !== undefined &&
    filled(e) === layout.holes.length &&
    gross(e) !== written[e.playerId];

  const update = (playerId: string, change: (e: Entry) => Entry) => {
    setEntries((list) => list.map((e) => (e.playerId === playerId ? change(e) : e)));
    setDirty(true);
  };
  const setScore = (playerId: string, hole: number, raw: string) => {
    const n = raw === '' ? null : Number.parseInt(raw, 10);
    if (n !== null && (Number.isNaN(n) || n < 1 || n > 15)) return;
    setCheck((c) => ({ ...c, [playerId]: (c[playerId] ?? []).filter((x) => x !== hole) }));
    update(playerId, (e) => ({
      ...e,
      holeScores: e.holeScores.map((s, i) => (i === hole ? n : s)),
    }));
  };
  const switchNine = (id: string) => {
    if (id === layoutId) return;
    const holes = data.layouts.find((l) => l.id === id)?.holes.length ?? 9;
    setLayoutId(id);
    setEntries((list) =>
      list.map((e) =>
        e.holeScores.length === holes
          ? e
          : { ...e, holeScores: Array.from({ length: holes }, () => null) },
      ),
    );
    setDirty(true);
  };

  /** Fills the form from a card scan; nothing is saved until the person presses Save. */
  const applyScan = (r: CardReading) => {
    const layout = data.layouts.find((l) => l.id === r.layoutId);
    const holes = layout?.holes.length ?? 9;
    if (layout && r.layoutId !== layoutId) setLayoutId(r.layoutId);
    // Start from the card as saved, so re-matching names never leaves stale scores behind.
    const saved = toEntries(data, holes);
    setEntries(
      saved.map((base) => {
        const row = r.rows.find((x) => x.playerId === base.playerId);
        if (!row) return base;
        return row.absent
          ? { ...base, attendance: 'absent' as const, subName: row.subName ?? base.subName }
          : {
              ...base,
              attendance: 'played' as const,
              holeScores: Array.from(
                { length: holes },
                (_, i) => row.holeScores[i] ?? base.holeScores[i] ?? null,
              ),
            };
      }),
    );
    setCheck(
      Object.fromEntries(r.rows.flatMap((x) => (x.playerId ? [[x.playerId, x.uncertain]] : []))),
    );
    setWritten(
      Object.fromEntries(
        r.rows.flatMap((x) =>
          x.playerId && !x.absent && x.writtenTotal != null ? [[x.playerId, x.writtenTotal]] : [],
        ),
      ),
    );
    setDirty(true);
  };
  applyScanRef.current = applyScan;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to schedule">
          <Link to={`/leagues/${leagueId}/seasons/${seasonId}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{roundTitle} scorecard</h1>
          <p className="text-sm text-muted-foreground">
            {formatDay(data.date)} · tee {aboutTeeTime(data.teeTime)}
          </p>
        </div>
        <Badge className={cn('ml-auto', STATUS[status].className)}>{STATUS[status].label}</Badge>
      </div>

      {data.card?.dispute && status === 'disputed' && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <strong>Disputed{data.card.dispute.by ? ` by ${data.card.dispute.by}` : ''}:</strong>{' '}
          {data.card.dispute.note}
        </Alert>
      )}
      {status === 'submitted' && (
        <p className="text-sm text-muted-foreground">
          Submitted{data.card?.enteredBy ? ` by ${data.card.enteredBy}` : ''}. Players in this group
          have {data.disputeWindowHours} hours to dispute it before it becomes final.
        </p>
      )}

      {editable && (
        <ScanCard
          path={path}
          players={data.players}
          onRead={applyScan}
          leagueId={leagueId}
          initial={scanned}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Nine played"
          className="inline-flex w-fit rounded-lg border bg-muted p-1"
        >
          {data.layouts.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={l.id === layoutId}
              disabled={!editable}
              onClick={() => switchNine(l.id)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm text-muted-foreground disabled:cursor-default',
                l.id === layoutId && 'bg-card text-foreground shadow-xs',
              )}
            >
              <Flag className="mr-1 inline size-3.5" aria-hidden />
              {l.name}
              {l.id === data.plannedLayoutId && l.id !== layoutId && (
                <span className="ml-1 text-xs">(planned)</span>
              )}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowVirtual(true)}>
          <ScrollText /> Virtual scorecard
        </Button>
      </div>

      {/* Laid out like the paper card: holes across the top, one row per player. */}
      <Card className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-center text-sm">
          <thead className="text-xs">
            <tr className="border-b bg-muted/60">
              <th className="sticky left-0 z-10 bg-muted px-1 py-1.5 text-left font-medium text-muted-foreground sm:px-1.5">
                Hole
              </th>
              {layout.holes.map((h) => (
                <th
                  key={h.number}
                  className="min-w-7 px-px py-1.5 font-semibold sm:min-w-8 sm:px-0.5"
                >
                  {h.number}
                </th>
              ))}
              <th className="px-1 py-1.5 font-semibold sm:px-1.5">{totalLabel}</th>
            </tr>
            <tr className="border-b text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card p-1.5 text-left font-medium">Par</th>
              {layout.holes.map((h) => (
                <td key={h.number} className="px-0.5 py-1 tabular-nums">
                  {h.par}
                </td>
              ))}
              <td className="px-1.5 py-1 tabular-nums">
                {layout.holes.reduce((t, h) => t + h.par, 0)}
              </td>
            </tr>
            <tr className="border-b text-[11px] text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card p-1.5 text-left font-medium">SI</th>
              {layout.holes.map((h) => (
                <td key={h.number} className="px-0.5 py-1 tabular-nums">
                  {h.strokeIndex}
                </td>
              ))}
              <td />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.playerId} className="border-b last:border-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 w-16 max-w-16 bg-card px-1 py-1 text-left align-middle font-normal sm:w-auto sm:max-w-28 sm:px-1.5"
                >
                  <div className="truncate font-semibold">
                    {/* Linked only when read-only, so a tap can't leave unsaved scores. */}
                    {editable ? (
                      nick(e.playerId)
                    ) : (
                      <Link
                        to={`/leagues/${leagueId}/players/${e.playerId}`}
                        className="hover:underline"
                      >
                        {nick(e.playerId)}
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1 text-[10px] text-muted-foreground sm:text-[11px]">
                    <span>
                      HCP{' '}
                      {perms.needsReason || perms.canApprove ? (
                        <input
                          aria-label={`Handicap for ${nick(e.playerId)}`}
                          className="w-6 rounded border bg-card text-center sm:w-7"
                          inputMode="numeric"
                          disabled={!editable}
                          value={e.handicap ?? ''}
                          onChange={(ev) =>
                            update(e.playerId, (x) => ({
                              ...x,
                              handicap: ev.target.value === '' ? null : Number(ev.target.value),
                            }))
                          }
                        />
                      ) : (
                        (e.handicap ?? '—')
                      )}
                    </span>
                    {editable ? (
                      <button
                        className={cn(
                          'rounded-full px-1 py-px text-[10px] sm:px-1.5 sm:py-0.5 sm:text-[11px]',
                          e.attendance === 'absent'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'bg-muted text-muted-foreground',
                        )}
                        onClick={() =>
                          update(e.playerId, (x) => ({
                            ...x,
                            attendance: x.attendance === 'absent' ? 'played' : 'absent',
                          }))
                        }
                        aria-pressed={e.attendance === 'absent'}
                        aria-label={`${nick(e.playerId)} absent`}
                      >
                        {e.attendance === 'absent' ? 'Absent' : 'Played'}
                      </button>
                    ) : (
                      e.attendance === 'absent' && <span className="text-amber-600">Absent</span>
                    )}
                  </div>
                </th>
                {layout.holes.map((h, i) => (
                  <td key={h.number} className="px-px py-1 sm:px-0.5">
                    {e.attendance === 'absent' ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <input
                        aria-label={`${nick(e.playerId)} hole ${h.number}`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        enterKeyHint="next"
                        maxLength={2}
                        disabled={!editable}
                        value={e.holeScores[i] ?? ''}
                        onChange={(ev) => setScore(e.playerId, i, ev.target.value)}
                        className={cn(
                          'h-9 w-full min-w-7 rounded-md border bg-card px-0 text-center text-base font-medium tabular-nums sm:h-10 sm:min-w-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:border-transparent disabled:bg-transparent',
                          e.holeScores[i] !== null && e.holeScores[i]! < h.par && 'text-primary',
                          check[e.playerId]?.includes(i) &&
                            'border-amber-500 ring-2 ring-amber-500/40',
                          e.holeScores[i] !== null &&
                            e.holeScores[i]! > h.par + 1 &&
                            'text-destructive',
                        )}
                      />
                    )}
                  </td>
                ))}
                <td
                  className={cn(
                    'px-1 py-1 font-semibold tabular-nums sm:px-1.5',
                    offTotal(e) && 'text-amber-700 dark:text-amber-300',
                  )}
                >
                  {e.attendance === 'absent' ? '—' : filled(e) ? gross(e) : ''}
                  {offTotal(e) && (
                    <span
                      className="block text-[10px] font-normal"
                      title="The total written on the card"
                    >
                      card {written[e.playerId]}
                    </span>
                  )}
                  {e.attendance === 'played' &&
                    filled(e) > 0 &&
                    filled(e) < layout.holes.length && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        thru {filled(e)}
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editable && entries.some((e) => e.attendance === 'absent') && (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries
            .filter((e) => e.attendance === 'absent')
            .map((e) => (
              <div key={e.playerId} className="flex flex-col gap-1">
                <Label htmlFor={`sub-${e.playerId}`}>Sub for {nick(e.playerId)} (optional)</Label>
                <Input
                  id={`sub-${e.playerId}`}
                  value={e.subName}
                  onChange={(ev) => update(e.playerId, (x) => ({ ...x, subName: ev.target.value }))}
                  placeholder="Sub's name; their score doesn't count"
                />
              </div>
            ))}
        </div>
      )}

      {data.playoff ? (
        <PlayoffResults view={data} nick={nick} />
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Matches</h2>
          {live.map((m) => (
            <MatchLine key={m.id} a={nick(m.playerA)} b={nick(m.playerB)} result={m.result} />
          ))}
        </section>
      )}

      {perms.needsReason && editable && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="reason">Reason for changing a submitted card</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Fixed per dispute"
          />
        </div>
      )}

      {[save, submit, approve].map(
        (m, i) =>
          m.isError && (
            <Alert key={i} variant="destructive">
              {m.error.message}
            </Alert>
          ),
      )}

      {(editable || perms.canSubmit || perms.canDispute || perms.canApprove) && (
        <div className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-4">
          {editable && (
            <Button
              variant={perms.canSubmit ? 'outline' : 'default'}
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save /> {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
          )}
          {perms.canSubmit && (
            <Button
              disabled={submit.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Submit this card? The other players will have time to dispute it, then it becomes final.',
                  )
                )
                  submit.mutate();
              }}
            >
              <Send /> Submit
            </Button>
          )}
          {perms.canApprove && (
            <Button disabled={approve.isPending || dirty} onClick={() => approve.mutate()}>
              <ShieldCheck /> Approve as final
            </Button>
          )}
          {perms.canDispute && (
            <Button variant="outline" onClick={() => setDisputing(true)}>
              <AlertTriangle /> Dispute
            </Button>
          )}
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
      )}

      {isLeagueAdmin && data.card && (
        <Link
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          to={`/leagues/${leagueId}/activity?entityId=${data.card.id}&label=${encodeURIComponent(
            `Round ${data.round} card history`,
          )}`}
        >
          <History className="size-4" /> Card history
        </Link>
      )}

      <PhotosCard leagueId={leagueId} groupId={groupId} title="Match photos" />

      {showVirtual && (
        <Dialog open onOpenChange={(o) => !o && setShowVirtual(false)}>
          <DialogContent
            title="Virtual scorecard"
            description={dirty ? 'Includes changes not saved yet.' : undefined}
            className="sm:max-w-4xl"
          >
            <VirtualScorecard
              course={data.course ?? null}
              layout={layout}
              title={`${roundTitle} · ${layout.name}`}
              date={data.date}
              rows={entries.map((e) => {
                const m = live.find((x) => x.playerA === e.playerId || x.playerB === e.playerId);
                const side = m?.playerA === e.playerId ? 'A' : 'B';
                return {
                  playerId: e.playerId,
                  name: nick(e.playerId),
                  handicap: e.handicap,
                  attendance: e.attendance,
                  subName: e.subName,
                  holeScores: e.holeScores,
                  net: m?.result?.net[side] ?? null,
                };
              })}
              matches={
                data.playoff
                  ? []
                  : live.map((m) => ({ a: nick(m.playerA), b: nick(m.playerB), result: m.result }))
              }
              courseCard={
                layout.cardGrid && data.course
                  ? {
                      ...layout.cardGrid,
                      src: cardImageSrc(data.course.id, layout.cardGrid.imageId),
                      names: layout.cardGrid.names
                        ? {
                            ...layout.cardGrid.names,
                            src: cardImageSrc(data.course.id, layout.cardGrid.names.imageId),
                          }
                        : null,
                    }
                  : null
              }
              footer={
                data.card?.enteredBy
                  ? `Entered by ${data.card.enteredBy} · ${STATUS[status].label}`
                  : STATUS[status].label
              }
            />
          </DialogContent>
        </Dialog>
      )}

      {disputing && (
        <DisputeDialog path={path} onClose={() => setDisputing(false)} onDone={onSaved} />
      )}
    </div>
  );
}

function MatchLine({
  a,
  b,
  result,
}: {
  a: string;
  b: string;
  result: ScorecardView['matches'][number]['result'];
}) {
  if (!result) {
    return (
      <Card className="flex items-center justify-between px-4 py-3 text-sm">
        <span>
          {a} <span className="text-muted-foreground">vs</span> {b}
        </span>
        <span className="text-muted-foreground">In progress</span>
      </Card>
    );
  }
  const net = (v: number | null) => (v === null ? 'absent' : v);
  const winner = result.outcome === 'A' ? a : result.outcome === 'B' ? b : null;
  const strokesNote = result.strokes.A
    ? `${a} gets ${result.strokes.A}`
    : result.strokes.B
      ? `${b} gets ${result.strokes.B}`
      : 'no strokes';
  return (
    <Card className="flex flex-col gap-0.5 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className={cn('inline-block', result.outcome === 'A' && winnerRow)}>
            {a} <span className="tabular-nums">{net(result.net.A)}</span>
          </span>
          <span className="text-muted-foreground"> vs </span>
          <span className={cn('inline-block', result.outcome === 'B' && winnerRow)}>
            {b} <span className="tabular-nums">{net(result.net.B)}</span>
          </span>
        </span>
        <span className="flex items-center gap-1 font-medium">
          {winner ? (
            <>
              <Check className="size-4 text-primary" /> {winner}
            </>
          ) : (
            'Tie'
          )}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        Net · {strokesNote}
        {result.decidedBy === 'absence' && ` · absence rule (must beat ${result.baseline})`}
        {result.decidedBy === 'both_absent' && ' · both absent'}
        {result.decidedBy === 'official' &&
          (result.why === 'absence'
            ? " · recorded on the league's sheet: one player was absent (stand-in score)"
            : " · as recorded on the league's sheet")}
      </span>
    </Card>
  );
}

function DisputeDialog({
  path,
  onClose,
  onDone,
}: {
  path: string;
  onClose: () => void;
  onDone: (v: ScorecardView) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const dispute = useMutation({
    mutationFn: () => api<ScorecardView>(`${path}/dispute`, { method: 'POST', body: { note } }),
    onSuccess: async (v) => {
      await onDone(v);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Dispute this card"
        description="Say what's wrong. An admin will check it and correct the card."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            dispute.mutate();
          }}
        >
          <Input
            autoFocus
            required
            minLength={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Doc had a 4 on the 6th"
          />
          {dispute.isError && <Alert variant="destructive">{dispute.error.message}</Alert>}
          <Button type="submit" disabled={dispute.isPending}>
            Send dispute
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Imported history: totals only, with the official result. */
function ImportedCard({
  view,
  backTo,
  leagueId,
}: {
  view: ScorecardView;
  backTo: string;
  leagueId: string;
}) {
  const nick = (id: string) => view.players.find((p) => p.playerId === id)?.nickname ?? '?';
  const round = (id: string) => view.card?.rounds.find((r) => r.playerId === id);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to schedule">
          <Link to={backTo}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Round {view.round} result</h1>
          <p className="text-sm text-muted-foreground">
            {formatDay(view.date)} · imported from the league spreadsheet
          </p>
        </div>
      </div>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="p-2.5 text-left font-medium">Player</th>
              <th className="p-2.5 font-medium">HCP</th>
              <th className="p-2.5 pr-4 text-right font-medium">Gross</th>
            </tr>
          </thead>
          <tbody>
            {view.players.map((p) => {
              const r = round(p.playerId);
              return (
                <tr key={p.playerId} className="border-t">
                  <td className="p-2.5 font-medium">
                    <Link
                      to={`/leagues/${leagueId}/players/${p.playerId}`}
                      className="hover:underline"
                    >
                      {p.nickname}
                    </Link>
                  </td>
                  <td className="p-2.5 text-center tabular-nums">{r?.handicap ?? '—'}</td>
                  <td className="p-2.5 pr-4 text-right tabular-nums">
                    {r?.attendance === 'absent' ? 'Absent' : (r?.gross ?? '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {view.matches.map((m) => (
        <MatchLine key={m.id} a={nick(m.playerA)} b={nick(m.playerB)} result={m.result} />
      ))}
      <p className="text-xs text-muted-foreground">
        The spreadsheets record totals, not hole-by-hole scores, and not who was absent, so the
        result shown is the one the league recorded.
      </p>
    </div>
  );
}

/** Playoff outcome for this card: who advances (knockout) or the Finals order. */
function PlayoffResults({ view, nick }: { view: ScorecardView; nick: (id: string) => string }) {
  const p = view.playoff!;
  const seed = (id: string) => (p.seeds[id] ? `(${p.seeds[id]}) ` : '');
  if (p.isFinal) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Finals</h2>
        {p.finals?.standings.length ? (
          <Card className="divide-y">
            {p.finals.standings.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'flex justify-between px-4 py-2.5 text-sm',
                  s.id === p.finals?.winner && winnerTint,
                )}
              >
                <span>
                  {s.position}. {seed(s.id)}
                  {nick(s.id)}
                  {s.id === p.finals?.winner && ' · Champion'}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  net {s.net} ({s.strokes} strokes)
                </span>
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            Results appear once the card is submitted. Strokes are the difference from the lowest
            handicap in the group.
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Knockout</h2>
      {view.matches.map((m) => {
        const k = p.knockout.find((x) => x.id === m.id);
        return (
          <Card key={m.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              {[m.playerA, m.playerB].map((id, i) => (
                <span key={id}>
                  {i > 0 && <span className="text-muted-foreground"> vs </span>}
                  <span
                    className={cn(
                      k?.winner === id && 'rounded-md bg-primary/10 px-1 font-semibold',
                    )}
                  >
                    {seed(id)}
                    {nick(id)}
                  </span>
                </span>
              ))}
            </span>
            <span className="text-right text-xs text-muted-foreground">
              {k?.winner
                ? `${nick(k.winner)} advances · ${DECIDED_BY[k.decidedBy ?? 'net']}`
                : k?.decidedBy === 'commissioner'
                  ? 'Admin decides'
                  : 'After submit'}
            </span>
          </Card>
        );
      })}
    </section>
  );
}

/**
 * Photograph the paper card: the photo goes to the season's Scorecards album and the scores
 * are read into the form (Claude, or basic text recognition as a fallback) for checking.
 */
function ScanCard({
  path,
  players,
  onRead,
  leagueId,
  initial,
}: {
  path: string;
  players: { playerId: string; nickname: string }[];
  onRead: (r: CardReading) => void;
  leagueId: string;
  /** A scan made before opening the card (from the schedule or Home). */
  initial?: ScanResult | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const scan = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<ScanResult>(`${path}/scan`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: (r) => onRead(r.reading),
  });
  const result = scan.data ?? initial ?? null;
  const read = result?.reading;
  // How each row on the card maps to the foursome: a player id, 'sub:<player id>', or 'ignore'.
  const [match, setMatch] = useState<string[] | null>(null);
  const assigned = read ? read.rows.map((row, i) => match?.[i] ?? row.playerId ?? 'ignore') : [];
  const mapped: CardReading | undefined = read && {
    ...read,
    rows: read.rows.flatMap((row, i) => {
      const a = assigned[i]!;
      if (a === 'ignore') return [];
      if (a.startsWith('sub:'))
        return [
          {
            ...row,
            playerId: a.slice(4),
            absent: true,
            subName: row.nameOnCard,
            holeScores: [],
            uncertain: [],
          },
        ];
      return [{ ...row, playerId: a }];
    }),
  };
  const rematch = (i: number, value: string) => {
    const next = read!.rows.map((row, j) =>
      j === i ? value : (match?.[j] ?? row.playerId ?? 'ignore'),
    );
    setMatch(next);
    const rows = read!.rows.flatMap((row, j) => {
      const a = next[j]!;
      if (a === 'ignore') return [];
      if (a.startsWith('sub:'))
        return [
          {
            ...row,
            playerId: a.slice(4),
            absent: true,
            subName: row.nameOnCard,
            holeScores: [],
            uncertain: [],
          },
        ];
      return [{ ...row, playerId: a }];
    });
    onRead({ ...read!, rows });
  };
  const used = assigned
    .map((a) => (a.startsWith('sub:') ? a.slice(4) : a))
    .filter((a) => a !== 'ignore');
  const clash = used.length !== new Set(used).size;
  const r = mapped;
  const unmatched = read?.rows.filter((x, i) => !x.playerId && assigned[i] === 'ignore') ?? [];
  const missing = r
    ? players.filter((p) => !r.rows.some((x) => x.playerId === p.playerId)).map((p) => p.nickname)
    : [];
  const toCheck = r?.rows.reduce((n, x) => n + x.uncertain.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={scan.isPending} onClick={() => input.current?.click()}>
          <Camera /> {scan.isPending ? 'Reading the card…' : 'Scan the foursome’s card'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Take a photo or choose one: a single picture of the foursome’s card fills in all four
          players for you to check. Only one person needs to do this.
        </span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          data-card-scan
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) scan.mutate(f);
          }}
        />
      </div>
      {scan.isError && <Alert variant="destructive">{scan.error.message}</Alert>}
      {r && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <p>
            {r.provider === 'claude' ? 'Read by AI.' : 'Read with basic text recognition.'}{' '}
            {toCheck > 0
              ? `Check the ${toCheck} highlighted score${toCheck === 1 ? '' : 's'}, then Save.`
              : 'Check the scores against the card, then Save.'}
          </p>
          {read &&
            (unmatched.length > 0 || missing.length > 0 || read.rows.length !== players.length) && (
              <div className="my-2 flex flex-col gap-1.5">
                <p className="font-medium">Match the names on the card:</p>
                {read.rows.map((row, i) => (
                  <label key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-24 font-medium">“{row.nameOnCard || '(no name)'}”</span>
                    <select
                      aria-label={`Who is ${row.nameOnCard || `row ${i + 1}`} on the card`}
                      className="h-9 rounded-md border bg-card px-2 text-sm"
                      value={assigned[i]}
                      onChange={(e) => rematch(i, e.target.value)}
                    >
                      {players.map((p) => (
                        <option key={p.playerId} value={p.playerId}>
                          {p.nickname}
                        </option>
                      ))}
                      {players.map((p) => (
                        <option key={`sub-${p.playerId}`} value={`sub:${p.playerId}`}>
                          Sub for {p.nickname} (doesn't count)
                        </option>
                      ))}
                      <option value="ignore">Ignore this row</option>
                    </select>
                  </label>
                ))}
                {clash && (
                  <p className="text-destructive">Two rows are matched to the same player.</p>
                )}
              </div>
            )}
          {missing.length > 0 && (
            <p>Still missing: {missing.join(', ')}. Enter them by hand, or match a row above.</p>
          )}
          {r.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {result && (
            <a
              className="underline"
              href={`/api/leagues/${leagueId}/photos/${result.photo.id}/full`}
              target="_blank"
              rel="noreferrer"
            >
              Open the card photo
            </a>
          )}
        </Alert>
      )}
    </div>
  );
}
