import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const leagueRole = pgEnum('league_role', ['admin', 'user']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lower-case. */
  email: text('email').notNull().unique(),
  name: text('name'),
  /** What the person goes by (e.g. on bug reports); without one, their first name is used. */
  nickname: text('nickname'),
  isSiteAdmin: boolean('is_platform_admin').notNull().default(false),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  /** E.164, e.g. +18605551234. */
  phone: text('phone'),
  address: text('address'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  /** Argon2id hash; null until the person sets a password from a setup link. */
  passwordHash: text('password_hash'),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
  /** Wrong passwords since the last success or lockout. */
  failedLogins: integer('failed_logins').notNull().default(0),
  /** Lockouts in a row; each one doubles the next (15 min, 30 min, ... up to 24 h). */
  lockouts: integer('lockouts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  /** Authenticator app (optional): the secret, encrypted with APP_SECRET. */
  totpSecret: text('totp_secret'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  /** The last 30-second step used, so a code can't be replayed. */
  totpLastStep: integer('totp_last_step'),
  /** SHA-256 hashes of unused one-time recovery codes. */
  totpRecovery: jsonb('totp_recovery').$type<string[]>(),
  createdAt: createdAt(),
});

export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** SHA-256 of the token; the token itself is only ever in the link. */
    tokenHash: text('token_hash').notNull().unique(),
    /** sign_in: signs in (emailed links); set_password: sets or resets the password (admin links). */
    purpose: text('purpose', { enum: ['sign_in', 'set_password'] })
      .notNull()
      .default('sign_in'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('magic_link_tokens_email_idx').on(t.email, t.createdAt)],
);

/** Every sign-in attempt, for per-email and per-IP rate limits. */
export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind', { enum: ['magic_link', 'verify', 'test_login', 'login'] }).notNull(),
    email: text('email'),
    ip: text('ip').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('auth_attempts_ip_idx').on(t.kind, t.ip, t.createdAt),
    index('auth_attempts_email_idx').on(t.kind, t.email, t.createdAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the session cookie value. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Must be sent back in the X-CSRF-Token header on every state-changing request. */
    csrfToken: text('csrf_token').notNull(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** Points, handicap, absence, tee-time and playoff rules (typed in @teemate/shared later). */
  settings: jsonb('settings').notNull().default({}),
  /** private: only members see it. public: anyone signed in can view it (read-only). */
  visibility: text('visibility', { enum: ['private', 'public'] })
    .notNull()
    .default('private'),
  createdAt: createdAt(),
});

export const leagueMemberships = pgTable(
  'league_memberships',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: leagueRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);

/**
 * Someone who plays (or played) in the league; linked to a user once they sign up.
 * Each season's roster (season_players) picks from these and sets the spots.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Short name used on schedules and standings ("Doc", "Mike B"). Unique per league, ignoring case. */
    nickname: text('display_name').notNull(),
    /** Optional full name ("Sam Example"). */
    fullName: text('full_name'),
    /** Current handicap, set by admins until handicaps are calculated (EH-006). Copied onto each scorecard. */
    handicap: integer('handicap'),
    /** false = a past player, kept for history and not offered for new rosters. */
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('players_league_nickname_idx').on(t.leagueId, sql`lower(${t.nickname})`),
    uniqueIndex('players_league_user_idx').on(t.leagueId, t.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: leagueRole('role').notNull(),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // At most one open invite per email per league.
    uniqueIndex('invites_open_idx')
      .on(t.leagueId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

/** Append-only record of who changed what. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // No foreign keys: entries must outlive deleted leagues and accounts, and a database
    // trigger refuses any UPDATE or DELETE (see migration 0030).
    leagueId: uuid('league_id'),
    /** The season an entry belongs to, when it does (filled in by AuditService). */
    seasonId: uuid('season_id'),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_league_idx').on(t.leagueId, t.createdAt),
    index('audit_log_season_idx').on(t.seasonId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);

/** Site-wide settings managed by site admins in the app (a single row, id = 1). */
export const siteSettings = pgTable('site_settings', {
  id: integer('id').primaryKey().default(1),
  /** Testing mode: instant sign-in with a shared access code, for the test phase only. */
  testLoginEnabled: boolean('test_login_enabled').notNull().default(false),
  /** SHA-256 of the test access code; the code itself is never stored. */
  testLoginCodeHash: text('test_login_code_hash'),
  /** League that accounts created through test sign-in join (as users). */
  testLoginLeagueId: uuid('test_login_league_id').references(() => leagues.id, {
    onDelete: 'set null',
  }),
  /**
   * Outgoing email, set in the app (Site settings → Email). Null: the server's MAIL_* and
   * SMTP_* settings apply. The password is encrypted with APP_SECRET.
   */
  mail: jsonb('mail').$type<StoredMailSettings>(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface StoredMailSettings {
  mode: 'off' | 'allowlist' | 'all';
  allowlist: string;
  host: string;
  port: number;
  /** true: TLS from the start (port 465); false: STARTTLS when offered (port 587). */
  secure: boolean;
  user: string | null;
  passwordEncrypted: string | null;
  from: string;
}

/** A golf course; shared by all leagues. */
export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  city: text('city'),
  state: text('state'),
  /** Short description, e.g. "Public · 27 holes". */
  notes: text('notes'),
  website: text('website'),
  /** Location, for sorting courses by distance from the default course. */
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  /** Pinned courses (the league's home course) list first. */
  pinned: boolean('pinned').notNull().default(false),
  createdAt: createdAt(),
});

/** A nine (or eighteen) on a course from one set of tees, e.g. "Front 9" from the White tees. */
export const layouts = pgTable('layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tees: text('tees').notNull(),
  /** Position when listing a course's layouts (front before back). */
  sortOrder: integer('sort_order').notNull().default(0),
  /** Replaced by a newer version: kept for the cards that used it, never offered again. */
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const holes = pgTable(
  'holes',
  {
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => layouts.id, { onDelete: 'cascade' }),
    /** Number on the course card (1-18), in playing order within the layout. */
    number: integer('number').notNull(),
    par: integer('par').notNull(),
    /** Difficulty rank from the card; 1 is the hardest. */
    strokeIndex: integer('stroke_index').notNull(),
    yards: integer('yards'),
  },
  (t) => [primaryKey({ columns: [t.layoutId, t.number] })],
);

export const seasonStatus = pgEnum('season_status', ['draft', 'scheduled', 'complete']);

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    startDate: text('start_date').notNull(),
    /** draft: schedule can be (re)generated; scheduled: locked and being played; complete. */
    status: seasonStatus('status').notNull().default('draft'),
    /** League rules copied when the season was created, so later edits don't rewrite this season. */
    /** The photo shown across the top of the season page (chosen by an admin). */
    coverPhotoId: uuid('cover_photo_id').references((): AnyPgColumn => photos.id, {
      onDelete: 'set null',
    }),
    /** Nines played in rotation, in order (layout ids); null = the league's nines setting. */
    layoutIds: jsonb('layout_ids').$type<string[]>(),
    settings: jsonb('settings').notNull(),
    /** Final standings exactly as the league published them (imported history). */
    officialStandings:
      jsonb('official_standings').$type<
        { name: string; W: number; L: number; T: number; points: number }[]
      >(),
    /** Seed of the generated schedule, so it can be reproduced. */
    seed: integer('seed'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('seasons_league_name_idx').on(t.leagueId, t.name)],
);

/** The roster for a season: which player holds each spot. */
export const seasonPlayers = pgTable(
  'season_players',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    spot: integer('spot').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.playerId] }),
    uniqueIndex('season_players_spot_idx').on(t.seasonId, t.spot),
  ],
);

