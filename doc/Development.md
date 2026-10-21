# Development

How to set up, run and check LeagueMates locally.

## Prerequisites

- **Node 24** via nvm. The repo's `.nvmrc` pins the version, so run `nvm use` in the repo.
- **pnpm 10** via corepack: `corepack enable`. The version is pinned in `package.json`.
- **Docker**, for local Postgres (15432) and Mailpit (11025 SMTP, inbox on 18025). Ports are deliberately unusual and bound to 127.0.0.1, so they don't collide with other apps on this machine or on Windows (WSL forwards ports to it).
- **Python 3**, only for the import tools in `tools/import/`.

## Layout

| Path | Contents |
|---|---|
| `packages/shared/` | Scoring rules (strokes, net, absences, points, standings, tie-breaks, playoffs) and the season schedule generator. No dependencies. Used by both the API and the web app |
| `api/` | NestJS 12 API on port 4100: magic-link sign-in, sessions, leagues, invites, audit log. Drizzle ORM with PostgreSQL; migrations are in `api/drizzle/` |
| `web/` | React 19 + Vite 8 web app with Tailwind 4, shadcn-style components, React Router 8 and TanStack Query. Installable as an app (PWA), with light and dark themes. The dev server runs on port 4101 and forwards `/api` to the API |
| `tools/import/` | Gmail export and history fixture scripts |
| `doc/` | Plans, specs and reference data |

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev:services` | Start Postgres (15432) and Mailpit (SMTP 11025, inbox at http://localhost:18025) |
| `pnpm dev:services:stop` | Stop them when you're not developing |
| `pnpm test` | Run all tests |
| `pnpm check` | Lint, format check, typecheck and tests, the same checks CI runs |
| `pnpm format` | Format the code with Prettier |
| `pnpm build` | Build all packages |
| `pnpm history:fixture` | Rebuild the history test fixture from `../teemate-data/history/` (the private data repository, cloned next to this one) |
| `pnpm --filter @teemate/api dev` | Run the API with reload on change (http://localhost:4100/api) |
| `pnpm --filter @teemate/api db:migrate` | Apply database migrations (build first) |
| `pnpm --filter @teemate/api db:generate --name <change>` | Create a migration after editing `api/src/db/schema.ts` |
| `pnpm --filter @teemate/api admin:create <email> [name]` | Create or promote a site admin (accounts are invite-only) |
| `pnpm --filter @teemate/api sign-in-link <email>` | Print a single-use sign-in link without sending email |

Copy `.env.example` to `.env` for local settings.

## First run

```bash
pnpm install
pnpm dev:services                                  # Postgres + Mailpit
pnpm build
pnpm --filter @teemate/api db:migrate
pnpm --filter @teemate/api admin:create you@example.com "Your Name"
pnpm --filter @teemate/api dev        # API on :4100
pnpm --filter @teemate/web dev        # web app on http://localhost:4101
```

Open http://localhost:4101, enter the admin email, and open the link from the email in Mailpit (http://localhost:18025).

The API uses port **4100** because RigTracker's container already uses 4000 on the homelab machine.

## API tests

The API tests run against a real Postgres database, `teemate_test`, which is created and migrated automatically. Start `pnpm dev:services` first. They cover:

- sign-in links: single use, expiry, never revealing whether an email exists
- sessions and logout
- CSRF protection
- rate limits
- invites
- keeping each league's data separate (non-members get 404)
- the audit log

CI runs the same tests with a Postgres service container.

## Testing against league history

`packages/shared/test/fixtures/history.json` contains 632 real matches from 2021–2026, taken from the weekly spreadsheets. Each match's recorded result comes from the change in the standings. The tests check that:

- every recorded win agrees with the net scores
- every unexplained tie fits the absence rule
- the 2024 final standings can be rebuilt from its 15 weeks of results

Rebuild the fixture with `pnpm history:fixture` after adding sheets to `../teemate-data/history/`.

## Conventions

- **Workflow (since 1.0.0):** every change goes through a pull request.
  1. Branch from an up-to-date `main`: `eh-###-<topic>`, `fix/<topic>` or `docs/<topic>`.
  2. Run `pnpm check` before each commit, then push the branch and open a PR with `gh pr create`.
  3. CI must pass, then the pull request is squash-merged (by the owner, or by Claude Code once CI passes).
  4. Deploy from `main` after the merge, using the steps in [Deployment.md](Deployment.md). The homelab is production, so take a backup first when a change touches data or migrations.
- Commit messages start with the spec ID they implement where there is one (e.g. `EH-013: ...`).
- **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`: formatting, lint, typecheck, tests and the production build.

## Production image

`Dockerfile` builds one image. It serves the API and the built web app on port 4100, applies migrations on start, and runs as the `node` user. Settings ending in `_FILE` are read from files (Docker secrets). Helpers inside the container:

```bash
docker exec <container> node dist/scripts/create-admin.js you@example.com "Your Name"
docker exec <container> node dist/scripts/sign-in-link.js you@example.com
```

Deployment to the homelab is described in [Deployment.md](Deployment.md).

