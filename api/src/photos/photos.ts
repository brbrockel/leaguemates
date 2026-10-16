import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { MembershipService } from '../auth/membership.service.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { groups, photos, seasons, users, weeks } from '../db/schema.js';
import { LeagueGuard } from '../leagues/league.guard.js';

const MAX_BYTES = 15 * 1024 * 1024;
const FULL = 2048;
const THUMB = 480;

const Upload = z.object({
  groupId: z.uuid().optional(),
  kind: z.enum(['photo', 'card']).optional(),
  /** A season photo (e.g. the team photo), shown on the season page. */
  seasonId: z.uuid().optional(),
  caption: z.string().trim().max(200).optional(),
});
const ListQuery = z.object({
  groupId: z.uuid().optional(),
  /** photo (default): the albums. card: scorecard photos. */
  kind: z.enum(['photo', 'card']).default('photo'),
  /** The season's own photos and its match photos. */
  seasonId: z.uuid().optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});
const Size = z.enum(['full', 'thumb']);
const Uuid = new ParseUUIDPipe();

interface UploadFile {
  buffer: Buffer;
  size: number;
}

@Injectable()
export class PhotosService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    private readonly audit: AuditService,
    private readonly memberships: MembershipService,
  ) {}

  private dir(leagueId: string) {
    return resolve(this.config.PHOTOS_DIR, leagueId);
  }

  private file(leagueId: string, id: string, size: 'full' | 'thumb') {
    return join(this.dir(leagueId), size === 'full' ? `${id}.jpg` : `${id}_t.jpg`);
  }

  /**
   * Stores a photo. It's decoded and re-encoded as JPEG at two sizes, which turns it upright
   * and drops all metadata (including the GPS location phones add) and anything that isn't
   * an image.
   */
  async upload(
    user: SessionUser,
    leagueId: string,
    file: UploadFile | undefined,
    input: z.infer<typeof Upload>,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a photo to upload.');
    if (input.groupId) {
      const [g] = await this.db
        .select({ id: groups.id })
        .from(groups)
        .innerJoin(weeks, eq(weeks.id, groups.weekId))
        .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
        .where(and(eq(groups.id, input.groupId), eq(seasons.leagueId, leagueId)))
        .limit(1);
      if (!g) throw new NotFoundException();
    }
    if (input.seasonId) {
      const [season] = await this.db
        .select({ id: seasons.id })
        .from(seasons)
        .where(and(eq(seasons.id, input.seasonId), eq(seasons.leagueId, leagueId)))
        .limit(1);
      if (!season) throw new NotFoundException();
    }

    let full: { data: Buffer; info: OutputInfo };
    let thumb: Buffer;
    try {
      const img = sharp(file.buffer, { limitInputPixels: 80_000_000 }).rotate();
      full = await img
        .clone()
        .resize({ width: FULL, height: FULL, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      thumb = await img
        .clone()
        .resize({ width: THUMB, height: THUMB, fit: 'cover' })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new BadRequestException('That file isn’t a photo we can read. Use JPEG, PNG or WebP.');
    }

    const [row] = await this.db
      .insert(photos)
      .values({
        leagueId,
        groupId: input.groupId ?? null,
        seasonId: input.seasonId ?? null,
        kind: input.kind ?? 'photo',
        uploadedBy: user.id,
        caption: input.caption || null,
        width: full.info.width,
        height: full.info.height,
        bytes: full.data.length,
      })
      .returning();
    try {
      await mkdir(this.dir(leagueId), { recursive: true });
      await writeFile(this.file(leagueId, row!.id, 'full'), full.data);
      await writeFile(this.file(leagueId, row!.id, 'thumb'), thumb);
    } catch (e) {
      await this.db.delete(photos).where(eq(photos.id, row!.id));
      throw e;
    }
    await this.audit.record({
      leagueId,
      actorUserId: user.id,
      action: 'photo.upload',
      entityType: 'photo',
      entityId: row!.id,
      after: { groupId: row!.groupId, seasonId: row!.seasonId, caption: row!.caption },
    });
    return (await this.list(user, leagueId, { limit: 1, id: row!.id }))[0];
  }

  async list(
    user: SessionUser,
    leagueId: string,
    q: {
      kind?: 'photo' | 'card' | undefined;
      groupId?: string | undefined;
      seasonId?: string | undefined;
      before?: string | undefined;
      limit: number;
      id?: string;
    },
  ) {
    const isAdmin = (await this.memberships.roleIn(user, leagueId)) === 'admin';
    const rows = await this.db
      .select({
        id: photos.id,
        groupId: photos.groupId,
        caption: photos.caption,
        kind: photos.kind,
        width: photos.width,
        height: photos.height,
        createdAt: photos.createdAt,
        uploadedBy: photos.uploadedBy,
        uploader: users.name,
        uploaderEmail: users.email,
        date: weeks.date,
        weekId: weeks.id,
        seasonId: sql<string | null>`coalesce(${photos.seasonId}, ${weeks.seasonId})`,
        seasonName: seasons.name,
        teamPhoto: sql<boolean>`${photos.seasonId} is not null`,
        round: weeks.round,
      })
      .from(photos)
      .leftJoin(users, eq(users.id, photos.uploadedBy))
      .leftJoin(groups, eq(groups.id, photos.groupId))
      .leftJoin(weeks, eq(weeks.id, groups.weekId))
      .leftJoin(seasons, eq(seasons.id, sql`coalesce(${photos.seasonId}, ${weeks.seasonId})`))
      .where(
        and(
          eq(photos.leagueId, leagueId),
          q.id ? eq(photos.id, q.id) : eq(photos.kind, q.kind ?? 'photo'),
          q.groupId ? eq(photos.groupId, q.groupId) : undefined,
          q.seasonId
            ? or(eq(photos.seasonId, q.seasonId), eq(weeks.seasonId, q.seasonId))
            : undefined,
          q.before ? lt(photos.createdAt, new Date(q.before)) : undefined,
        ),
      )
      .orderBy(desc(photos.createdAt))
      .limit(q.limit);
    return rows.map(({ uploadedBy, uploaderEmail, ...r }) => ({
      ...r,
      uploader: r.uploader ?? uploaderEmail?.split('@')[0] ?? null,
      canDelete: isAdmin || uploadedBy === user.id,
    }));
  }

  async open(leagueId: string, id: string, size: 'full' | 'thumb') {
    const [p] = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.id, id), eq(photos.leagueId, leagueId)))
      .limit(1);
    if (!p) throw new NotFoundException();
    const stream = createReadStream(this.file(leagueId, id, size));
    return new StreamableFile(stream, { type: 'image/jpeg' });
  }

  async remove(user: SessionUser, leagueId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(photos)
      .where(and(eq(photos.id, id), eq(photos.leagueId, leagueId)))
      .limit(1);
    if (!p) throw new NotFoundException();
    const isAdmin = (await this.memberships.roleIn(user, leagueId)) === 'admin';
    if (!isAdmin && p.uploadedBy !== user.id)
      throw new ForbiddenException('Only the person who added a photo or an admin can delete it.');
    await this.db.delete(photos).where(eq(photos.id, id));
    await rm(this.file(leagueId, id, 'full'), { force: true });
    await rm(this.file(leagueId, id, 'thumb'), { force: true });
    await this.audit.record({
      leagueId,
      actorUserId: user.id,
      action: 'photo.delete',
      entityType: 'photo',
      entityId: id,
      before: { groupId: p.groupId, caption: p.caption },
    });
    return { ok: true };
  }
}

/** /leagues/:leagueId/photos: members only (LeagueGuard), files streamed through the API. */
@Controller('leagues/:leagueId/photos')
@UseGuards(LeagueGuard)
export class PhotosController {
  constructor(private readonly svc: PhotosService) {}

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    return this.svc.list(user, leagueId, q);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @UploadedFile() file: UploadFile | undefined,
    @Body(new ZodPipe(Upload)) body: z.infer<typeof Upload>,
  ) {
    if (file && file.size > MAX_BYTES) throw new PayloadTooLargeException();
    return this.svc.upload(user, leagueId, file, body);
  }

  @Get(':id/:size')
  file(
    @Param('leagueId') leagueId: string,
    @Param('id', Uuid) id: string,
    @Param('size', new ZodPipe(Size)) size: z.infer<typeof Size>,
  ) {
    return this.svc.open(leagueId, id, size);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('id', Uuid) id: string,
  ) {
    return this.svc.remove(user, leagueId, id);
  }
}

@Module({
  controllers: [PhotosController],
  providers: [PhotosService, LeagueGuard],
  exports: [PhotosService],
})
export class PhotosModule {}