export const weekStatus = pgEnum('week_status', ['scheduled', 'played', 'skipped']);

/** One round of the season. The date moves back a week when a rainout slides the schedule. */
export const weeks = pgTable(
  'weeks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    date: text('date').notNull(),
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => layouts.id),
    status: weekStatus('status').notNull().default('scheduled'),
    /** Null for regular-season rounds; 1, 2, ... for playoff rounds (the last one is the Finals). */
    playoffRound: integer('playoff_round'),
    /** True for the Finals foursome. */
    isFinal: boolean('is_final').notNull().default(false),
  },
  (t) => [uniqueIndex('weeks_season_round_idx').on(t.seasonId, t.round)],
);

/** A playing group (normally a foursome) with its tee time. */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weekId: uuid('week_id')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    /** 0 = first off the tee. */
    slot: integer('slot').notNull(),
    teeTime: text('tee_time').notNull(),
  },
  (t) => [uniqueIndex('groups_week_slot_idx').on(t.weekId, t.slot)],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weekId: uuid('week_id')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    playerAId: uuid('player_a_id')
      .notNull()
      .references(() => players.id),
    playerBId: uuid('player_b_id')
      .notNull()
      .references(() => players.id),
    /** The result the league officially recorded (imported history). Takes precedence over re-scoring. */
    recordedOutcome: text('recorded_outcome', { enum: ['A', 'B', 'T'] }),
    /** Position in the playoff bracket within its round (1, 2, ...); winners of 1 and 2 meet next. */
    bracketSlot: integer('bracket_slot'),
    /** Playoff seeds (1 = top). */
    seedA: integer('seed_a'),
    seedB: integer('seed_b'),
    /** Playoff winner set by an admin when the rules can't decide (e.g. both absent). */
    decidedWinnerId: uuid('decided_winner_id').references(() => players.id),
    decidedReason: text('decided_reason'),
  },
  (t) => [index('matches_week_idx').on(t.weekId)],
);

