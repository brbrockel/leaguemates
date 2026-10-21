import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { StreamableFile } from '@nestjs/common';
import type { CardGrid } from '@teemate/shared';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { SessionUser } from '../auth/decorators.js';
import { AuditService } from '../audit/audit.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import {
  cardGrids,
  courseImages,
  courses,
  holes,
  layouts,
  scorecards,
  weeks,
} from '../db/schema.js';
import { courseImagePath, removeCourseImageFile, storeCourseImage } from './course-images.js';

export interface HoleInput {
  number: number;
  par: number;
  strokeIndex: number;
  yards?: number | null | undefined;
}
export interface LayoutInput {
  name: string;
  tees: string;
  holes: HoleInput[];
}
export interface CourseInput {
  name: string;
  city?: string | null | undefined;
  state?: string | null | undefined;
  notes?: string | null | undefined;
  website?: string | null | undefined;
  pinned?: boolean | undefined;
}

/** Holes must be numbered once each, with stroke indexes used once each. */
function checkHoles(hs: HoleInput[]) {
  const unique = (xs: number[]) => new Set(xs).size === xs.length;
  if (!unique(hs.map((h) => h.number)))
    throw new BadRequestException('Each hole number can be used once.');
  if (!unique(hs.map((h) => h.strokeIndex)))
    throw new BadRequestException('Each stroke index can be used once.');
}

/** Par and stroke index per hole: the parts that decide results. */
const scoringKey = (hs: { number: number; par: number; strokeIndex: number }[]) =>
  [...hs]
    .sort((a, b) => a.number - b.number)
    .map((h) => `${h.number}:${h.par}:${h.strokeIndex}`)
    .join(',');

