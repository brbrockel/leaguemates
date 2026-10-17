/** Thin fetch wrapper for the TeeMate API (same origin; nginx or the Vite dev server proxies /api). */

let csrfToken: string | null = null;

/** The session's CSRF token, sent with every state-changing request. */
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(
  path: string,
  options: { method?: Method; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  // FormData (file uploads) sets its own multipart content type.
  const form = options.body instanceof FormData;
  if (options.body !== undefined && !form) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body:
      options.body === undefined
        ? undefined
        : form
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  nickname?: string | null;
  phone?: string | null;
  address?: string | null;
  isSiteAdmin: boolean;
  /** Looking around without an account: read-only, public leagues, nicknames only. */
  isGuest?: boolean;
}

export type LeagueRole = 'admin' | 'user';
/** Your access to a league: a member's role, or 'viewer' for a public league you're not in. */
export type LeagueAccess = LeagueRole | 'viewer';

export interface LeagueSummary {
  id: string;
  name: string;
  slug: string;
  role: LeagueAccess;
}

export interface Me {
  user: User;
  csrfToken: string;
  leagues: LeagueSummary[];
}

export interface Person {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  address: string | null;
  isSiteAdmin: boolean;
  disabled: boolean;
  lastSignInAt: string | null;
  hasPassword: boolean;
  /** Set while the account is cooling down after too many wrong passwords. */
  lockedUntil: string | null;
  totpEnabled: boolean;
  createdAt: string;
  isSelf: boolean;
  leagues: {
    leagueId: string;
    leagueName: string;
    role: LeagueRole;
    player: { id: string; nickname: string } | null;
  }[];
}

export interface RosterPlayer {
  id: string;
  nickname: string;
  fullName: string | null;
  userId: string | null;
  active: boolean;
}

export interface AuthOptions {
  /** Testing mode is on: instant sign-in with the shared access code. */
  testLogin: boolean;
  /** Emailed sign-in links can be sent (MAIL_MODE is not off). */
  emailSignIn: boolean;
  /** Email and password sign-in. */
  passwordSignIn?: boolean;
  /** A league is public, so "Look around as a guest" has something to show. */
  guests?: boolean;
}

export type MailMode = 'allowlist' | 'off' | 'all';

export interface MailSettingsView {
  /** 'site': saved in the app; 'server': the server's MAIL_* and SMTP_* settings. */
  source: 'site' | 'server';
  mode: MailMode;
  allowlist: string;
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  hasPassword: boolean;
  from: string;
  canStorePassword: boolean;
}

export interface SiteSettingsView {
  mailMode: MailMode;
  mail: MailSettingsView;
  testLogin: { enabled: boolean; active: boolean; hasCode: boolean; leagueId: string | null };
  /** Only present right after a code is set or generated. */
  code?: string;
}

export interface SeasonSummary {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'complete';
  startDate: string;
  weeks: number;
  /** The next round still to play, and its date (YYYY-MM-DD), if any. */
  nextRound?: number | null;
  nextDate?: string | null;
}

export interface SeasonSchedule {
  season: {
    id: string;
    name: string;
    status: SeasonSummary['status'];
    startDate: string;
    seed: number | null;
    coverPhotoId?: string | null;
    course?: { id: string; name: string };
    nines?: { id: string; name: string }[];
  };
  roster: {
    playerId: string;
    spot: number;
    nickname: string;
    fullName: string | null;
    handicap: number | null;
    userId: string | null;
  }[];
  weeks: {
    id: string;
    round: number;
    date: string;
    status: 'scheduled' | 'played' | 'skipped';
    layout: string;
    playoffRound: number | null;
    isFinal: boolean;
    /** Players who said ahead of time they can't make it. */
    absences?: { playerId: string; subName: string | null }[];
    groups: {
      id: string;
      slot: number;
      teeTime: string;
      matches: { id: string; playerA: string; playerB: string }[];
    }[];
  }[];
  report: {
    pairsMet: number;
    possiblePairs: number;
    maxOpponentRepeats: number;
    maxGroupMateRepeats: number;
    everyoneTeesFirstAndLast: boolean;
  } | null;
}

export interface ThisWeekEntry {
  leagueId: string;
  leagueName: string;
  next: {
    seasonId: string;
    seasonName: string;
    weekId: string;
    groupId: string | null;
    round: number;
    rounds: number;
    playoffRound: number | null;
    isFinal: boolean;
    date: string;
    layout: string;
    teeTime: string | null;
    opponent: string | null;
    foursome: [string, string][];
    bye: boolean;
    playerId: string;
    /** Set when you've said you can't make it. */
    out: { subName: string | null } | null;
  } | null;
}

export interface HoleInfo {
  number: number;
  par: number;
  strokeIndex: number;
}

export interface MatchResultView {
  outcome: 'A' | 'B' | 'T';
  decidedBy: 'net' | 'absence' | 'both_absent' | 'official';
  strokes: { A: number; B: number };
  net: { A: number | null; B: number | null };
  baseline?: number;
  /** A recorded result the scores don't give: an absence explains it, or it's just the league's record. */
  why?: 'absence' | 'recorded';
}

export type CardStatus = 'draft' | 'submitted' | 'disputed' | 'final';

export interface ScorecardView {
  round: number;
  date: string;
  teeTime: string;
  plannedLayoutId: string;
  layouts: { id: string; name: string; holes: HoleInfo[] }[];
  players: {
    playerId: string;
    nickname: string;
    handicap: number | null;
    /** Said ahead of time they can't make it (and who's subbing). */
    out?: { subName: string | null } | null;
  }[];
  card: {
    id: string;
    status: CardStatus;
    layoutId: string;
    version: number;
    enteredBy: string | null;
    submittedAt: string | null;
    finalAt: string | null;
    dispute: { note: string; by: string | null } | null;
    rounds: {
      playerId: string;
      handicap: number;
      attendance: 'played' | 'absent';
      subName: string | null;
      holeScores: (number | null)[];
      gross?: number | null;
    }[];
  } | null;
  matches: { id: string; playerA: string; playerB: string; result: MatchResultView | null }[];
  disputeWindowHours: number;
  permissions: {
    canEdit: boolean;
    canSubmit: boolean;
    canDispute: boolean;
    canApprove: boolean;
    needsReason: boolean;
  };
  playoff?: {
    round: number;
    isFinal: boolean;
    seeds: Record<string, number | null>;
    knockout: {
      id: string;
      winner: string | null;
      decidedBy: PlayoffDecision | null;
      net: { A: number | null; B: number | null };
    }[];
    finals: FinalsResult | null;
  } | null;
}

export type PlayoffDecision = 'net' | 'card_match' | 'forfeit' | 'seed' | 'commissioner';

export interface FinalsResult {
  winner: string | null;
  decidedBy: PlayoffDecision;
  standings: { id: string; strokes: number; net: number; position: number; nickname?: string }[];
}

export interface PlayoffBracket {
  format: 'knockout' | 'final_foursome' | 'none';
  canStart: boolean;
  regularRoundsLeft: number;
  champion: { playerId: string; nickname: string } | null;
  rounds: {
    weekId: string;
    round: number;
    isFinal: boolean;
    date: string;
    status: string;
    groups: { id: string; teeTime: string; card: CardStatus | null }[];
    finalists?: { playerId: string; seed: number; nickname: string }[];
    finals?: FinalsResult | null;
    matches: {
      id: string;
      groupId: string;
      slot: number | null;
      a: { playerId: string; nickname: string; seed: number | null };
      b: { playerId: string; nickname: string; seed: number | null };
      card: CardStatus | null;
      winner: string | null;
      decidedBy: PlayoffDecision | null;
      net: { A: number | null; B: number | null };
      decidedReason: string | null;
    }[];
  }[];
}

export interface SeasonResultGroup {
  groupId: string;
  weekId: string;
  round: number;
  status: CardStatus;
  layout: string;
  rounds: {
    playerId: string;
    attendance: 'played' | 'absent';
    handicap: number;
    gross: number | null;
  }[];
  matches: { id: string; playerA: string; playerB: string; result: MatchResultView | null }[];
}

export interface StandingsView {
  /** Final standings exactly as published (imported history). */
  official?: boolean;
  provisional: boolean;
  roundsCounted: number;
  rows: {
    rank: number;
    playerId: string;
    nickname: string;
    spot: number;
    W: number;
    L: number;
    T: number;
    played: number;
    points: number;
  }[];
}

export type MatchResultLetter = 'W' | 'L' | 'T';

export interface PlayerHistory {
  player: {
    id: string;
    nickname: string;
    fullName: string | null;
    handicap: number | null;
  };
  stats: {
    rounds: number;
    scoringAverage: number | null;
    netAverage: number | null;
    best: { gross: number; date: string; season: string } | null;
    winPct: number | null;
    record: Record<MatchResultLetter, number>;
  };
  seasons: {
    seasonId: string;
    season: string;
    W: number;
    L: number;
    T: number;
    points: number;
    official: boolean;
    rank: number | null;
  }[];
  headToHead: {
    opponentId: string;
    opponent: string;
    W: number;
    L: number;
    T: number;
    last: string;
  }[];
  matches: {
    matchId: string;
    seasonId: string;
    season: string;
    weekId: string;
    groupId: string;
    round: number;
    playoffRound: number | null;
    date: string;
    opponentId: string;
    opponent: string;
    handicap: number | null;
    absent: boolean;
    gross: number | null;
    net: number | null;
    result: MatchResultLetter | null;
    points: number | null;
    official: boolean;
  }[];
}

export interface SeasonStatRow {
  playerId: string;
  nickname: string;
  rounds: number;
  scoringAverage: number | null;
  best: number;
  netAverage: number | null;
}

export interface CourseHole {
  number: number;
  par: number;
  strokeIndex: number;
  yards: number | null;
}

export interface CourseLayout {
  id: string;
  name: string;
  tees: string;
  par: number;
  yards: number | null;
  /** Scorecards that used this layout; par and stroke index are locked once it's above 0. */
  cards: number;
  retiredAt: string | null;
  holes: CourseHole[];
}

export interface Course {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  notes: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  pinned: boolean;
  /** Pictures of the printed scorecard. */
  images: { id: string; caption: string | null; width: number; height: number }[];
  layouts: CourseLayout[];
}

export type NoticeAudience = 'league' | 'group' | 'person';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  audience: NoticeAudience;
  /** Set for notices the app writes itself, e.g. 'card.submitted'. */
  kind: string | null;
  /** Who it's for, as the viewer sees it: "League", "Your foursome", "You", a name. */
  to: string;
  createdAt: string;
  updatedAt: string | null;
  author: string | null;
  read: boolean;
  dismissed: boolean;
}