export const scorecardStatus = pgEnum('scorecard_status', [
  'draft',
  'submitted',
  'disputed',
  'final',
]);

/** One card per playing group (foursome) per week. */
export const scorecards = pgTable('scorecards', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id')
    .notNull()
    .unique()
    .references(() => groups.id, { onDelete: 'cascade' }),
  /** The nine actually played (the starter may change it on the day). */
  layoutId: uuid('layout_id')
    .notNull()
    .references(() => layouts.id),
  status: scorecardStatus('status').notNull().default('draft'),
  enteredBy: uuid('entered_by').references(() => users.id, { onDelete: 'set null' }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  finalAt: timestamp('final_at', { withTimezone: true }),
  disputedBy: uuid('disputed_by').references(() => users.id, { onDelete: 'set null' }),
  disputeNote: text('dispute_note'),
  /** Incremented on every save; clients send it back to avoid overwriting someone else's edits. */
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

/** One player's round on a scorecard. */
export const cardRounds = pgTable(
  'card_rounds',
  {
    scorecardId: uuid('scorecard_id')
      .notNull()
      .references(() => scorecards.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    /** Handicap used for this round. */
    handicap: integer('handicap').notNull(),
    attendance: text('attendance', { enum: ['played', 'absent'] })
      .notNull()
      .default('played'),
    /** Name of the sub who played for an absent player (their score never counts). */
    subName: text('sub_name'),
    /** Gross score per hole in playing order; null for holes not entered yet. */
    holeScores: jsonb('hole_scores').$type<(number | null)[]>().notNull(),
    /** Gross total when only the total is known (imported history); hole scores are then empty. */
    gross: integer('gross'),
  },
  (t) => [primaryKey({ columns: [t.scorecardId, t.playerId] })],
);

/** A notice from league admins, shown in the app (never emailed). */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** Pinned notices stay at the top. */
    pinned: boolean('pinned').notNull().default(false),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [index('announcements_league_idx').on(t.leagueId, t.createdAt)],
);

/** The post-season team scramble for a season: one per season. Doesn't affect standings or handicaps. */
export const scrambles = pgTable('scrambles', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id')
    .notNull()
    .unique()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  /** YYYY-MM-DD. */
  date: text('date').notNull(),
  layoutId: uuid('layout_id')
    .notNull()
    .references(() => layouts.id),
  teamSize: integer('team_size').notNull(),
  /** Percent of each member's handicap, lowest first. */
  allowance: jsonb('allowance').$type<number[]>().notNull(),
  createdAt: createdAt(),
});

export const scrambleTeams = pgTable(
  'scramble_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scrambleId: uuid('scramble_id')
      .notNull()
      .references(() => scrambles.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    teeTime: text('tee_time'),
    /** Team handicap, fixed when the teams are set. */
    handicap: integer('handicap').notNull(),
    /** Gross per hole in playing order; null for holes not entered yet. */
    holeScores: jsonb('hole_scores').$type<(number | null)[]>().notNull(),
    version: integer('version').notNull().default(0),
    enteredBy: uuid('entered_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('scramble_teams_number_idx').on(t.scrambleId, t.number)],
);

export const scrambleTeamMembers = pgTable(
  'scramble_team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => scrambleTeams.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    /** Handicap when the teams were set. */
    handicap: integer('handicap').notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.playerId] })],
);

/** A photo from a match (or the league in general). Files live in PHOTOS_DIR, served only to members. */
export const photos = pgTable(
  'photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    /** The foursome the photo is from, if any. */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    /** photo: a picture for the album. card: a photo of a paper scorecard, kept for checking. */
    kind: text('kind', { enum: ['photo', 'card'] })
      .notNull()
      .default('photo'),
    /** A photo for a whole season (a team photo), shown on the season page. */
    seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'set null' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    caption: text('caption'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('photos_league_idx').on(t.leagueId, t.createdAt),
    index('photos_group_idx').on(t.groupId),
  ],
);

/** Pictures of a course's printed scorecard. Files live in PHOTOS_DIR/courses; signed-in users only. */
export const courseImages = pgTable('course_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  caption: text('caption'),
  sortOrder: integer('sort_order').notNull().default(0),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: createdAt(),
});