@Injectable()
export class CoursesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    private readonly audit: AuditService,
  ) {}

  /** Every course with its layouts and holes. `cards` counts the scorecards that used a layout. */
  async list() {
    const cs = await this.db
      .select()
      .from(courses)
      .orderBy(desc(courses.pinned), asc(courses.name));
    const ls = await this.db
      .select()
      .from(layouts)
      .orderBy(asc(layouts.sortOrder), asc(layouts.createdAt));
    const hs = await this.db.select().from(holes).orderBy(asc(holes.number));
    const used = await this.db
      .select({ layoutId: scorecards.layoutId, n: sql<number>`count(*)::int` })
      .from(scorecards)
      .groupBy(scorecards.layoutId);
    const cards = new Map(used.map((u) => [u.layoutId, u.n]));
    const grids = new Map(
      (
        await this.db
          .select({
            layoutId: cardGrids.layoutId,
            imageId: cardGrids.imageId,
            grid: cardGrids.grid,
          })
          .from(cardGrids)
      ).map(({ layoutId, ...g }) => [layoutId, g]),
    );
    const images = await this.db
      .select({
        id: courseImages.id,
        courseId: courseImages.courseId,
        caption: courseImages.caption,
        width: courseImages.width,
        height: courseImages.height,
      })
      .from(courseImages)
      .orderBy(asc(courseImages.sortOrder));
    return cs.map((c) => ({
      ...c,
      images: images.filter((i) => i.courseId === c.id).map(({ courseId: _, ...i }) => i),
      layouts: ls
        .filter((l) => l.courseId === c.id)
        .map((l) => {
          const lh = hs.filter((h) => h.layoutId === l.id);
          return {
            ...l,
            par: lh.reduce((s, h) => s + h.par, 0),
            yards: lh.every((h) => h.yards !== null) ? lh.reduce((s, h) => s + h.yards!, 0) : null,
            cards: cards.get(l.id) ?? 0,
            cardGrid: grids.get(l.id) ?? null,
            holes: lh,
          };
        }),
    }));
  }

  async get(courseId: string) {
    const course = (await this.list()).find((c) => c.id === courseId);
    if (!course) throw new NotFoundException();
    return course;
  }

  /** One default course: pinning a course unpins the others. */
  private async unpinOthers(courseId?: string) {
    await this.db
      .update(courses)
      .set({ pinned: false })
      .where(courseId ? ne(courses.id, courseId) : undefined);
  }

  async create(actor: SessionUser, input: CourseInput) {
    if (input.pinned) await this.unpinOthers();
    const [course] = await this.db
      .insert(courses)
      .values({
        name: input.name,
        city: input.city ?? null,
        state: input.state ?? null,
        notes: input.notes ?? null,
        website: input.website ?? null,
        pinned: input.pinned ?? false,
      })
      .returning();
    await this.audit.record({
      actorUserId: actor.id,
      action: 'course.create',
      entityType: 'course',
      entityId: course!.id,
      after: input,
    });
    return this.get(course!.id);
  }

  async update(actor: SessionUser, courseId: string, input: CourseInput) {
    const [before] = await this.db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!before) throw new NotFoundException();
    if (input.pinned) await this.unpinOthers(courseId);
    await this.db
      .update(courses)
      .set({
        name: input.name,
        city: input.city ?? null,
        state: input.state ?? null,
        notes: input.notes ?? null,
        website: input.website ?? null,
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      })
      .where(eq(courses.id, courseId));
    await this.audit.record({
      actorUserId: actor.id,
      action: 'course.update',
      entityType: 'course',
      entityId: courseId,
      before: {
        name: before.name,
        city: before.city,
        state: before.state,
        notes: before.notes,
        pinned: before.pinned,
      },
      after: input,
    });
    return this.get(courseId);
  }

  private async layout(courseId: string, layoutId: string) {
    const [l] = await this.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.id, layoutId), eq(layouts.courseId, courseId)))
      .limit(1);
    if (!l) throw new NotFoundException();
    return l;
  }

  private async cardsUsing(layoutId: string) {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(scorecards)
      .where(eq(scorecards.layoutId, layoutId));
    return r?.n ?? 0;
  }

  /**
   * Adds a layout. With `replaces`, it becomes the new version of that layout: it takes its
   * place in the rotation and on weeks not played yet, and the old one is retired.
   */
  async addLayout(
    actor: SessionUser,
    courseId: string,
    input: LayoutInput & { replaces?: string | undefined },
  ) {
    checkHoles(input.holes);
    const [course] = await this.db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course) throw new NotFoundException();
    const old = input.replaces ? await this.layout(courseId, input.replaces) : null;
    if (old?.retiredAt) throw new ConflictException('That layout was already replaced.');

    const id = await this.db.transaction(async (tx) => {
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${layouts.sortOrder}) + 1, 0)::int` })
        .from(layouts)
        .where(eq(layouts.courseId, courseId));
      const [l] = await tx
        .insert(layouts)
        .values({
          courseId,
          name: input.name,
          tees: input.tees,
          sortOrder: old ? old.sortOrder : next,
        })
        .returning();
      await tx
        .insert(holes)
        .values(input.holes.map((h) => ({ ...h, yards: h.yards ?? null, layoutId: l!.id })));
      if (old) {
        await tx.update(layouts).set({ retiredAt: new Date() }).where(eq(layouts.id, old.id));
        // The new version is on the same printed card.
        const [g] = await tx.select().from(cardGrids).where(eq(cardGrids.layoutId, old.id));
        if (g)
          await tx.insert(cardGrids).values({ layoutId: l!.id, imageId: g.imageId, grid: g.grid });
        await tx
          .update(weeks)
          .set({ layoutId: l!.id })
          .where(and(eq(weeks.layoutId, old.id), eq(weeks.status, 'scheduled')));
      }
      await this.audit.record(
        {
          actorUserId: actor.id,
          action: old ? 'layout.replace' : 'layout.create',
          entityType: 'layout',
          entityId: l!.id,
          before: old ? { id: old.id, name: old.name } : null,
          after: input,
        },
        tx,
      );
      return l!.id;
    });
    return { course: await this.get(courseId), layoutId: id };
  }

  /**
   * Edits a layout. Names, tees and yardages can always change; par and stroke index only
   * while no scorecard uses it, because they decide results already recorded.
   */
  async updateLayout(actor: SessionUser, courseId: string, layoutId: string, input: LayoutInput) {
    checkHoles(input.holes);
    const l = await this.layout(courseId, layoutId);
    const current = await this.db.select().from(holes).where(eq(holes.layoutId, layoutId));
    const scoringChanged = scoringKey(current) !== scoringKey(input.holes);
    if (scoringChanged) {
      const n = await this.cardsUsing(layoutId);
      if (n > 0)
        throw new ConflictException(
          `${n} scorecard${n === 1 ? ' uses' : 's use'} this layout, so par and stroke index can't change. Save it as a new version instead.`,
        );
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(layouts)
        .set({ name: input.name, tees: input.tees })
        .where(eq(layouts.id, layoutId));
      await tx.delete(holes).where(eq(holes.layoutId, layoutId));
      await tx
        .insert(holes)
        .values(input.holes.map((h) => ({ ...h, yards: h.yards ?? null, layoutId })));
      await this.audit.record(
        {
          actorUserId: actor.id,
          action: 'layout.update',
          entityType: 'layout',
          entityId: layoutId,
          before: { name: l.name, tees: l.tees, holes: current.map(({ layoutId: _, ...h }) => h) },
          after: input,
        },
        tx,
      );
    });
    return this.get(courseId);
  }

  /** Removes a layout nothing has used: no scorecards and no scheduled weeks. */
  async removeLayout(actor: SessionUser, courseId: string, layoutId: string) {
    const l = await this.layout(courseId, layoutId);
    const [w] = await this.db
      .select({ id: weeks.id })
      .from(weeks)
      .where(eq(weeks.layoutId, layoutId))
      .limit(1);
    if (w || (await this.cardsUsing(layoutId)) > 0)
      throw new ConflictException(
        'This layout is on a schedule or a scorecard, so it can only be replaced.',
      );
    await this.db.delete(layouts).where(eq(layouts.id, layoutId));
    await this.audit.record({
      actorUserId: actor.id,
      action: 'layout.delete',
      entityType: 'layout',
      entityId: layoutId,
      before: { name: l.name, tees: l.tees },
    });
    return this.get(courseId);
  }

  /**
   * Saves where a layout's scores go on one of the course's card pictures (EH-019), or with
   * `null` removes it.
   */
  async setCardGrid(
    actor: SessionUser,
    courseId: string,
    layoutId: string,
    input: { imageId: string; grid: CardGrid } | null,
  ) {
    await this.layout(courseId, layoutId);
    const [before] = await this.db.select().from(cardGrids).where(eq(cardGrids.layoutId, layoutId));
    if (input) {
      const [img] = await this.db
        .select({ id: courseImages.id })
        .from(courseImages)
        .where(and(eq(courseImages.id, input.imageId), eq(courseImages.courseId, courseId)))
        .limit(1);
      if (!img) throw new BadRequestException("That picture isn't one of this course's.");
      await this.db
        .insert(cardGrids)
        .values({ layoutId, ...input })
        .onConflictDoUpdate({
          target: cardGrids.layoutId,
          set: { ...input, updatedAt: new Date() },
        });
    } else {
      await this.db.delete(cardGrids).where(eq(cardGrids.layoutId, layoutId));
    }
    await this.audit.record({
      actorUserId: actor.id,
      action: input ? 'layout.card_grid' : 'layout.card_grid_delete',
      entityType: 'layout',
      entityId: layoutId,
      before: before ? { imageId: before.imageId, grid: before.grid } : null,
      after: input,
    });
    return this.get(courseId);
  }

  /** Adds a picture of the course's printed scorecard. */
  async addImage(
    actor: SessionUser,
    courseId: string,
    file: Buffer | undefined,
    caption: string | null,
  ) {
    if (!file?.length) throw new BadRequestException('Choose an image to upload.');
    await this.get(courseId);
    const row = await storeCourseImage(this.db, this.config.PHOTOS_DIR, courseId, file, caption);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'course.image',
      entityType: 'course',
      entityId: courseId,
      after: { imageId: row.id, caption },
    });
    return this.get(courseId);
  }

  async openImage(courseId: string, imageId: string) {
    const [img] = await this.db
      .select({ id: courseImages.id })
      .from(courseImages)
      .where(and(eq(courseImages.id, imageId), eq(courseImages.courseId, courseId)))
      .limit(1);
    if (!img) throw new NotFoundException();
    return new StreamableFile(createReadStream(courseImagePath(this.config.PHOTOS_DIR, img.id)), {
      type: 'image/jpeg',
    });
  }

  async removeImage(actor: SessionUser, courseId: string, imageId: string) {
    const [img] = await this.db
      .select()
      .from(courseImages)
      .where(and(eq(courseImages.id, imageId), eq(courseImages.courseId, courseId)))
      .limit(1);
    if (!img) throw new NotFoundException();
    await this.db.delete(courseImages).where(eq(courseImages.id, imageId));
    await removeCourseImageFile(this.config.PHOTOS_DIR, imageId);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'course.image_delete',
      entityType: 'course',
      entityId: courseId,
      before: { imageId, caption: img.caption },
    });
    return this.get(courseId);
  }
}
