/**
 * Loads researched course cards (JSON) into the course list: each nine as a layout with par,
 * stroke index and yards, the club's website, and pictures of its printed card.
 *
 *   node dist/scripts/import-course-cards.js cards/group-a.json [more.json ...] [--images]
 *
 * JSON: [{ course, city, website, lat, lng, cardFiles: [paths], layouts: [{ name, tees, holes }] }]
 * - Courses are matched by name (added if new). Timberlin is never changed.
 * - A nine with the same name is replaced only while no scorecard uses it.
 * - Nines that fail the checks (9 or 18 holes, par 3-6, each hole number and stroke index
 *   used once) are skipped and reported.
 * - --images adds the card pictures (JPEG/PNG/WebP) to courses that have none yet. A card
 *   file is looked up at its path, else next to the JSON file as <folder>/<file>.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { storeCourseImage } from '../src/courses/course-images.js';
import { createDb, createPool } from '../src/db/db.js';
import { courseImages, courses, holes, layouts, scorecards } from '../src/db/schema.js';

interface Hole {
  number: number;
  par: number | null;
  strokeIndex: number | null;
  yards: number | null;
}
interface Entry {
  course: string;
  city?: string | null;
  website?: string | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  cardFiles?: string[];
  layouts?: { name: string; tees: string | null; holes: Hole[] }[];
}

const HOME = 'Timberlin Golf Club';
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: import-course-cards <cards.json> [...] [--images]');
  process.exit(1);
}

function problem(hs: Hole[]): string | null {
  if (hs.length !== 9 && hs.length !== 18) return `${hs.length} holes`;
  if (hs.some((h) => h.par === null || h.par < 3 || h.par > 6))
    return 'a par is missing or not 3-6';
  if (hs.some((h) => h.strokeIndex === null || h.strokeIndex < 1 || h.strokeIndex > 18))
    return 'a stroke index is missing or not 1-18';
  if (new Set(hs.map((h) => h.number)).size !== hs.length) return 'a hole number is repeated';
  if (new Set(hs.map((h) => h.strokeIndex)).size !== hs.length) return 'a stroke index is repeated';
  return null;
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
try {
  for (const file of files) {
    const entries = JSON.parse(readFileSync(file, 'utf8')) as Entry[];
    for (const e of entries) {
      if (e.course === HOME) {
        // The home course only takes a location; its card is kept as entered.
        if (typeof e.lat === 'number' && typeof e.lng === 'number')
          await db.update(courses).set({ lat: e.lat, lng: e.lng }).where(eq(courses.name, HOME));
        continue;
      }
      let [course] = await db
        .select()
        .from(courses)
        .where(sql`lower(${courses.name}) = lower(${e.course})`)
        .limit(1);
      if (!course)
        [course] = await db
          .insert(courses)
          .values({ name: e.course, city: e.city ?? null, state: 'CT', notes: e.notes ?? null })
          .returning();
      if (e.website)
        await db.update(courses).set({ website: e.website }).where(eq(courses.id, course!.id));
      if (typeof e.lat === 'number' && typeof e.lng === 'number')
        await db.update(courses).set({ lat: e.lat, lng: e.lng }).where(eq(courses.id, course!.id));

      const report: string[] = [];
      for (const [i, l] of (e.layouts ?? []).entries()) {
        const why = problem(l.holes);
        if (why) {
          report.push(`skipped ${l.name} (${why})`);
          continue;
        }
        const [existing] = await db
          .select()
          .from(layouts)
          .where(and(eq(layouts.courseId, course!.id), eq(layouts.name, l.name)))
          .limit(1);
        if (existing) {
          const [used] = await db
            .select({ id: scorecards.id })
            .from(scorecards)
            .where(eq(scorecards.layoutId, existing.id))
            .limit(1);
          if (used) {
            report.push(`kept ${l.name} (scorecards use it)`);
            continue;
          }
          await db.delete(layouts).where(eq(layouts.id, existing.id));
        }
        await db.transaction(async (tx) => {
          const [layout] = await tx
            .insert(layouts)
            .values({ courseId: course!.id, name: l.name, tees: l.tees ?? 'White', sortOrder: i })
            .returning();
          await tx.insert(holes).values(
            l.holes.map((h) => ({
              layoutId: layout!.id,
              number: h.number,
              par: h.par!,
              strokeIndex: h.strokeIndex!,
              yards: h.yards,
            })),
          );
        });
        report.push(`${l.name} (par ${l.holes.reduce((s, h) => s + h.par!, 0)})`);
      }

      if (args.includes('--images') && e.cardFiles?.length) {
        const [has] = await db
          .select({ id: courseImages.id })
          .from(courseImages)
          .where(eq(courseImages.courseId, course!.id))
          .limit(1);
        if (has) report.push('card pictures already there');
        else
          for (const f of e.cardFiles) {
            const local = existsSync(f)
              ? f
              : join(dirname(file), basename(dirname(f)), basename(f));
            if (!/\.(jpe?g|png|webp)$/i.test(local) || !existsSync(local)) {
              report.push(`no picture from ${basename(f)}`);
              continue;
            }
            await storeCourseImage(db, config.PHOTOS_DIR, course!.id, readFileSync(local), null);
            report.push(`picture ${basename(f)}`);
          }
      }
      console.log(`${course!.name}: ${report.join('; ') || 'no card data'}`);
    }
  }
} finally {
  await pool.end();
}
