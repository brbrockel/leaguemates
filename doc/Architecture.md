# Architecture

This document describes the planned high-level architecture of LeagueMates. It follows the same deployment pattern as RigTracker.

## Overview

LeagueMates is a full-stack web application with three parts:

- a React frontend, installable as a PWA
- a NestJS API
- PostgreSQL for data and S3-compatible object storage for images

In production, the frontend and API run in a single container:

- nginx serves the static web files
- nginx sends `/api/*` requests to the Node API
- the API handles business logic and database access, and issues signed URLs for images

## Logical Components

1. Web App (`web/`)
   - React, Vite, TypeScript, Tailwind CSS and shadcn/ui
   - Mobile first: a bottom tab bar on phones and a sidebar on desktop
   - Light and dark themes
   - PWA manifest and service worker, so the app can be installed on the home screen. The service worker caches the app shell only; there is no offline data.
   - The camera is reached through a file input, for scorecard and match photos

2. API (`api/`)
   - NestJS, with every route under `/api`
   - Modules: auth, users, leagues, courses, seasons, schedule, scorecards, handicaps, standings, photos, audit, import

3. Shared package (`packages/shared/`)
   - Scoring rules (strokes, net score, match result, absence rules), the handicap calculation and request validation schemas
   - Used by both web and api, so the scores players see before they submit match what the server records

4. Data
   - PostgreSQL holds all league data
   - Object storage (MinIO or Cloudflare R2) holds images. Objects are private and only reachable through short-lived signed URLs.

5. External services
   - Email: Gmail SMTP from a dedicated league account, which sends magic links, invites and notices. The sending code is behind an interface so another provider can replace it
   - Google OAuth (optional sign-in)
   - A vision AI API that reads scorecard photos (Phase 2, EH-008)

6. Edge
   - Cloudflare Tunnel, then Traefik, then the LeagueMates container. HTTPS is terminated at Cloudflare.

## Deployment Topology

- Docker Swarm stack defined in `homelab-docker-linux/teemate/teemate-stack.yml`
- Services:
  - `teemate`: the combined nginx + API container
  - `postgres`
  - `minio` (omitted if Cloudflare R2 is used)
- Images are published to `ghcr.io/brbrockel/leaguemates`
- Secrets are stored as Swarm secrets or environment variables and never committed. They are:
  - `DATABASE_URL`
  - `SESSION_SECRET`
  - `SMTP_USER` and `SMTP_APP_PASSWORD`
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  - `S3_*`
  - `VISION_API_KEY`
- The API base URL is set when the container starts (via `env-config.js`), so the same image runs in every environment

## Data Model (draft)

Every table that belongs to a league has a `league_id` column.

**Identity and access**

| Table | Contents |
|---|---|
| `user` | Login identity (`is_platform_admin`) |
| `auth_identity` | Google subject ID linked to a user |
| `magic_link_token` | Token hash, expiry time, time used |
| `session` | Server-side login sessions |
| `invite` | Pending invitation to a league |

**League structure**

| Table | Contents |
|---|---|
| `league` | League details and settings (points, handicap rule, absence rule, tee-time rule) |
| `league_membership` | A user's role in a league: `commissioner` or `player` |
| `player` | A league roster entry: roster spot (1..n, unique per league), nickname (unique per league, ignoring case), optional full name, the linked user, and an active flag |

**Courses**

| Table | Contents |
|---|---|
| `course` | A golf course |
| `layout` | A nine plus a set of tees on that course |
| `hole` | A hole in a layout: par, yardage, stroke index |

**Season and schedule**

| Table | Contents |
|---|---|
| `season` | One season of a league |
| `week` | A scheduled round in a season: round number, date (changes if a rainout moves the schedule back), planned layout (front and back alternate by default), status `scheduled`/`played`/`skipped` |
| `playoff`, `playoff_round`, `playoff_match` | Post-season format, rounds and matches (EH-015) |
| `foursome` | A playing group in a week: tee time, tee order |
| `match` | A match in a foursome between `player_a` and `player_b` |

**Scoring**

| Table | Contents |
|---|---|
| `scorecard` | One card per foursome: the layout actually played (defaults to the week's layout; the starter can change it on game day), entered by, status `draft`/`submitted`/`disputed`/`final`, photo |
| `round` | One player's round in a match: status `played`/`absent`, sub name, handicap used |
| `hole_score` | A score on one hole of a round |
| `handicap_entry` | A player's handicap for a week: value, source `computed`/`override`, reason |

**Other**

| Table | Contents |
|---|---|
| `photo` | Object storage key and type (`scorecard`/`social`). Linked to a foursome or match |
| `audit_log` | Who changed what, when, before/after values, reason |

Results, net scores and standings are **calculated, not stored**. They are worked out from `round`, `hole_score` and `handicap_entry`, using SQL views or calculations in the shared package.

## Security Model

- **Authentication:**
  - Email magic links are single-use, expire after 15 minutes and are stored only as hashes.
  - Google OIDC uses state and nonce checks.
  - Accounts are created only from an invite.
- **Sessions:**
  - Stored on the server, in an httpOnly cookie that is always `Secure`, uses `SameSite=Lax` and lasts 30 days.
  - Logging out or removing a user revokes their sessions.
- **Authorization:** global guards check, in order:
  1. that the user is logged in
  2. that they belong to the league
  3. that their role is allowed
  4. that they have the right to the specific record (for example, only a member of a foursome can enter its card)

  Every database query is filtered by `league_id`. Postgres row-level security may be added as a second layer.
- **Hardening:**
  - CSRF tokens on all state-changing requests
  - `helmet` security headers and a strict CSP
  - CORS allowlist only, with no wildcard fallback
  - Rate limits on login, magic-link requests and uploads
  - Request body validation
  - Upload checks: allowed file types, size limits, EXIF location data removed
- **Data integrity:**
  - Database constraints: a player appears only once per week, and a score must belong to a valid match.
  - A final scorecard can only be changed by a commissioner, with a required reason that is written to the audit log.
- **Outbound email guard:** no email reaches a league member without the league owner's consent.
  - `MAIL_MODE=allowlist` is the default: only addresses in `MAIL_ALLOWLIST` (exact, or `*@domain`) get mail.
  - `off` sends nothing.
  - `all` must only be set with the owner's explicit approval.
  - Blocked emails are logged with the address masked, and never sent.
- **Operations:**
  - Nightly Postgres and object storage backups, with a restore test
  - Dependency scanning in CI
  - Only the personal data that's needed is stored: name, email, optional phone

## Request Flow

1. The browser loads the web app from nginx.
2. The app calls `/api/...` with its session cookie.
3. Guards check, in order: the session, league membership, the role, then the record-level rule.
4. The API reads or writes Postgres. For images, it returns a short-lived signed URL to object storage.