export interface HandicapSuggestions {
  rule: import('@teemate/shared').HandicapRule;
  includedLeague: { id: string; name: string } | null;
  players: {
    playerId: string;
    nickname: string;
    current: number | null;
    suggested: number | null;
    average: number | null;
    totalRounds: number;
    window: { date: string; gross: number; league: 'this' | 'included'; counted: boolean }[];
  }[];
}

export interface ScrambleTeamView {
  id: string;
  number: number;
  teeTime: string | null;
  handicap: number;
  holeScores: (number | null)[];
  version: number;
  members: { playerId: string; nickname: string; handicap: number }[];
  gross: number | null;
  net: number | null;
  position: number | null;
  onCards: boolean;
  canEnter: boolean;
}

export type ScrambleView =
  | {
      scramble: null;
      /** The scramble is set up after the playoffs (or the regular season, with none). */
      ready: boolean;
      waitingFor: string | null;
      defaults: {
        teamSize: number;
        allowance: number[];
        date: string;
        layouts: { id: string; name: string }[];
        players: { playerId: string; nickname: string; handicap: number | null }[];
      };
      canManage: boolean;
    }
  | {
      scramble: {
        id: string;
        date: string;
        teamSize: number;
        allowance: number[];
        layout: { id: string; name: string; holes: HoleInfo[] };
        started: boolean;
        complete: boolean;
      };
      teams: ScrambleTeamView[];
      canManage: boolean;
    };

export interface PhotoView {
  id: string;
  groupId: string | null;
  caption: string | null;
  width: number;
  height: number;
  createdAt: string;
  uploader: string | null;
  date: string | null;
  weekId: string | null;
  seasonId: string | null;
  seasonName: string | null;
  /** A photo of the whole season (the team photo), not one match. */
  teamPhoto: boolean;
  round: number | null;
  canDelete: boolean;
}
