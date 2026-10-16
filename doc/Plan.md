# TeeMate Plan

This document sets out what TeeMate is for, the league rules it enforces, the features it will offer and the order they will be built in.

## Objective

TeeMate replaces the weekly spreadsheet with a web app that works on phones and computers. It becomes the one place a league goes for its schedule, tee times, scorecards, handicaps, standings and photos.

- Strokes, net scores, results, handicaps and standings are all worked out from the scores entered. Nothing that can be calculated is typed in by hand.
- One player in each foursome enters the card at the end of the round, either by hand or by taking a photo of the card that fills in the form.
- The season schedule is built at the start of the season. Everyone plays everyone, and the app keeps the foursomes as varied as possible.
- Every page requires a login. Leagues are invite-only, and every change is logged.
- One installation can host several leagues and several courses.

## What the 2026 spreadsheet shows

Source: the league's 2026 weekly spreadsheet (in the private `teemate-data` repository).

- The sheet contains no formulas. Strokes, net scores, W/L/T and points are all typed in each week.
- The standings add up: 16 players with 11 weeks each, 65 wins and 65 losses, points = 3W + T.
- 23 of the 88 matches (26%) are ties. Many of these are probably absence matches (see the rules below).
- One known error: July 15, Match 1 is recorded as a tie, but Mike B won 54 to 56 on net.
- Matches that haven't been played show negative net scores because the gross score is 0. TeeMate shows these as blank.
- The sheet has no tee times, no foursomes and no history beyond the previous week.

## League rules

Each league can configure these rules. The defaults below are the rules of the Wednesday league.

| Rule | Default |
|---|---|
| Format | 9-hole head-to-head matches, played in foursomes (2 matches per foursome) |
| Roster | Each player has a roster spot numbered 1 to n, and schedules are built by spot. n is always even and normally a multiple of 4, so everyone plays in a foursome; odd player counts aren't supported. Each player has a nickname (shown on schedules and standings) and an optional full name |
| Strokes | The higher handicap receives the full difference between the two handicaps |
| Net score | Gross score − strokes. The lower net score wins |
| Points | Win 3, tie 1, loss 0 |
| Standings ties | Level on points: more wins, then head-to-head points among the tied players, then the lower total of gross minus handicap over the rounds they all played (decided 2026-10-16). The same order seeds the playoffs |
| Handicap | League average over the player's last N rounds (5 or 10). The exact formula is still to be confirmed (see EH-006) |
| Absence: one player | A sub may play, but the sub's score never counts. The player who showed up wins only if their net score is lower than the absent player's baseline (par + handicap). Otherwise the match is a tie. The player who showed up cannot lose. |
| Absence: both players | Tie |
| Subs | Sub scores never count towards results, standings or handicaps |
| Season | 16 players and 15 regular-season games, so everyone plays everyone exactly once. This has been the format every year since 2021 (see `HistoryReview.md` in the private `teemate-data` repository). Each league can change it |
| Nine played | Front and back nine alternate each week. The starter can change the nine on game day, so the nine actually played is recorded on each scorecard |
| Game-day changes | Players in a round (or an admin) can change the tee order (tee times stay in place) and swap matches between foursomes until a card is started. Opponents only change in a draft schedule |
| Rainouts | The rained-out week's pairings are played the following week, and the rest of the schedule moves back one week. This is what the league has done historically. The commissioner can also skip a week, which happens rarely |
| Playoffs | The standard format is a 16-player seeded knockout (1 v 16, …) whose 4 winners play a Finals foursome. A tied playoff match is decided by matching cards. An absent player loses (EH-015). From 2018 to 2024 the league used a final foursome only |
| Team scramble | A team scramble is played after the playoffs (EH-016) |

## Features

### MVP (replaces the spreadsheet)

| ID | Feature |
|---|---|
| EH-001 | Authentication: magic link plus optional Google, invite-only, every page requires a login |
| EH-002 | Multiple leagues, with league-level roles |
| EH-003 | Courses and layouts (par, yardage and stroke index for each hole) |
| EH-004 | Seasons and the season schedule generator |
| EH-005 | Scorecard entry and match results (hole by hole, absences and subs) |
| EH-006 | Calculated handicaps |
| EH-007 | Standings and player history |
| EH-010 | Audit log |
| EH-011 | Import of the 2026 spreadsheet |
| EH-015 | Playoffs (seeded knockout and Finals foursome) |
| EH-016 | Post-season team scramble |

