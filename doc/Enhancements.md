# Enhancements

This page tracks planned enhancements in a consistent, reviewable format. It uses the same template as RigTracker.

## Table of Contents

1. [How To Document An Enhancement](#how-to-document-an-enhancement)
2. [Status Snapshot (2026-10-15)](#status-snapshot-2026-10-15)
3. [EH-001: Authentication and Invites](#eh-001-authentication-and-invites)
4. [EH-002: Multiple Leagues and Roles](#eh-002-multiple-leagues-and-roles)
5. [EH-003: Courses and Layouts](#eh-003-courses-and-layouts)
6. [EH-004: Seasons and Schedule Generator](#eh-004-seasons-and-schedule-generator)
7. [EH-005: Scorecard Entry and Match Results](#eh-005-scorecard-entry-and-match-results)
8. [EH-006: Calculated Handicaps](#eh-006-calculated-handicaps)
9. [EH-007: Standings and Player History](#eh-007-standings-and-player-history)
10. [EH-008: Scorecard Photo Scan](#eh-008-scorecard-photo-scan)
11. [EH-009: Match Photos](#eh-009-match-photos)
12. [EH-010: Audit Log](#eh-010-audit-log)
13. [EH-011: 2026 Spreadsheet Import](#eh-011-2026-spreadsheet-import)
14. [EH-012: Historical Import from Gmail](#eh-012-historical-import-from-gmail)
15. [EH-013: Notifications](#eh-013-notifications)
16. [EH-014: Stats](#eh-014-stats)
17. [EH-015: Playoffs](#eh-015-playoffs)
18. [EH-016: Post-Season Team Scramble](#eh-016-post-season-team-scramble)
19. [EH-017: Player Profiles and Contact Info](#eh-017-player-profiles-and-contact-info)
20. [EH-018: One Net Score for Everyone](#eh-018-one-net-score-for-everyone)
21. [EH-019: Virtual Scorecard](#eh-019-virtual-scorecard)

## How To Document An Enhancement

Use one section per enhancement with a stable ID (`EH-###`) and these fields:

- **Status**: Proposed | Planned | In Progress | Blocked | Done
- **Owner**: team or individual accountable for delivery
- **Problem**: short statement of the problem
- **Scope**: what is included and excluded
- **Proposed Solution**: architecture-level approach
- **Data/Schema Impact**: new tables, columns or indexes
- **API Impact**: routes, payloads and compatibility changes
- **UI Impact**: pages, workflows and states affected
- **Risks**: technical and operational risks
- **Rollout Plan**: migration, feature flags, fallback
- **Acceptance Criteria**: specific, testable conditions for completion

Reference commits to the spec they implement, for example `EH-004: round-robin generator`.

## Status Snapshot (2026-10-16)

| ID | Title | Phase | Status |
|---|---|---|---|
| EH-001 | Authentication and Invites | MVP | Done (local passwords, admin password links, lockouts, optional authenticator codes; see [Security.md](Security.md)) |
| EH-002 | Multiple Leagues and Roles | MVP | Done (people are site-wide accounts; leagues pick members (Admin/User), who may or may not play; leagues are private or public) |
| EH-003 | Courses and Layouts | MVP | Done (White yardages entered from the official card) |
| EH-004 | Seasons and Schedule Generator | MVP | Done (create, generate, swap, lock, rainout slide or skip, delete, This week) |
| EH-005 | Scorecard Entry and Match Results | MVP | Done (hole-by-hole cards, absences/subs, live results, submit/dispute/approve, audited corrections) |
| EH-006 | Calculated Handicaps | MVP | Done, rule awaiting league confirmation (see [Handicaps.md](Handicaps.md)) |
| EH-007 | Standings and Player History | MVP | Done |
| EH-008 | Scorecard Photo Scan | Phase 2 | Done (Claude reads the card; local OCR fallback; always reviewed before saving; anyone can practise on Account, nothing saved) |
| EH-009 | Match Photos | Phase 2 | Done |
| EH-010 | Audit Log | MVP | Done (league Activity for admins, site-wide Activity for site admins) |
| EH-011 | 2026 Spreadsheet Import | MVP | Done (covered by EH-012: 2026 is in the history import) |
| EH-012 | Historical Import from Gmail | Phase 2 | Done (2018–2026 merged into Wednesday League, foursomes in tee order; see [HistoricalImport.md](HistoricalImport.md)) |
| EH-013 | Notifications | Phase 2 | Done (in-app notices to the league, a foursome or one person, plus automatic ones for cards, rainouts and playoffs; shown as stacked one-line banners on every page that expire or are dismissed, with a horn in the top bar for the full list; site-wide notices from site admins; email set up in Site settings → Email; site admins email or text sign-in links from the season roster; admins open group texts to the roster or with an announcement, sent from their own phone; rainouts and skips are emailed to the league, and each person can turn notice emails off on Account; push notifications on each phone or computer where the person turns them on (Account), for rainouts and skips, admin notices, their foursome's news and LeagueMates' notices) |
| EH-014 | Stats | Phase 2 | Done (scoring average, best round, net average, head-to-head; League → Stats: how each hole plays, with difficulty rank and the mix of results; each player's trend over time and their holes against the field) |
| EH-015 | Playoffs | MVP | Done (seeded knockout or final foursome, card tie-breaks, forfeits, admin decisions, champion) |
| EH-016 | Post-Season Team Scramble | MVP | Done (format defaults await league confirmation) |
| EH-017 | Player Profiles and Contact Info | MVP | Done (phone + address + optional nickname; self-edit on Account, admin edit on People, call/text/map links for league members; 2026 players loaded from the roster sheet) |
| EH-018 | One Net Score for Everyone | Later | Proposed (the app shows match net, as the spreadsheet did) |
| EH-019 | Virtual Scorecard | Phase 2 | Done (drawn from course data, or written on the course's own card once a site admin marks it; shared or saved as an image) |

Also done (2026-10-16): fixes from an independent code and data review (account takeover through password links, cross-league swaps, test sign-in as admins, unlocking or skipping rounds with cards); 2025 history rounds 11–13 recovered; **Report a problem** in the profile menu, filed as GitHub issues; the code repository made public (MIT), with league records in the private `teemate-data`.

**Released 1.0.0 (2026-10-17):** the homelab deployment is now production. See [Changelog.md](Changelog.md).

Also done (2026-10-17): **Look around as a guest** on the sign-in page, offered while any league is public. Guests see public leagues read-only: schedules, results, standings, scorecards, stats and each player's golf history, with players by nickname only. They see no full names, accounts, contact details, photos, notices or activity, and can't change anything. The API allows guests an explicit list of read routes only (`@GuestOk()`).

---

## EH-001: Authentication and Invites
**Status**: Proposed
**Owner**: TBD

### Problem
Every page must require a login, and some league members don't use Google.

### Scope
In:
- Email magic-link sign-in
- Optional Google sign-in
- Invite-only accounts
- Server-side sessions
- Logout and session revocation

Out:
- Passwords
- Passkeys (possible later)
- Open self-registration

### Proposed Solution
- **Magic link:**
  1. `POST /api/auth/magic-link` with an email address. The response is the same whether or not the email exists.
  2. If the email belongs to an invited or existing user, the server creates a random 32-byte token, stores its SHA-256 hash with a 15-minute expiry, and emails the link.
  3. `GET /api/auth/magic-link/verify?token=...` uses the token (once only), creates a session and redirects to the app.
- **Google:** OIDC with state and nonce cookies, ported from RigTracker. Only an email that matches an invite or existing user can sign in.
- **Sessions:** a random ID stored in Postgres. The cookie is `teemate_session`: httpOnly, Secure, SameSite=Lax, 30 days.
- **Invites:** a commissioner invites an email to a league. Accepting the invite creates the user and the league membership.
- **Protections:** rate limits on magic-link requests (per email and per IP) and on verification attempts. CSRF tokens on all state-changing routes.
- **Email:** sent through Gmail SMTP (`smtp.gmail.com:465`) from a dedicated league Gmail account using an App Password. Code calls a `Mailer` interface, so Resend or SES can replace Gmail later.

### Data/Schema Impact
New tables: `user`, `auth_identity`, `magic_link_token`, `session`, `invite`.

### API Impact
Routes:
- `/api/auth/magic-link`
- `/api/auth/magic-link/verify`
- `/api/auth/google`
- `/api/auth/google/callback`
- `/api/auth/me`
- `/api/auth/logout`
- `/api/invites`

### UI Impact
- Sign-in page: enter an email, or continue with Google
- "Check your email" page
- Invite acceptance page
- Users who aren't logged in are sent to the sign-in page from every route

### Risks
- **Gmail limits and deliverability:** personal Gmail can send to about 500 recipients a day, which is far more than needed. Links come from a gmail.com address, which mail filters generally trust. If Google revokes the App Password, sign-in emails stop. Mitigations: alert when sending fails, and Google sign-in still works as a fallback.
- **Link scanners:** some email security scanners open links automatically, which would use up a single-use token. Mitigation: the verify link opens a page with a "Sign in" button, and the token is only used when that button sends a POST.

### Rollout Plan
Built in Phase 1 and required before any league data is loaded.

### Acceptance Criteria
- [ ] Every `/api` route except the auth routes returns 401 without a session
- [ ] A magic link works once only and expires after 15 minutes
- [ ] An email without an invite can't create an account by either method
- [ ] Logout revokes the session on the server

---

## EH-002: Multiple Leagues and Roles
**Status**: Proposed
**Owner**: TBD

### Problem
There is one league today, but LeagueMates should be able to host several. Each league needs its own data, roles and rules.

### Scope
In:
- Leagues
- Memberships with a role in each league
- A league switcher
- Rule settings for each league

Out:
- Billing
- Public league directory

### Proposed Solution
- **Data scoping:** every league-scoped table has a `league_id`. API routes are nested under `/api/leagues/:leagueId/...`.
- **League guard:** resolves the user's membership in the league and its role. Requests from non-members get a 404 so the league's existence isn't revealed.
- **Roles:**
  - `platform_admin` (on the user): creates leagues
  - `commissioner`: manages the league's roster, schedule, overrides and settings
  - `player`: reads all league data, and enters or disputes cards for their own foursome
- **League settings** (stored as typed JSON): points, handicap rule, absence rule, tee-time rule (first tee time, interval, group size, order), and the default layout.

### Data/Schema Impact
New tables: `league` and `league_membership`. `player` links to `league_id` and can optionally link to a `user_id`. One user can be in several leagues.

### API Impact
- All league data is under `/api/leagues/:leagueId`
- `GET /api/me/leagues` lists the user's leagues

### UI Impact
- League switcher in the header
- League settings page for commissioners

### Risks
Data leaking between leagues if a query misses the `league_id` filter. Mitigations:
- Repository helpers that require a league ID
- Integration tests that check cross-league access
- Optional Postgres row-level security

### Rollout Plan
Launch with a single league ("Wednesday League"). The multi-league structure exists from the first database migration.

### Acceptance Criteria
- [ ] A member of league A gets a 404 for any resource in league B
- [ ] A player can't reach commissioner routes
- [ ] Changing league settings changes how that league is scored

---

## EH-003: Courses and Layouts
**Status**: Done. Course editor at profile menu → Site settings → Courses (site admins), viewable by everyone from League → Courses. Once a scorecard uses a layout, its par and stroke index are locked. A change then saves a new version, which replaces the old one on weeks not yet played and in the nine rotation. Old cards keep the old version. Names, tees and yardages can always be edited.
**Owner**: TBD

### Problem
Scoring and handicaps need par for each hole. More than one course should be supported.

### Scope
In:
- Courses
- Layouts (a nine or eighteen plus a set of tees)
- Holes with par, yardage and stroke index

Out:
- Course data from external APIs

### Proposed Solution
- Platform admins and commissioners manage courses.
- Each league has a default layout, and individual weeks can use a different one.
- Timberlin Golf Club (Berlin, CT) is entered first, with two layouts: Front 9 and Back 9. Par and stroke index come from [reference/Timberlin.md](reference/Timberlin.md).
- The league default is to **alternate** front and back nines week by week. Each week has a planned layout, but the scorecard records the layout actually played, because the starter can change it on game day. Scoring uses the layout on the scorecard.

### Data/Schema Impact
New tables: `course`, `layout`, `hole`.

### API Impact
- `/api/courses` (shared across leagues)
- `/api/courses/:id/layouts`

### UI Impact
- Course editor
- Layout picker in league settings and on the week page

### Risks
Changing a layout after rounds have been played would change past results. Mitigation: a layout can't be edited once it has rounds. Create a new version instead.

### Rollout Plan
Phase 2 of delivery, before the schedule generator.

### Acceptance Criteria
- [ ] Timberlin's layout is entered with par for each hole
- [ ] A week can use a layout other than the league default
- [ ] Generating a season alternates front and back nines
- [ ] A scorekeeper can change the nine on a card before submitting it, and the results use the nine actually played

---

## EH-004: Seasons and Schedule Generator
**Status**: Proposed
**Owner**: TBD

### Problem
Pairings are worked out by hand each week. The league wants the whole season planned up front so that:
- everyone plays everyone at least once
- foursomes mix the group as much as possible
- nobody plays the same people every week

### Scope
In:
- Creating a season (start date, number of weeks, roster). Default: 16 players over 15 weeks, a single round-robin
- Rainouts: slide the schedule back a week (usual) or skip the round (rare)
- Generating the season schedule
- Manual swaps and locking the schedule
- Re-planning the remaining weeks
- Generating tee times

Out:
- Players requesting a specific opponent or date

### Proposed Solution
1. **Matchups:**
   - Use the circle method of round-robin scheduling, which gives n−1 weeks in which every pair meets exactly once (15 weeks for 16 players).
   - The schedule is built over roster spots 1..n. A player's spot holds their place in the schedule, so names can be corrected without changing it. Leagues use an even number of players, normally a multiple of 4. The generator can handle byes for odd counts, but the league doesn't use that.
   - If the season has more weeks than n−1, extra rounds are added with repeat matchups spread evenly. Rematches are kept as far apart in time as possible.
2. **Foursomes:**
   - Each week's matches are paired into foursomes (2 matches each).
   - The arrangement is chosen by local search (simulated annealing) to minimise the sum of squared repeat counts for each pair of players sharing a foursome across the season. This way everyone spends time on the course with as many different people as possible.
3. **Tee order:** foursomes rotate through the tee times so nobody always goes off first or last.
4. **Tee times:** first tee time + (group index × interval), using the league's tee-time rule.
5. **Nines:** front and back alternate by week (EH-003).
6. **Rainouts:** each scheduled round has a number (Round 1–15) and a date, stored separately. The commissioner marks the date as rained out and then either:
   - **slides the schedule** (default, and what the league has always done): the rained-out round and every later round move back one week, and the season end date moves too. Tee times are recalculated, players are notified (EH-013), and the nine alternation continues from the new dates.
   - **skips the round** (rare): the round is marked `skipped`, with no points for anyone. The diversity report shows any matchups that were lost, and the commissioner can choose to re-plan.
   - Playoff dates (EH-015) move back with the schedule.
7. **Commissioner controls:**
   - The commissioner reviews a diversity report showing matchup coverage, the maximum number of times any pair shares a foursome, and any repeats.
   - They can swap players, regenerate and lock the schedule.
   - After a skipped round, "re-plan from week X" regenerates only the unplayed weeks and keeps the matches already played.
   - **Roster:** the roster is set before the season starts and is locked once the schedule is generated. There are no mid-season roster changes. Between seasons, new players can replace departing ones (as Richie replaced Joe for 2026), and the commissioner sets each new player's starting handicap (EH-006). A player's display name can be edited at any time without affecting their record.

The generator is a pure function in `packages/shared` with a seed, so its output can be reproduced and tested.

### Data/Schema Impact
New tables: `season`, `week`, `foursome`, `match`. `season.generator_seed` and `season.locked_at` record how the schedule was generated and when it was locked.

### API Impact
- `POST /seasons` creates a season
- `POST /seasons/:id/schedule/generate`
- `POST /seasons/:id/schedule/lock`
- `PATCH /matches/:id` (swap players)
- `POST /seasons/:id/schedule/replan?fromWeek=`

### UI Impact
- Season setup wizard
- Schedule grid (weeks × foursomes) with drag-to-swap
- Diversity report
- "This week" page for every player: your tee time, your foursome, your opponent

### Risks
- Rosters that aren't a multiple of 4. The roster page warns the commissioner. With an even count that isn't a multiple of 4, one group is a twosome.
- A player who has to stop playing mid-season. Mitigation: their remaining matches are handled with the absence rules (EH-005), and the roster doesn't change.

### Rollout Plan
Use the 2026 roster to check output quality before the 2027 season.

### Acceptance Criteria
- [ ] With 16 players and 15 or more weeks, every pair meets at least once
- [ ] No pair shares a foursome more than ⌈expected⌉+1 times across the season
- [ ] Each player's tee-order position varies over the season
- [ ] Re-planning never changes a week that has already been played
- [ ] The roster can't be changed after the schedule is generated, but display names can
- [ ] A rainout moves that round and all later rounds back exactly 7 days, keeping their pairings
- [ ] Played rounds are never moved
- [ ] A skipped week awards no points and appears in the diversity report

---

## EH-005: Scorecard Entry and Match Results
**Status**: Proposed
**Owner**: TBD

### Problem
Scores and results are typed in by hand, which leads to mistakes such as the July 15 Match 1 tie that Mike B actually won.

### Scope
In:
- One card per foursome, entered hole by hole
- Recording an absence and a sub
- Automatic strokes, net scores and results
- Review and dispute window
- Commissioner override

Out:
- Live hole-by-hole scoring during the round (not needed)

### Proposed Solution
- **Entering the card:**
  - The spreadsheets never recorded who was absent; about 96 ties from 2021–2026 are unexplained absences. LeagueMates records it explicitly for every player.
  - Any member of a foursome can open its card and enter hole scores for all four players.
  - Each player is marked as played or absent. An absent player can have a sub, recorded by name only.
- **Results** (shared package):
  - `strokes = |hcpA − hcpB|`, given to the player with the higher handicap
  - `net = gross − strokes`
  - The lower net score wins. Points are 3 for a win, 1 for a tie and 0 for a loss.
  - One player absent: the player who showed up wins only if their net score is lower than the absent player's baseline (par for the nine played + the absent player's handicap). Otherwise the match is a tie.
  - Both players absent: tie.
  - Sub scores never count.
- **Card status:** `draft` → `submitted` → `final` once the dispute window (configurable, default 48 hours) closes. Any of the four players can mark the card `disputed`, which notifies the commissioner.

### Data/Schema Impact
New tables: `scorecard`, `round`, `hole_score`. Uniqueness constraints: one round per player per week, and one card per foursome.

### API Impact
- `GET/PUT /foursomes/:id/scorecard`
- `POST /scorecards/:id/submit`
- `POST /scorecards/:id/dispute`
- `POST /scorecards/:id/override` (commissioner only, reason required)

### UI Impact
Score entry designed for phones:
- One column per player and one row per hole, with large tap targets
- Totals and match results shown as scores are entered
- Absent/sub toggle for each player

### Risks
- Two people editing the same draft at once. Mitigation: version check, so the last save loses and has to retry.

### Rollout Plan
Run alongside the spreadsheet for 2–3 weeks and compare results.

### Acceptance Criteria
- [ ] Rules engine tests pass for every July 15 match, including Match 1 calculated as a Mike B win
- [ ] Absence cases (one absent, both absent, sub played) produce the results listed above
- [ ] Only foursome members or commissioners can edit a card
- [ ] A final card can only be changed through an override, which is written to the audit log

---

## EH-006: Calculated Handicaps
**Status**: Done; the default rule awaits the league's confirmation. Admins see suggested handicaps on League → Handicaps and apply them; the rule (best K of last N, allowance, base, rounding, max, minimum rounds, carry-over league) is a league setting. The default, best 10 of the last 20 at 75% over 35, is fitted to the 2020–2026 sheets: 97% within one stroke. Details in [Handicaps.md](Handicaps.md).
**Owner**: TBD

### Problem
Handicaps are worked out by hand from league scores.

### Scope
In:
- A rolling league-average handicap with configurable settings
- Weekly snapshots
- Commissioner overrides

Out:
- GHIN / USGA Handicap Index

### Proposed Solution
- The handicap used in week W comes only from rounds before week W. The window, method, rounding, minimum number of rounds and starting handicap are set in league settings.
- Sub rounds and absent rounds are excluded.
- The value is stored in `handicap_entry` once per week, so past results never change if the formula changes later.

### Data/Schema Impact
New table: `handicap_entry`. The handicap rule is stored in `league.settings`.

### API Impact
- `GET /players/:id/handicaps`
- `POST /weeks/:id/handicaps/recalculate`
- `PUT /handicap-entries/:id` (override, reason required)

### UI Impact
- Handicap history on the player page
- Weekly handicap table for commissioners

### Risks
The formula is still unknown. Mitigation: build the calculation behind its settings and fill in the rule once confirmed.

### Rollout Plan
Seed starting handicaps from the July 22 sheet.

### Acceptance Criteria
- [ ] Given a player's round history, the calculated handicap matches the league's manual figure
- [ ] Changing the formula doesn't change past week snapshots

---

## EH-007: Standings and Player History
**Status**: Proposed
**Owner**: TBD

### Problem
Standings are typed in by hand each week.

### Scope
In:
- Standings table (W, L, T, points)
- Player page (results, scores, handicap trend)
- Head-to-head records
- Week results page

Out:
- Playoffs (possible later)

### Proposed Solution
Standings are calculated from final scorecards using a SQL view or the shared rules, and are never stored. The tiebreak order is configurable.

### Data/Schema Impact
SQL views only.

### API Impact
- `GET /seasons/:id/standings`
- `GET /players/:id/history`
- `GET /weeks/:id/results`

### UI Impact
- Standings table that collapses into cards on phones
- Player page

### Risks
None significant.

### Rollout Plan
Built alongside EH-005.

### Acceptance Criteria
- [ ] The imported 2026 data reproduces the July 22 standings, with Match 1 corrected

---

## EH-008: Scorecard Photo Scan
**Status**: Done. On a scorecard, **Scan paper card** opens the phone camera. The photo is kept in the season's **Scorecards** album (members only), and the scores are read into the form as suggestions: by Claude (`CARD_SCAN_MODEL`, default claude-sonnet-5-5), or by local OCR (tesseract.js) when Claude isn't configured or doesn't answer. Names are matched to the foursome, the nine comes from the hole numbers on the card, and doubtful scores are highlighted. Nothing is saved until the person checks it and presses Save. The owner agreed (2026-10-16) to send card photos to Anthropic for reading.
**Owner**: TBD

### Problem
Typing 36 hole scores on a phone is tedious. Many players already keep hole-by-hole scores in the 18Birdies app.

### Scope
In:
- Take or upload a photo of the paper card
- Upload a screenshot of an 18Birdies scorecard. It goes through the same scan, and the fixed layout makes it more reliable than handwriting
- A vision AI model reads it and fills in the draft card
- The scorekeeper reviews it before submitting

Out:
- Saving without human review
- A direct 18Birdies connection. There is no public API or export, and scraping would break their terms

### Proposed Solution
1. The photo is uploaded to object storage (EH-009).
2. The API sends it to a vision model (for example Claude) with the foursome's player names and the layout's hole count. The model returns structured JSON: player → hole scores, plus a confidence value.
3. The results fill the draft card. Low-confidence cells are highlighted.
4. Manual entry is always available.
5. The original photo stays attached to the card.

### Data/Schema Impact
New columns: `scorecard.photo_id` and `scorecard.extraction` (raw JSON, for auditing).

### API Impact
`POST /scorecards/:id/scan` returns the proposed hole scores.

### UI Impact
- "Scan card" button that opens the camera
- Review screen with highlighted cells

### Risks
- Handwriting accuracy
- API cost and API keys
- Card images are sent to an external provider

Mitigations: review is always required, scans are rate-limited per user, and only the card image is sent.

### Rollout Plan
Behind a per-league feature flag.

### Acceptance Criteria
- [ ] Scans of a set of test card photos fill in at least 90% of cells correctly
- [ ] Nothing is saved as a score until the user submits the card

---

## EH-009: Match Photos
**Status**: Done. Members add photos to a match from its scorecard, and every photo is in League → Photos. Uploads (JPEG, PNG or WebP, up to 15 MB) are re-encoded at 2048 px plus a 480 px thumbnail. That removes all metadata, including GPS location. Files are kept in the `photos` volume and streamed only to league members. The uploader or an admin can delete a photo. Backed up nightly as one current archive.
**Owner**: TBD

### Problem
Players want to save scorecard photos and social photos with a match.

### Scope
In:
- Upload photos to a week, foursome or match
- Gallery view
- Delete own photos

Out:
- Video
- Public sharing

### Proposed Solution
1. The client asks the API for a pre-signed upload URL.
2. The browser uploads directly to object storage.
3. The API records the photo, checks its file type, removes EXIF location data and creates a thumbnail.
4. Photos are viewed only through short-lived signed URLs issued to league members.

### Data/Schema Impact
New table: `photo` (league, target, key, type, uploader, size, dimensions).

### API Impact
- `POST /photos/upload-url`
- `POST /photos`
- `GET /matches/:id/photos`
- `DELETE /photos/:id`

### UI Impact
- Photo strip on match and week pages
- Full-screen viewer

### Risks
- Storage growth. Mitigation: compress images when uploaded, with a size limit per league.
- Leaking images to people outside the league. Mitigation: private bucket, signed URLs only.

### Rollout Plan
Phase 2. The scorecard photo from EH-008 uses the same upload path.

### Acceptance Criteria
- [ ] An image URL doesn't work without a valid, unexpired signature
- [ ] A member of another league can't list or view these photos

---

## EH-010: Audit Log
**Status**: Proposed
**Owner**: TBD

### Problem
League decisions need a record of who changed what.

### Scope
In:
- Logging every write: user, league, action, entity, before/after, reason, time
- Audit log viewer for commissioners

Out:
- Undo

### Proposed Solution
A NestJS interceptor plus explicit calls on overrides. Log rows can only be added, never edited or deleted.

### Data/Schema Impact
New table: `audit_log`.

### API Impact
`GET /leagues/:id/audit`

### UI Impact
Audit log page for commissioners, filterable by entity and user.

### Risks
Table growth. Not a concern at this scale.

### Rollout Plan
Phase 1.

### Acceptance Criteria
- [ ] Every override and schedule change appears in the log with its reason

---

## EH-011: 2026 Spreadsheet Import
**Status**: Proposed
**Owner**: TBD

### Problem
The current season has to carry over into LeagueMates.

### Scope
In:
- Players
- July 15 results and July 22 handicaps
- Season totals for W/L/T

Out:
- Week-by-week history that isn't in the sheet

### Proposed Solution
- A script in `api/scripts/` reads the workbook and maps names to players.
- It loads the known weeks and stores the season totals so far as an opening balance, because earlier weeks' match data isn't available.
- It flags inconsistencies, such as the Match 1 tie.

### Data/Schema Impact
New table or columns for a `season_adjustment` (opening W/L/T for each player).

### API Impact
None. Script only.

### UI Impact
Standings show "includes imported totals through week 10".

### Risks
Player names are spelled differently in different places. Mitigation: a name alias map.

### Rollout Plan
Run on staging, compare with the sheet, then run on production.

### Acceptance Criteria
- [ ] Standings after the import match the July 22 sheet, apart from documented corrections

---

## EH-012: Historical Import from Gmail
**Status**: Proposed
**Owner**: TBD

### Problem
Earlier seasons are spread across weekly spreadsheet attachments in Gmail. Past seasons also show how many weeks and players the league usually has, which will set the default season length (currently 16 players over 15 weeks).

### Scope
In:
- Collecting the attachments
- Parsing every version of the sheet layout
- Matching player names
- Rebuilding week-by-week results
- Checking rebuilt results against the standings in each sheet

Out:
- Ongoing email sync

### Decisions (2026-10-15)
- Import **all** seasons, 2018–2026, into a **separate league**, e.g. "Wednesday League (History)", so the live league starts clean and history can't affect the current standings or handicaps.
- History has only gross totals, no hole scores, so imported cards store totals. The matching-cards tie-break doesn't apply to history.
- Each season's final standings from the sheets are the target. Any difference left after the rebuild is listed in the import report, not hidden.
- Current handicaps were loaded on 2026-10-15: each player's last 2026 handicap was put on the live roster.

### Proposed Solution
1. **Collect the files**, using either option:
   - **Google Takeout:** label the emails and export only that label as an mbox file. A script extracts the `.xlsx` attachments.
   - **Apps Script:** a small script in the user's own Google account copies matching attachments to a Drive folder, which is then downloaded as a zip.
2. **Parse:** a layout-tolerant parser finds the "Match N" blocks, the "Results" header and the standings table, then records the week date, matches, handicaps, gross scores, results and standings.
3. **Rebuild:** derive the weekly results. Where a week's results are missing, use the difference between consecutive standings snapshots to fill the gap. Flag any mismatches for manual review.

### Data/Schema Impact
Uses the existing tables, plus `import_batch` to record where each record came from.

### API Impact
None. Scripts only, possibly with an admin upload page later.

### UI Impact
Season archive pages.

### Risks
- Inconsistent sheet layouts and missing weeks
- Personal data in emails

Mitigations: only attachments are processed, files are kept outside the repo, and every flagged mismatch is reviewed by hand.

### Rollout Plan
After the MVP. One season at a time.

### Acceptance Criteria
- [ ] For each imported season, the rebuilt standings match the final sheet, or the differences are documented
- [ ] A summary of each season (players, weeks played, rainouts) is produced to decide the default season length

---

## EH-013: Notifications
**Status**: In Progress. Done: league announcements in the app (admins post, edit, choose how long they show as a banner, and delete; audited), shown as stacked banners on every page and in the horn panel in the top bar, plus site-wide notices from site admins (optionally "must see"). Nothing is emailed. Email notices and web push wait for the owner's consent and the league mail account.
**Owner**: TBD

### Problem
Players need to know their tee time and opponent, and when a card is ready to review.

### Scope
In:
- Email notices: schedule published, weekly tee times, card submitted, card disputed
- League announcements: the commissioner posts a message (e.g. "rainout tonight", "finals moved to Thursday") that appears on the home screen and is sent to members
- Web push (PWA) as an option

Out:
- SMS

### Proposed Solution
- Email through the same provider as EH-001
- Web push using VAPID keys
- Each user chooses which notices they get

### Data/Schema Impact
New tables: `notification_pref`, `push_subscription` and `announcement` (league, author, body, pinned, created).

### API Impact
- `/me/notifications`
- `/me/push-subscriptions`

### UI Impact
Notification settings page.

### Risks
iOS only supports web push for PWAs installed on the home screen.

### Rollout Plan
Phase 2.

### Acceptance Criteria
- [ ] Players get a weekly email with their tee time and opponent on schedule day

---

## EH-014: Stats
**Status**: Done. Scoring table on Standings; scoring average, best round and head-to-head on each player's page; League → Stats shows each nine hole by hole (average, over par, difficulty rank, birdie/par/bogey/double mix), filterable by season; each player's page has a trend chart (gross or net, with the average of the last five) and their average on each hole against the field. Hole stats use cards entered hole by hole; imported history (totals only) shows in trends but not hole stats.
**Owner**: TBD

### Problem
Hole-by-hole data allows richer stats.

### Scope
In:
- Scoring average
- Best round
- Average score per hole and difficulty ranking
- Head-to-head records
- Trends

Out:
- Strokes gained

### Proposed Solution
SQL views over `hole_score`.

### Data/Schema Impact
Views only.

### API Impact
`GET /players/:id/stats` and `GET /leagues/:id/stats`.

### UI Impact
Stats tab with charts.

### Risks
Little data early in a season.

### Rollout Plan
Phase 2.

### Acceptance Criteria
- [x] Each stat matches a hand calculation on the test data (`api/test/hole-stats.test.ts`)

---

## EH-015: Playoffs
**Status**: Proposed
**Owner**: TBD

### Problem
Every season ends with a playoff, and its format has changed over the years (see `HistoryReview.md` in the private `teemate-data` repository). Today it's organised by hand in the spreadsheet.

### Scope
In:
- **Seeded knockout** (the league's standard format): 1 v 16, 2 v 15, and so on, leading into a Finals foursome
- **Final foursome only:** the top N players by standings play one round together. The league used this from 2018 to 2024; it's kept as a league setting and for importing those seasons
- Seeding from the final standings
- Playoff tiebreaks
- Playoff absence rule
- Champion record

Out:
- Consolation brackets
- Double elimination

### Proposed Solution
- When the regular season ends, the commissioner creates the playoff. Seeds come from the final standings, using the league's tiebreak order, and the commissioner can adjust them.
- **Knockout:**
  - Each round is played as head-to-head matches using the regular scoring rules, with winners advancing.
  - **A tie is broken by matching cards ("MC"), using net scores.** Handicap strokes are given out hole by hole on the nine played, hardest holes first by stroke index. If the difference is more than 9, some holes get two strokes. The tiebreak is stored as an ordered list of steps, so it can change without code changes.
    - **Default (the standard method):** net over the last 6 holes, then the last 3 holes, then the last hole, then one hole at a time going backwards (8th, 7th, …). "Last" means the order the holes were played: 4–9 on the front nine, 13–18 on the back nine.
    - Example: a 4 handicap plays a 10 handicap on the front nine. The 10 gets 6 strokes, on holes 6, 1, 2, 9, 5 and 3. That's 3 strokes in the last 6 holes, 1 in the last 3 and 1 on the last hole.
    - **League option, "par 5s first":** net on the nine's par 5s (Timberlin: holes 1 and 6 on the front nine, 10 and 13 on the back nine), then the standard steps. Waiting on the league's decision.
    - If the cards still match on every hole, the **higher seed advances**. The commissioner can override this, with a reason that is written to the audit log.
  - **Absence:** an absent player loses. If both players are absent, the commissioner decides.
- **Finals foursome:**
  - The four finalists play one round. Each player receives strokes equal to their handicap minus the lowest handicap in the group, and the lowest net score wins.
  - A tie uses the same matching-cards tiebreak.
- Rounds are scheduled on the Wednesdays after the regular season, and move back with rainouts (EH-004).

### Data/Schema Impact
New tables:
- `playoff` (season, format, settings)
- `playoff_round` (number, date)
- `playoff_match`: two players for a knockout match, or four for a foursome. Records seeds, winner and how the match was decided (`net`, `card_match`, `forfeit`, `commissioner`)

Scorecards reuse the EH-005 tables.

### API Impact
- `POST /seasons/:id/playoff`, which creates the playoff and seeds it
- `POST /playoff-rounds/:id/advance`
- `PUT /playoff-matches/:id/decision` (commissioner only, reason required)

### UI Impact
- Bracket view, which works on phones
- Finals leaderboard
- Season champion shown on the standings and in the season archive

### Risks
The format may change from season to season. Mitigation: the format and tiebreaks are stored in each season's playoff settings.

### Rollout Plan
Built in the Scoring phase so it's ready for the first season's playoffs. Past champions can be filled in from the historical import.

### Acceptance Criteria
- [ ] With 16 players, round 1 pairs the seeds 1 v 16, 2 v 15, …, 8 v 9
- [ ] A tied knockout match is decided by matching cards using the hole scores
- [ ] An absent player loses their knockout match
- [ ] The Finals foursome is scored with strokes counted from the lowest handicap in the group

---

## EH-016: Post-Season Team Scramble
**Status**: Done. Set up on the Season page once the schedule is locked: date, nine, team size, allowance and who's playing. Teams are balanced by handicap (snake draft, then swaps), and admins can swap players or rebalance until scores are in. One card per team, entered by a team member or an admin. Ranked by net, with ties on matching cards (gross). Defaults (4-person teams, 20/15/10/5%) are in League settings and need the league's confirmation.
**Owner**: TBD

### Problem
The league plays a team scramble after the playoffs. It needs teams, tee times and results, but it isn't scored the same way as the head-to-head matches.

### Scope
In:
- Creating the scramble event
- Forming teams (by hand, or balanced automatically by handicap)
- Team tee times
- One team score per hole
- Team handicap allowance
- Results and the winning team

Out:
- Counting scramble results in the regular-season standings or handicaps

### Proposed Solution
- A scramble is an event attached to the season, played after the playoffs.
- **Teams:** the commissioner sets the team size and chooses either manual teams or "balanced" teams. Balanced teams are built by pairing the strongest and weakest players by handicap (e.g. snake order) so team totals are as even as possible.
- **Scoring:** one card per team with one score per hole. Team handicap = the league's allowance formula. A common allowance for 4-person scrambles is 20% / 15% / 10% / 5% of each player's handicap, from lowest to highest; the league's actual rule is to be confirmed. Lowest team net score wins, and ties use matching cards.
- **Scorecard entry:** reuses EH-005 (one team member enters the card), with an optional photo scan (EH-008).

### Data/Schema Impact
New tables: `event` (type `scramble`, season, date, layout, settings), `team`, `team_member`, `team_score` (hole scores, handicap allowance).

### API Impact
- `POST /seasons/:id/events`
- `POST /events/:id/teams/generate`
- `PUT /teams/:id`
- `GET/PUT /teams/:id/scorecard`

### UI Impact
- Scramble setup: team builder with drag and drop
- Team card entry
- Leaderboard

### Risks
The format is unknown. Mitigation: team size, how teams are formed, and the allowance are all settings.

### Rollout Plan
After EH-015, ready for the first season's post-season.

### Open Questions
- How many players are on a team (2 or 4)? Does all 16 players' participation matter?
- How are teams picked: by the commissioner, by draw, or balanced by handicap or standings?
- Is it 9 or 18 holes, and is it played the same day as the Finals or on a separate date?
- What handicap allowance is used, if any?
- Is there a prize or a record to keep, such as a season "scramble champions" entry?

### Acceptance Criteria
- [ ] The commissioner can generate balanced teams and adjust them by hand
- [ ] The team net score uses the configured allowance
- [ ] Scramble results don't affect standings or handicaps

---

## EH-017: Player Profiles and Contact Info
**Status**: Proposed
**Owner**: TBD

### Problem
Members need to reach each other (to arrange subs, rainouts and so on), and admins need contact details in one place.

### Scope
In:
- Phone number and mailing address on each person, alongside their name and email
- Members can edit their own details from Account
- Admins can edit details for the people they manage (People screen)
- Members of a league can see each other's contact details. The owner confirmed on 2026-10-15 that this is fine, since the information is publicly searchable.

Out:
- Showing contact details to anyone outside the league
- Sending SMS

### Proposed Solution
- Add `phone` and `address` columns to `users`.
- **Phone:** stored in E.164 format and shown in local format, with tap-to-call and tap-to-text links on phones.
- **Address:** free text, with a link to open it in Maps.
- A contact card on each member: name, nickname and roster spot, email, phone, address.

### Data/Schema Impact
New columns `users.phone` and `users.address`. Every change is audited.

### API Impact
- `PATCH /me` for your own details
- Existing `PATCH /users/:id` gains `phone` and `address`
- The members list includes contact fields

### UI Impact
- Account page: "Your details"
- People screen: edit fields
- League page: member contact cards

### Risks
Personal data. Mitigations:
- Visible to league members only
- Never sent to third parties
- Included in backups, which must be protected accordingly

### Acceptance Criteria
- [ ] A member can update their own phone and address
- [ ] Other members of the league can see them; people outside the league can't
- [ ] Changes appear in the audit log

---

## EH-018: One Net Score for Everyone
**Status**: Proposed (2026-10-16). Until it's decided, the app shows net exactly as the league's spreadsheet did.
**Owner**: TBD

### Problem
The spreadsheet's net is a **match net**: the higher handicap gets the difference in strokes, so a player's net depends on who they played. Jerry (7) shooting 47 against Keith (13) shooting 55 is 47 v 49. Against a different opponent the same 47 is a different net, so nets from two matches can't be compared side by side, and putting one player's match net next to another's (or next to gross minus handicap) can look like the higher net won. It never does: in every one of the 794 imported matches with two scores, no recorded win went to the higher net.

### Proposal
Show **plain net** everywhere: gross minus the player's full handicap (Jerry 40, Keith 42). The winner and the margin are always the same as with match net; the strokes would show separately ("Keith gets 6"). Every net in the app would then compare with every other.

### Scope
In:
- Scorecard, season results, player pages, averages and the trend chart all show plain net
- The rules (League settings → How scoring works) explain it
Out:
- Any change to who wins: results are identical

### Related data question
107 imported matches were recorded as ties while the two nets differ. About half fit the absence rule (the sheet kept a typical score for the absent player). The other 54 don't fit any rule (e.g. 2026-04-29, both matches of the first foursome); they look like foursomes that didn't play, with stand-in scores. The sheets don't say who was absent. Those stand-in scores are counted as real rounds in averages, best rounds, trends and handicap suggestions. Decide whether to leave them (current) or mark those rounds as not counted while keeping the recorded ties.

### Acceptance Criteria
- [ ] The league chooses match net or plain net
- [ ] If plain net: every page shows the same net for the same round, and results don't change
- [ ] The stand-in scores question is decided

---

## EH-019: Virtual Scorecard
**Status**: Done (2026-10-21)
**Owner**: TBD

### Problem
The scorecard screen is deliberately plain: numbers in a grid, nothing in the way. Sometimes people want to see the round the way golfers read it, as a filled-in paper card.

### Proposal
A **Virtual scorecard** button on the scorecard screen (never the default view) draws the round as a classic paper card from the data LeagueMates already has: the course's name and town, the layout's tees and yardage, par and handicap (stroke index) rows, then each player's scores in pen, circled under par and boxed over par, their total, handicap and match net, and the match results underneath.

Every course stores the same facts (hole, yards, par, stroke index), so one drawing works for every course with no setup.

### The course's own card
A site admin picks one of the course's card pictures for a nine and taps: the first hole's box on the first player line, the last hole's box, the Out/In box and where the name goes (both optional), then the first hole's box on each further player line (cards like Timberlin's split the lines with a par row, so each line is tapped; lines left out continue the spacing). A preview writes sample scores before saving. Holes in between are evenly spaced, and the line through the first and last box follows a picture taken at a slight angle. A new version of the nine keeps the marks; removing the picture removes them. Nines without marks keep the drawn card.

**Fold-over cards.** Timberlin's back nine is printed on a flap with no name column (holes 10–18, In, Tot, HCP, NET) that folds over the front nine, so names written on the front serve both. At the name step, the setup offers "Names are on the Front 9 card": the back nine's card is then shown with the front card's name column joined on its left, scaled and moved so the player lines are level, and names are written there. The official card on timberlingolf.com is the same two pictures (hole 10 is cut at the flap's edge there too). A new version of the lending nine keeps lending its names.

### Scope
In:
- The drawn card for league rounds and playoffs, showing unsaved changes too
- Front, back or 18 holes (scrolls sideways on a phone)
- Sharing the card as an image from a phone, or saving it elsewhere (the image always has every hole)
- The course's own card, marked by a site admin, shown cropped to the score area in a handwriting face, with a switch to the drawn card
Out:
- Reading the grid from the picture automatically (unreliable across card designs; the taps take a minute)

### Acceptance Criteria
- [x] The scorecard screen has a Virtual scorecard button; the plain grid stays the default
- [x] Yardage, par and handicap rows come from the course's layout
- [x] Birdies are circled, bogeys boxed, eagles double-circled, double bogeys or worse double-boxed. No stroke dots: matches are decided on total net, so the strokes show once, as "X gets N" with the result
- [x] Totals, handicaps, nets and match results match the scorecard screen
- [x] Share image (phones) or Save image (computers) gives a PNG of the whole card
- [x] A site admin marks a nine on a card picture; the virtual scorecard writes the round on it
