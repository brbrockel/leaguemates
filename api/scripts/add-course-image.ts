/**
 * Adds a picture of a course's printed scorecard, e.g. the club's published card:
 *
 *   pnpm --filter @teemate/api course-image "Timberlin Golf Club" front.jpg back.jpg
 *   docker exec <container> node dist/scripts/add-course-image.js "Timberlin Golf Club" /tmp/card.jpg
 */
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { storeCourseImage } from '../src/courses/course-images.js';
import { createDb, createPool } from '../src/db/db.js';
import { courses } from '../src/db/schema.js';

const [courseName, ...files] = process.argv.slice(2);
if (!courseName || files.length === 0) {
  console.error('Usage: add-course-image "<course name>" <image> [<image> ...]');
  process.exit(1);
}
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
try {
  const [course] = await db.select().from(courses).where(eq(courses.name, courseName)).limit(1);
  if (!course) {
    console.error(`No course named "${courseName}".`);
    process.exitCode = 1;
  } else {
    for (const f of files) {
      const row = await storeCourseImage(db, config.PHOTOS_DIR, course.id, await readFile(f), null);
      console.log(`Added ${f} to ${course.name} (${row.width}×${row.height})`);
    }
  }
} finally {
  await pool.end();
}