### Phase 2

| ID | Feature |
|---|---|
| EH-008 | Scorecard photo scan (AI fills in the form from a photo of the card) |
| EH-009 | Match photos (scorecard and social photos attached to a match) |
| EH-012 | Import of all historical seasons (2018–2026) into a separate history league (files collected and reviewed; the importer is still to be built) |
| EH-013 | Notifications and league announcements |
| EH-014 | Stats: scoring averages, trends, head-to-head records |
| EH-017 | Player profiles: phone and address, visible to league members |

The full specs are in [Enhancements.md](Enhancements.md).

## Delivery phases

1. **Foundation:** repo layout, CI (lint, typecheck, tests), Docker image, Swarm stack, Postgres, object storage, EH-001, EH-002, EH-010.
2. **League setup:** EH-003 and EH-004. Timberlin is entered as the first course and the 2026 schedule is rebuilt in the app.
3. **Scoring:** EH-005, EH-006, EH-007, EH-011, EH-015, EH-016. Scoring rules get unit tests that use the spreadsheet's known results.
4. **Parallel run:** run TeeMate alongside the spreadsheet for 2–3 weeks, compare the results, then switch over.
5. **Phase 2:** EH-008, EH-009, EH-012, EH-013, EH-014.

## Decisions

| Topic | Decision | Status |
|---|---|---|
| Stack shape | Same pattern as RigTracker: pnpm monorepo (web / api / packages/shared), NestJS, React + Vite, one nginx+Node image, GHCR, Swarm, Traefik, Cloudflare | Decided |
| Database | PostgreSQL with Drizzle ORM (works directly in SQL, which suits views and rolling-window calculations) | Decided |
| Image storage | S3-compatible object storage: MinIO in the homelab, with Cloudflare R2 as an alternative. Images are never stored in the database | Decided |
| UI kit | Tailwind + shadcn/ui, installable as a PWA, with light and dark themes | Decided |
| Login | Email magic link from day one, with Google as an option | Decided |
| Email consent | Nothing is emailed to league members (invites, sign-in links, notices) without the owner's consent. The app enforces this with an outbound allowlist (`MAIL_MODE`, `MAIL_ALLOWLIST`), and switching mail fully on is an explicit decision | Decided |
| Testing mode | During testing, a site admin can switch on instant sign-in protected by a shared access code (Site settings). New accounts join as users, never admins, and it never signs in as an admin or an account with authenticator codes. Every use is logged. It can't be on while email is fully on |
| Email sending | Gmail SMTP from a dedicated league Gmail account using an App Password (requires 2-Step Verification). Personal Gmail can send to about 500 recipients a day, which is plenty here. The email code sits behind an interface so Resend or SES can be swapped in later | Decided |
| Visibility | Every page and API route requires a login. There is no public view | Decided |
| Offline | Not needed: there's good signal at the course and cards are entered after the round | Decided |
| Native app | Not planned. If one is wanted later, the PWA can be wrapped with Capacitor | Deferred |
| 18Birdies | No integration: there is no public API or export. Players can upload 18Birdies scorecard screenshots to the photo scan (EH-008) | Decided |

## Open questions

1. **Handicap formula** (waiting on details): last 5 or last 10 rounds, the calculation method, rounding, the minimum number of rounds, and where a new player's handicap comes from. EH-006 stays blocked until this is known. Six seasons of weekly handicaps and scores are available to test it against.
2. **Timberlin card:** the league plays the **White** tees. Par and stroke index were found online ([reference/Timberlin.md](reference/Timberlin.md)). Still to confirm: hole 10's stroke index, and the White yardage for each hole (yardage is only shown on screen; scoring doesn't use it).
3. **Playoff details:**
   - How does the Finals foursome work: lowest net score wins, with strokes counted from the lowest handicap?
   - "MC" (matching cards) uses net scores. The default is the standard method (last 6, last 3, last hole, then hole by hole backwards, then the higher seed). "Par 5s first" is an option the league can choose. Waiting on the league's decision.
4. **Team scramble:** the questions are listed in EH-016.
