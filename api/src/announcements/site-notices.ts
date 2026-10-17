import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, GuestOk, SiteAdminOnly, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { DB, type Database } from '../db/db.js';
import { siteNoticeReads, siteNotices, users } from '../db/schema.js';
import { BannerDays, DAY } from './banners.js';

const Fields = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(4000),
  /** Nobody can dismiss it; it shows until it expires. */
  mustSee: z.boolean(),
  bannerDays: BannerDays,
});
const mustExpire = (n: { mustSee?: boolean; bannerDays?: number | null }) =>
  !n.mustSee || (typeof n.bannerDays === 'number' && n.bannerDays > 0);
const MUST_EXPIRE = { message: 'A notice nobody can dismiss needs an end date.' };
const New = Fields.extend({
  body: Fields.shape.body.default(''),
  mustSee: Fields.shape.mustSee.default(false),
  bannerDays: BannerDays.default(7),
}).refine(mustExpire, MUST_EXPIRE);
const Edit = Fields.partial();
const Ids = z.object({ ids: z.array(z.uuid()).min(1).max(100) });
const Uuid = new ParseUUIDPipe();

const expiry = (days: number | null) => (days === null ? null : new Date(Date.now() + days * DAY));

/**
 * Notices from site admins to everyone using TeeMate, shown as a banner on every page (guests
 * too) until they expire or each person dismisses them; "must see" ones can't be dismissed.
 */
@Injectable()
export class SiteNoticesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(user: SessionUser) {
    const rows = await this.db
      .select({
        n: siteNotices,
        author: users.name,
        readAt: siteNoticeReads.readAt,
        dismissedAt: siteNoticeReads.dismissedAt,
      })
      .from(siteNotices)
      .leftJoin(users, eq(users.id, siteNotices.authorUserId))
      .leftJoin(
        siteNoticeReads,
        and(eq(siteNoticeReads.noticeId, siteNotices.id), eq(siteNoticeReads.userId, user.id)),
      )
      .orderBy(desc(siteNotices.createdAt))
      .limit(20);
    const now = new Date();
    return rows.map((r) => {
      const changed = r.n.updatedAt ?? r.n.createdAt;
      const read = Boolean(r.readAt && r.readAt >= changed);
      const dismissed = Boolean(r.dismissedAt && r.dismissedAt >= changed);
      const active = !r.n.expiresAt || now < r.n.expiresAt;
      return {
        id: r.n.id,
        title: r.n.title,
        body: r.n.body,
        mustSee: r.n.mustSee,
        createdAt: r.n.createdAt,
        updatedAt: r.n.updatedAt,
        author: r.author,
        read,
        dismissed,
        banner: active && (r.n.mustSee || !dismissed),
        dismissible: !r.n.mustSee,
        bannerUntil: r.n.expiresAt?.toISOString() ?? null,
      };
    });
  }

  async mark(user: SessionUser, ids: string[], how: 'read' | 'dismissed') {
    const found = await this.db
      .select({ id: siteNotices.id })
      .from(siteNotices)
      .where(inArray(siteNotices.id, ids));
    if (!found.length) return { ok: true };
    const now = new Date();
    await this.db
      .insert(siteNoticeReads)
      .values(
        found.map((f) => ({
          noticeId: f.id,
          userId: user.id,
          readAt: now,
          dismissedAt: how === 'dismissed' ? now : null,
        })),
      )
      .onConflictDoUpdate({
        target: [siteNoticeReads.noticeId, siteNoticeReads.userId],
        set: how === 'dismissed' ? { readAt: now, dismissedAt: now } : { readAt: now },
      });
    return { ok: true };
  }

  private async find(id: string) {
    const [n] = await this.db.select().from(siteNotices).where(eq(siteNotices.id, id)).limit(1);
    if (!n) throw new NotFoundException();
    return n;
  }

  async create(actor: SessionUser, input: z.infer<typeof New>) {
    const { bannerDays, ...fields } = input;
    const [n] = await this.db
      .insert(siteNotices)
      .values({ ...fields, expiresAt: expiry(bannerDays), authorUserId: actor.id })
      .returning();
    await this.audit.record({
      actorUserId: actor.id,
      action: 'site_notice.create',
      entityType: 'site_notice',
      entityId: n!.id,
      after: { ...fields, expiresAt: n!.expiresAt },
    });
    return n!;
  }

  async update(actor: SessionUser, id: string, input: z.infer<typeof Edit>) {
    const before = await this.find(id);
    const { bannerDays, ...fields } = input;
    const changes = {
      ...fields,
      ...(bannerDays === undefined ? {} : { expiresAt: expiry(bannerDays) }),
    };
    const mustSee = changes.mustSee ?? before.mustSee;
    const expiresAt = 'expiresAt' in changes ? changes.expiresAt : before.expiresAt;
    if (mustSee && !expiresAt) throw new BadRequestException(MUST_EXPIRE.message);
    const [n] = await this.db
      .update(siteNotices)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(siteNotices.id, id))
      .returning();
    await this.audit.record({
      actorUserId: actor.id,
      action: 'site_notice.update',
      entityType: 'site_notice',
      entityId: id,
      before: {
        title: before.title,
        body: before.body,
        mustSee: before.mustSee,
        expiresAt: before.expiresAt,
      },
      after: changes,
    });
    return n!;
  }

  async remove(actor: SessionUser, id: string) {
    const before = await this.find(id);
    await this.db.delete(siteNotices).where(eq(siteNotices.id, id));
    await this.audit.record({
      actorUserId: actor.id,
      action: 'site_notice.delete',
      entityType: 'site_notice',
      entityId: id,
      before: { title: before.title, body: before.body },
    });
    return { ok: true };
  }
}

@Controller('notices/site')
export class SiteNoticesController {
  constructor(private readonly svc: SiteNoticesService) {}

  @Get()
  @GuestOk()
  list(@CurrentUser() user: SessionUser) {
    return this.svc.list(user);
  }

  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() user: SessionUser, @Body(new ZodPipe(Ids)) body: z.infer<typeof Ids>) {
    return this.svc.mark(user, body.ids, 'read');
  }

  @Post('dismiss')
  @HttpCode(200)
  dismiss(@CurrentUser() user: SessionUser, @Body(new ZodPipe(Ids)) body: z.infer<typeof Ids>) {
    return this.svc.mark(user, body.ids, 'dismissed');
  }

  @Post()
  @SiteAdminOnly()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(New)) body: z.infer<typeof New>) {
    return this.svc.create(user, body);
  }

  @Patch(':id')
  @SiteAdminOnly()
  update(
    @CurrentUser() user: SessionUser,
    @Param('id', Uuid) id: string,
    @Body(new ZodPipe(Edit)) body: z.infer<typeof Edit>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  @SiteAdminOnly()
  remove(@CurrentUser() user: SessionUser, @Param('id', Uuid) id: string) {
    return this.svc.remove(user, id);
  }
}
