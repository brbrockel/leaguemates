import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/time';
import { NotFoundPage } from './NotFoundPage';

interface Entry {
  id: number;
  leagueId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  actor: string | null;
  actorEmail: string | null;
}

/** Plain-English descriptions of logged actions. */
export const ACTIONS: Record<string, string> = {
  'league.create': 'created the league',
  'league.update': 'changed league settings',
  'player.create': 'added a player to the roster',
  'player.update': 'edited a roster player',
  'member.add': 'added a person to the league',
  'member.role': 'changed a role',
  'member.remove': 'removed a person from the league',
  'user.create': 'created an account',
  'user.update': 'edited a person',
  'user.update_self': 'updated their details',
  'user.sign_in_link': 'made a sign-in link',
  'user.sign_out_everywhere': 'signed someone out everywhere',
  'invite.create': 'sent an invite',
  'invite.accept': 'accepted an invite',
  'invite.revoke': 'revoked an invite',
  'announcement.create': 'posted an announcement',
  'announcement.update': 'edited an announcement',
  'announcement.delete': 'deleted an announcement',
  'course.create': 'added a course',
  'course.update': 'edited a course',
  'course.image': 'added a scorecard picture',
  'course.image_delete': 'removed a scorecard picture',
  'layout.create': 'added a course layout',
  'layout.update': 'edited a course layout',
  'layout.replace': 'saved a new version of a course layout',
  'layout.delete': 'deleted a course layout',
  'handicap.apply': 'applied handicaps',
  'scramble.create': 'set up the team scramble',
  'scramble.teams': 'changed scramble teams',
  'scramble.scores': 'entered a scramble card',
  'scramble.delete': 'deleted the team scramble',
  'photo.upload': 'added a photo',
  'photo.delete': 'deleted a photo',
  'user.delete': 'deleted an account',
  'auth.login': 'signed in',
  'auth.logout': 'signed out',
  'scorecard.save': 'saved a scorecard',
  'league.visibility': 'changed who can see the league',
  'user.password_link': 'got a password link for someone',
  'user.unlock': 'unlocked an account',
  'user.totp_reset': "reset someone's authenticator",
  'auth.lockout': 'locked out after too many wrong passwords',
  'auth.password_set': 'set a password from a link',
  'auth.password_change': 'changed their password',
  'auth.totp_on': 'turned on authenticator codes',
  'auth.totp_off': 'turned off authenticator codes',
  'auth.recovery_code': 'signed in with a recovery code',
  'season.roster': 'changed a season roster',
  'season.cover': 'chose a season photo',
  'season.create': 'created a season',
  'season.generate': 'generated the schedule',
  'season.lock': 'locked the schedule',
  'season.unlock': 'unlocked the schedule',
  'season.delete': 'deleted a season',
  'week.rainout': 'rained out a round (moved back a week)',
  'week.skip': 'skipped a round',
  'week.swap': 'swapped players in a round',
  'scorecard.submit': 'submitted a scorecard',
  'scorecard.dispute': 'disputed a scorecard',
  'scorecard.override': 'corrected a scorecard',
  'scorecard.approve': 'approved a scorecard',
  'playoffs.start': 'started the playoffs',
  'playoffs.advance': 'advanced the playoffs',
  'playoffs.decide': 'decided a playoff match',
  'auth.test_login': 'signed in with testing mode',
  'site.test_login': 'changed testing mode',
  'history.import': 'imported league history',
};

const FILTERS = [
  ['', 'Everything'],
  ['scorecard', 'Scorecards'],
  ['season', 'Seasons'],
  ['week', 'Rounds'],
  ['playoffs', 'Playoffs'],
  ['player', 'Roster'],
  ['member', 'Members'],
  ['user', 'Accounts'],
  ['league', 'League settings'],
  ['auth', 'Sign-ins'],
  ['photo', 'Photos'],
  ['announcement', 'Announcements'],
  ['handicap', 'Handicaps'],
  ['scramble', 'Scramble'],
  ['course', 'Courses'],
] as const;

/**
 * The audit log, read-only. scope league: one league (optionally one season, ?seasonId=, or one
 * thing such as a scorecard, ?entityId=). site: everything. person: one person's activity.
 * Nothing here can change an entry; the database refuses edits and deletions.
 */
export function ActivityPage({ scope }: { scope: 'league' | 'site' | 'person' }) {
  const { leagueId = '', userId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [action, setAction] = useState('');
  const base =
    scope === 'league'
      ? `/leagues/${leagueId}/audit`
      : scope === 'person'
        ? `/users/${userId}/audit`
        : '/audit';
  const league = me?.leagues.find((l) => l.id === leagueId);
  const allowed =
    scope === 'site'
      ? me?.user.isSiteAdmin
      : scope === 'person'
        ? me?.user.isSiteAdmin || me?.leagues.some((l) => l.role === 'admin')
        : league?.role === 'admin';
  const seasonId = params.get('seasonId');
  const entityId = params.get('entityId');
  const label = params.get('label');

  const query = useInfiniteQuery({
    queryKey: ['audit', base, action, seasonId, entityId],
    enabled: Boolean(allowed),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{ entries: Entry[]; more: boolean }>(
        `${base}?${new URLSearchParams({
          ...(action ? { action } : {}),
          ...(seasonId ? { seasonId } : {}),
          ...(entityId ? { entityId } : {}),
          ...(pageParam ? { before: String(pageParam) } : {}),
        })}`,
      ),
    getNextPageParam: (last) => (last.more ? last.entries.at(-1)!.id : undefined),
  });

  if (me && !allowed) return <NotFoundPage />;
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => void navigate(-1)}>
          <ArrowLeft />
        </Button>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {scope === 'league'
              ? league?.name
              : scope === 'person'
                ? 'Person'
                : 'All leagues and accounts'}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{label ?? 'Activity'}</h1>
          <p className="text-xs text-muted-foreground">
            A permanent record: entries can't be changed or deleted.
          </p>
        </div>
      </div>
      <Select
        aria-label="Show"
        className="w-full sm:w-60"
        value={action}
        onChange={(e) => setAction(e.target.value)}
      >
        {FILTERS.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>
      {query.isError && <Alert variant="destructive">{query.error.message}</Alert>}
      <Card className="divide-y p-0">
        {entries.length === 0 && !query.isPending && (
          <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>
        )}
        {entries.map((e) => (
          <ActivityRow key={e.id} entry={e} />
        ))}
      </Card>
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="w-fit"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}

function ActivityRow({ entry: e }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const who = e.actor ?? e.actorEmail ?? 'System';
  const hasDetails = Boolean(e.before || e.after || e.reason);
  return (
    <div className="px-4 py-3 text-sm">
      <button
        className="flex w-full items-start gap-2 text-left disabled:cursor-default"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasDetails}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div>
            <span className="font-medium">{who}</span> {ACTIONS[e.action] ?? e.action}
          </div>
          {e.reason && <div className="text-muted-foreground">“{e.reason}”</div>}
          <div className="text-xs text-muted-foreground" title={formatDateTime(e.createdAt)}>
            {timeAgo(e.createdAt)}
          </div>
        </div>
        {hasDetails && (
          <ChevronDown
            className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {e.before != null && <Details label="Before" value={e.before} />}
          {e.after != null && <Details label="After" value={e.after} />}
        </div>
      )}
    </div>
  );
}

function Details({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
