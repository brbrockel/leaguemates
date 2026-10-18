# Deployment

How TeeMate runs in the homelab, and how to update it. Since 1.0.0 (2026-10-17) this is **production**: back up before any data change or risky deploy, and confirm with the owner before writing data by hand.

## Where it runs

| | |
|---|---|
| URL | https://teemate.bhbslp.org (Cloudflare tunnel wildcard, then Traefik, then the container) |
| Stack | `teemate` on the homelab Docker Swarm; stack file `homelab-docker-linux/teemate/teemate-stack.yml` |
| Services | `teemate_teemate` (API + web app, port 4100 on the Docker network only) and `teemate_postgres` (PostgreSQL 18, internal network only) |
| Host ports | **None.** Nothing is published on the host. Traefik reaches the app over `traefik-public` |
| Data | Docker volume `teemate_prod-db`. It's kept separate from the dev volume `teemate_postgres-data`; the two must never share a name |
| Backups | Service `teemate_backup`: compressed `pg_dump` nightly at 07:00 UTC (about 3 AM Eastern), checked with `pg_restore --list`, 30 days kept in the volume `teemate_backups`. A test restore was done on 2026-10-15 and matched production exactly |
| Secrets | Swarm secrets `teemate_db_password`, `teemate_database_url` and `teemate_app_secret` (encrypts authenticator keys) `teemate_anthropic_api_key` (reads scorecard photos) and `teemate_github_token` (files "Report a problem" as issues on the public repo: a fine-grained token limited to Issues on `brbrockel/teemate`), and `teemate_vapid_private_key` (signs push notifications; its public half is `VAPID_PUBLIC_KEY` in the stack file), created once and never stored in a file |
| Photos | Volume `teemate_photos` at `/data/photos` (`PHOTOS_DIR`). Files are served only through the app, to league members |
| Email | Set in the app: profile menu → **Site settings → Email** (site admins only): who gets email (off, an allowlist, or everyone), the mail server and its password (stored encrypted with `APP_SECRET`), and the From address. **Send me a test email** checks it. Until it's saved there, the stack's `MAIL_MODE=off` applies and nothing is sent. Sending to everyone is only with the owner's consent |
| Dashboard | Heimdall tile "TeeMate" (dashboard.bhbslp.org) |
| Testing mode | Switched on and off in the app: profile menu → **Site settings** (site admins only). While on, the sign-in page offers instant sign-in with a shared access code, and new emails become users in the chosen league. It can't be on while email goes to everyone. Turn it off before go-live |

## Update to a new version

```bash
cd ~/repos/teemate
git pull && pnpm check                      # must pass
TAG=$(git rev-parse --short HEAD)           # a release uses its version instead, e.g. TAG=1.0.0
docker build --build-arg APP_VERSION=$TAG -t teemate:$TAG -t teemate:latest .
cd ~/repos/homelab-docker-linux
TEEMATE_TAG=$TAG docker stack deploy -c teemate/teemate-stack.yml teemate
docker service logs -f teemate_teemate       # expect "Migrations applied" then "listening"
```

The image is built locally; this single-node Swarm runs it without a registry. Pushing to `ghcr.io/brbrockel/teemate` needs a token with `write:packages`.

**A release:** bump `version` in the four `package.json` files, add it to [Changelog.md](Changelog.md), commit, tag `vX.Y.Z`, build and deploy with `TAG=X.Y.Z`, push with the tag and create a GitHub release from the tag. Take a backup first (below).

**Roll back:** redeploy a previous tag (`docker image ls teemate`). Database migrations only move forward, so check the migration list before rolling back across a schema change.

## Backups and restore

The nightly backup also writes `teemate-photos.tar.gz`, one current copy of all match photos, beside the database dumps. Restore it with `tar -xzf teemate-photos.tar.gz -C <photos volume>`.

```bash
B=$(docker ps -qf name=teemate_backup)
docker service logs teemate_backup --tail 5                  # "backup ok: ... (56.0K)"
docker exec $B ls -lh /backups                               # available backups
docker cp $B:/backups/teemate-2026-10-15.dump ~/              # copy one off the machine
```

**Test restore** (safe, into a scratch database):

```bash
PG=$(docker ps -qf name=teemate_postgres)
docker exec $PG psql -U teemate -c "create database restore_test"
docker exec $B sh -c 'PGPASSWORD="$(cat /run/secrets/teemate_db_password)" pg_restore -h postgres -U teemate -d restore_test --no-owner /backups/<file>.dump'
# compare counts, then:
docker exec $PG psql -U teemate -c "drop database restore_test"
```

**Real restore** (replaces production data; stop the app first):

```bash
docker service scale teemate_teemate=0
docker exec $B sh -c 'PGPASSWORD="$(cat /run/secrets/teemate_db_password)" pg_restore -h postgres -U teemate -d teemate --clean --if-exists --no-owner /backups/<file>.dump'
docker service scale teemate_teemate=1
```

The backups are on the same disk as the database. They protect against mistakes and bad data, not against losing the disk. Copying them off the machine (e.g. to Nextcloud) is still to be set up.

## Admin tasks

```bash
C=$(docker ps -qf name=teemate_teemate)
docker exec $C node dist/scripts/create-admin.js someone@example.com "Name"   # site admin
docker exec $C node dist/scripts/sign-in-link.js someone@example.com           # 24h single-use link
docker exec $(docker ps -qf name=teemate_postgres) psql -U teemate             # database shell
```

## League history

The spreadsheets in `../teemate-data/history/` (private data repository) are turned into `../teemate-data/history-export.json` and loaded into **Wednesday League** alongside its new seasons (see [HistoricalImport.md](HistoricalImport.md)). After an exporter fix, rebuild just the affected season in place:

```bash
python3 -I tools/import/history_export.py ../teemate-data/history ../teemate-data/history-export.json   # prints a per-season report
docker exec -i $(docker ps -qf name=teemate_teemate) node dist/scripts/import-history.js - --season 2025 < ../teemate-data/history-export.json
```

`--replace` rebuilds every imported season from scratch, which deletes and recreates them (and so unlinks anything attached to them, such as season photos); prefer `--season`.

- **Imported:** every season, with its final standings as published, each week's pairings, handicaps, gross totals and the result the league recorded.
- **Not in the sheets:** hole scores, tee times, foursomes, and who was absent.
- **Missing weeks:** 2018 rounds 1–7 and 2025 round 12. The emails for those weeks weren't in the export.
- **Safe to re-run:** `--replace` rebuilds the history league from scratch.

## Not done yet

- **Off-machine copies** of the nightly backups (e.g. Nextcloud).
- **Registry push and CI-built images.**
- **The league Gmail account**, before turning email on.
