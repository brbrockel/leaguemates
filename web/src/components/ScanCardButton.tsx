import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface CardReading {
  provider: 'claude' | 'ocr';
  layoutId: string;
  rows: {
    playerId: string | null;
    nameOnCard: string;
    holeScores: (number | null)[];
    uncertain: number[];
    absent: boolean;
    /** The total written on the card, if any (a check on the holes). */
    writtenTotal?: number | null;
    /** Set when this row is a sub playing for the (absent) player. */
    subName?: string;
  }[];
  notes: string[];
}

export interface ScanResult {
  photo: { id: string };
  reading: CardReading;
}

/**
 * Photographs a foursome's paper card from outside the scorecard (the schedule, Home):
 * reads it, then opens the scorecard with the scores filled in to check and save.
 */
export function ScanCardButton({
  leagueId,
  seasonId,
  weekId,
  groupId,
  className,
  label = 'Scan card',
}: {
  leagueId: string;
  seasonId: string;
  weekId: string;
  groupId: string;
  className?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const to = `/leagues/${leagueId}/seasons/${seasonId}/weeks/${weekId}/groups/${groupId}`;
  const scan = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<ScanResult>(`${to}/scorecard/scan`, { method: 'POST', body });
    },
    onSuccess: (scanned) => void navigate(to, { state: { scanned } }),
  });
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <span onClick={stop} className={cn('inline-flex flex-col items-start gap-1', className)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={scan.isPending}
        onClick={() => input.current?.click()}
      >
        <Camera /> {scan.isPending ? 'Reading…' : label}
      </Button>
      {scan.isError && <span className="text-xs text-destructive">{scan.error.message}</span>}
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
    </span>
  );
}

interface RoundScan extends ScanResult {
  groupId: string | null;
  matchedPlayers: number;
  /** Two matches from different foursomes on one card: swap them into one foursome. */
  regroup: { matchA: string; matchB: string; groupId: string } | null;
}

/**
 * One scan button per round: photograph one or several foursome cards. Each is matched to
 * its foursome by the names on it; one card opens that scorecard filled in, several show
 * a list to open each.
 */
export function RoundScanButton({
  leagueId,
  seasonId,
  weekId,
  groupLabel,
}: {
  leagueId: string;
  seasonId: string;
  weekId: string;
  /** "1st off" for a group id, to name where each card went. */
  groupLabel: (groupId: string) => string;
}) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const base = `/leagues/${leagueId}/seasons/${seasonId}/weeks/${weekId}`;
  const qc = useQueryClient();
  // The card shows two matches that were regrouped at the course: do the same here, then
  // open that foursome's card with the scores filled in.
  const together = useMutation({
    mutationFn: async (r: RoundScan) => {
      await api(`${base}/regroup`, {
        method: 'POST',
        body: { matchA: r.regroup!.matchA, matchB: r.regroup!.matchB },
      });
      return r;
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['season', seasonId] });
      void navigate(`${base}/groups/${r.regroup!.groupId}`, { state: { scanned: r } });
    },
  });
  const scan = useMutation({
    mutationFn: async (files: File[]) => {
      const out: RoundScan[] = [];
      for (const f of files) {
        const body = new FormData();
        body.append('file', f);
        out.push(await api<RoundScan>(`${base}/scan`, { method: 'POST', body }));
      }
      return out;
    },
    onSuccess: (results) => {
      const only = results.length === 1 ? results[0]! : null;
      if (only?.groupId)
        void navigate(`${base}/groups/${only.groupId}`, { state: { scanned: only } });
    },
  });
  const results =
    scan.data && !(scan.data.length === 1 && scan.data[0]!.groupId) ? scan.data : null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={scan.isPending}
        onClick={() => input.current?.click()}
      >
        <Camera /> {scan.isPending ? 'Reading cards…' : 'Scan cards'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-round-scan
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) scan.mutate(files);
        }}
      />
      {scan.isError && <span className="text-xs text-destructive">{scan.error.message}</span>}
      {together.isError && (
        <span className="text-xs text-destructive">{together.error.message}</span>
      )}
      {results && (
        <ul className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          {results.map((r, i) => (
            <li key={r.photo.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Card {i + 1}:{' '}
                {r.groupId ? (
                  <>
                    {groupLabel(r.groupId)} ({r.matchedPlayers} of 4 names matched)
                  </>
                ) : r.regroup ? (
                  <>two matches from different foursomes were played together</>
                ) : (
                  <span className="text-destructive">
                    couldn't tell which foursome; it's saved in the season's scorecards
                  </span>
                )}
              </span>
              {r.groupId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigate(`${base}/groups/${r.groupId}`, { state: { scanned: r } })
                  }
                >
                  Check and save
                </Button>
              )}
              {!r.groupId && r.regroup && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={together.isPending}
                  onClick={() => together.mutate(r)}
                >
                  Put them together
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
