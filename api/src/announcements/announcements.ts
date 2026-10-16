import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { DB, type Database } from '../db/db.js';
import { announcements, users } from '../db/schema.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';

const Announcement = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(4000).default(''),
  pinned: z.boolean().default(false),
});
const Edit = Announcement.partial();
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const Uuid = new ParseUUIDPipe();

/** League notices posted by admins and shown in the app. Nothing here sends email. */
@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(leagueId: string, limit: number) {
    return this.db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        pinned: announcements.pinned,
        createdAt: announcements.createdAt,
        updatedAt: announcements.updatedAt,
        author: users.name,
      })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.authorUserId))
      .where(eq(announcements.leagueId, leagueId))
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
      .limit(limit);
  }

  private async find(leagueId: string, id: string) {
    const [a] = await this.db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.leagueId, leagueId)))
      .limit(1);
    if (!a) throw new NotFoundException();
    return a;
  }

  async create(actor: SessionUser, leagueId: string, input: z.infer<typeof Announcement>) {
    const [a] = await this.db
      .insert(announcements)
      .values({ ...input, leagueId, authorUserId: actor.id })
      .returning();
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: a!.id,
      after: input,
    });
    return a;
  }

  async update(actor: SessionUser, leagueId: string, id: string, input: z.infer<typeof Edit>) {
    const before = await this.find(leagueId, id);
    const [a] = await this.db
      .update(announcements)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'announcement.update',
      entityType: 'announcement',
      entityId: id,
      before: { title: before.title, body: before.body, pinned: before.pinned },
      after: input,
    });
    return a;
  }

  async remove(actor: SessionUser, leagueId: string, id: string) {
    const before = await this.find(leagueId, id);
    await this.db.delete(announcements).where(eq(announcements.id, id));
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'announcement.delete',
      entityType: 'announcement',
      entityId: id,
      before: { title: before.title, body: before.body },
    });
    return { ok: true };
  }
}

@Controller('leagues/:leagueId/announcements')
@UseGuards(LeagueGuard)
export class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get()
  list(
    @Param('leagueId') leagueId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    return this.svc.list(leagueId, q.limit);
  }

  @Post()
  @RequireLeagueRole('admin')
  create(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(Announcement)) body: z.infer<typeof Announcement>,
  ) {
    return this.svc.create(user, leagueId, body);
  }

  @Patch(':id')
  @RequireLeagueRole('admin')
  update(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(Edit)) body: z.infer<typeof Edit>,
  ) {
    return this.svc.update(user, leagueId, id, body);
  }

  @Delete(':id')
  @RequireLeagueRole('admin')
  remove(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('id', Uuid) id: string,
  ) {
    return this.svc.remove(user, leagueId, id);
  }
}

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, LeagueGuard],
})
export class AnnouncementsModule {}
