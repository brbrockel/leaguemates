import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import type { Database } from '../db/db.js';
import { courseImages } from '../db/schema.js';

/** Where a course's card images are kept (inside PHOTOS_DIR, never served directly). */
export const courseImagePath = (photosDir: string, id: string) =>
  join(resolve(photosDir, 'courses'), `${id}.jpg`);

/**
 * Stores a picture of a course's scorecard: re-encoded as JPEG (metadata dropped), kept
 * sharp enough to read the small print (up to 2400 px wide).
 */
export async function storeCourseImage(
  db: Database,
  photosDir: string,
  courseId: string,
  file: Buffer,
  caption: string | null,
) {
  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(file, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new BadRequestException('That file isn’t an image we can read. Use JPEG, PNG or WebP.');
  }
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${courseImages.sortOrder}) + 1, 0)::int` })
    .from(courseImages)
    .where(eq(courseImages.courseId, courseId));
  const [row] = await db
    .insert(courseImages)
    .values({ courseId, caption, sortOrder: next, width: out.info.width, height: out.info.height })
    .returning();
  try {
    await mkdir(resolve(photosDir, 'courses'), { recursive: true });
    await writeFile(courseImagePath(photosDir, row!.id), out.data);
  } catch (e) {
    await db.delete(courseImages).where(eq(courseImages.id, row!.id));
    throw e;
  }
  return row!;
}

export async function removeCourseImageFile(photosDir: string, id: string) {
  await rm(courseImagePath(photosDir, id), { force: true });
}
