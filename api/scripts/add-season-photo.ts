/**
 * Adds a photo (e.g. the team photo) to one or more seasons of a league, the same way an
 * upload in the app does: re-encoded, metadata (including GPS) removed, members only.
 *
 *   node dist/scripts/add-season-photo.js <league-slug> <photo> <season> [<season> ...] [--caption "Text"]
 *   docker exec <container> node dist/scripts/add-season-photo.js wednesday-league /tmp/team.jpg 2024 2025 --caption "The 2024 team"
 */
import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import type { SessionUser } from '../src/auth/decorators.js';
import { loadConfig } from '../src/config.js';
import { DB, type Database } from '../src/db/db.js';
import { leagues, seasons, users } from '../src/db/schema.js';
import { PhotosService } from '../src/photos/photos.js';

const args = process.argv.slice(2);
const ci = args.indexOf('--caption');
const caption = ci >= 0 ? args[ci + 1] : undefined;
const [slug, file, ...seasonNames] = args.filter((_, i) => ci < 0 || (i !== ci && i !== ci + 1));
if (!slug || !file || seasonNames.length === 0) {
  console.error('Usage: add-season-photo <league-slug> <photo> <season> [...] [--caption "Text"]');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule.with(loadConfig()), {
  logger: ['error'],
});
try {
  const db = app.get<Database>(DB);
  const photos = app.get(PhotosService);
  const [admin] = await db.select().from(users).where(eq(users.isSiteAdmin, true)).limit(1);
  if (!admin) throw new Error('No site admin to act as.');
  const actor: SessionUser = { ...admin, sessionId: 'script', csrfToken: '' };
  const [league] = await db.select().from(leagues).where(eq(leagues.slug, slug)).limit(1);
  if (!league) throw new Error(`No league "${slug}".`);
  const buffer = await readFile(file);
  for (const name of seasonNames) {
    const [season] = await db
      .select()
      .from(seasons)
      .where(and(eq(seasons.leagueId, league.id), eq(seasons.name, name)))
      .limit(1);
    if (!season) {
      console.error(`No season "${name}" in ${league.name}; skipped.`);
      continue;
    }
    const p = await photos.upload(
      actor,
      league.id,
      { buffer, size: buffer.length },
      {
        seasonId: season.id,
        ...(caption ? { caption } : {}),
      },
    );
    console.log(`Added to ${league.name} ${name}: ${p!.width}×${p!.height}`);
  }
} finally {
  await app.close();
}
