import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { MembershipService } from '../auth/membership.service.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { todayInLeague } from '../common/league-time.js';
import {
  announcementReads,
  announcements,
  groups,
  leagueMemberships,
  matches,
  players,
  seasons,
  users,
  weeks,
} from '../db/schema.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';
import { MAILER, MailSettingsService, type Mailer } from '../mail/mailer.js';
import { PushService } from '../push/push.js';
import { BannerDays, bannerFields, bannerState } from './banners.js';
import { SiteNoticesController, SiteNoticesService } from './site-notices.js';

type Audience = 'league' | 'group' | 'person';

const Notice = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(4000).default(''),
    pinned: z.boolean().default(false),
    bannerDays: BannerDays.optional(),
    audience: z.enum(['league', 'group', 'person']).default('league'),
    groupId: z.uuid().optional(),
    recipientUserId: z.uuid().optional(),
    /** Also email it to the people it's for (the mail guard still applies). */
    email: z.boolean().default(false),
  })
  .refine((n) => n.audience !== 'group' || n.groupId, { message: 'Pick the foursome.' })
  .refine((n) => n.audience !== 'person' || n.recipientUserId, { message: 'Pick the person.' });
const Edit = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(4000),
    pinned: z.boolean(),
    bannerDays: BannerDays,
  })
  .partial();
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const Ids = z.object({ ids: z.array(z.uuid()).min(1).max(100) });
const Uuid = new ParseUUIDPipe();

const recipient = alias(users, 'recipient');
const recipientPlayer = alias(players, 'recipient_player');
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * League notices: to the whole league, one foursome or one person, posted by admins or
 * written by the app itself (cards submitted, disputed or corrected, rainouts, playoffs).
 * Everyone sees what's for them (admins see all), and each person's read and dismissed
 * state is kept: the newest show as banners at the top of every page until they expire or
 * are dismissed.
 */
@Injectable()
export class AnnouncementsService {
  private readonly log = new Logger('Notices');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly mail: MailSettingsService,
    private readonly memberships: MembershipService,
    private readonly audit: AuditService,
    private readonly push: PushService,
  ) {}

  /** The notices in a league this person may see. */
  private visible(user: SessionUser, leagueId: string, isAdmin: boolean): SQL {
    const inLeague = eq(announcements.leagueId, leagueId);
    if (isAdmin) return inLeague;
    const myGroups = this.db
      .select({ id: matches.groupId })
      .from(matches)
      .innerJoin(players, or(eq(players.id, matches.playerAId), eq(players.id, matches.playerBId)))
      .where(eq(players.userId, user.id));
    return and(
      inLeague,
      or(
        eq(announcements.audience, 'league'),
        and(eq(announcements.audience, 'person'), eq(announcements.recipientUserId, user.id)),
        and(eq(announcements.audience, 'group'), inArray(announcements.groupId, myGroups)),
      ),
    )!;
  }

  async list(user: SessionUser, leagueId: string, limit: number) {
    const isAdmin = (await this.memberships.roleIn(user, leagueId)) === 'admin';
    const rows = await this.db
      .select({
        a: announcements,
        author: users.name,
        recipientName: recipient.name,
        recipientNickname: recipient.nickname,
        recipientPlayer: recipientPlayer.nickname,
        round: weeks.round,
        slot: groups.slot,
        readAt: announcementReads.readAt,
        dismissedAt: announcementReads.dismissedAt,
      })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.authorUserId))
      .leftJoin(recipient, eq(recipient.id, announcements.recipientUserId))
      .leftJoin(
        recipientPlayer,
        and(
          eq(recipientPlayer.userId, announcements.recipientUserId),
          eq(recipientPlayer.leagueId, leagueId),
        ),
      )
      .leftJoin(groups, eq(groups.id, announcements.groupId))
      .leftJoin(weeks, eq(weeks.id, groups.weekId))
      .leftJoin(
        announcementReads,
        and(
          eq(announcementReads.announcementId, announcements.id),
          eq(announcementReads.userId, user.id),
        ),
      )
      .where(this.visible(user, leagueId, isAdmin))
      .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
      .limit(limit);
    const now = new Date();
    const today = todayInLeague(now);
    return rows.map((r) => {
      const changed = r.a.updatedAt ?? r.a.createdAt;
      const dismissed = Boolean(r.dismissedAt && r.dismissedAt >= changed);
      const to =
        r.a.audience === 'league'
          ? 'League'
          : r.a.audience === 'group'
            ? isAdmin
              ? `Round ${r.round}, ${ordinal((r.slot ?? 0) + 1)} off`
              : 'Your foursome'
            : r.a.recipientUserId === user.id
              ? 'You'
              : (r.recipientPlayer ?? r.recipientNickname ?? r.recipientName ?? 'One person');
      return {
        id: r.a.id,
        title: r.a.title,
        body: r.a.body,
        pinned: r.a.pinned,
        audience: r.a.audience,
        kind: r.a.kind,
        to,
        createdAt: r.a.createdAt,
        updatedAt: r.a.updatedAt,
        author: r.a.kind ? 'LeagueMates' : r.author,
        read: Boolean(r.readAt && r.readAt >= changed),
        dismissed,
        ...bannerState(r.a, dismissed, now, today),
      };
    });
  }

  /** Marks notices read (opened) or dismissed (banner cleared away) for this person. */
  async mark(user: SessionUser, leagueId: string, ids: string[], how: 'read' | 'dismissed') {
    const isAdmin = (await this.memberships.roleIn(user, leagueId)) === 'admin';
    const mine = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(and(this.visible(user, leagueId, isAdmin), inArray(announcements.id, ids)));
    if (!mine.length) return { ok: true };
    const now = new Date();
    await this.db
      .insert(announcementReads)
      .values(
        mine.map((m) => ({
          announcementId: m.id,
          userId: user.id,
          readAt: now,
          dismissedAt: how === 'dismissed' ? now : null,
        })),
      )
      .onConflictDoUpdate({
        target: [announcementReads.announcementId, announcementReads.userId],
        set:
          how === 'dismissed'
            ? { readAt: now, dismissedAt: now }
            : { readAt: sql`excluded.read_at` },
      });
    return { ok: true };
  }

  /** The accounts a notice is for (not counting admins, who see everything). */
  private async recipients(
    leagueId: string,
    n: { audience: Audience; groupId?: string | null; recipientUserId?: string | null },
  ) {
    const ids =
      n.audience === 'person'
        ? [n.recipientUserId!]
        : n.audience === 'group'
          ? (
              await this.db
                .select({ id: players.userId })
                .from(matches)
                .innerJoin(
                  players,
                  or(eq(players.id, matches.playerAId), eq(players.id, matches.playerBId)),
                )
                .where(and(eq(matches.groupId, n.groupId!), isNotNull(players.userId)))
            ).map((r) => r.id!)
          : (
              await this.db
                .select({ id: leagueMemberships.userId })
                .from(leagueMemberships)
                .where(eq(leagueMemberships.leagueId, leagueId))
            ).map((r) => r.id);
    if (!ids.length) return [];
    return this.db
      .select({
        id: users.id,
        email: users.email,
        phone: users.phone,
        disabledAt: users.disabledAt,
        noticeEmails: users.noticeEmails,
      })
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]));
  }

  private async checkAudience(
    leagueId: string,
    input: {
      audience: Audience;
      groupId?: string | undefined;
      recipientUserId?: string | undefined;
    },
  ) {
    if (input.audience === 'group') {
      const [g] = await this.db
        .select({ id: groups.id })
        .from(groups)
        .innerJoin(weeks, eq(weeks.id, groups.weekId))
        .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
        .where(and(eq(groups.id, input.groupId!), eq(seasons.leagueId, leagueId)))
        .limit(1);
      if (!g) throw new BadRequestException('That foursome is not in this league.');
    }
    if (input.audience === 'person') {
      const [m] = await this.db
        .select({ id: leagueMemberships.userId })
        .from(leagueMemberships)
        .where(
          and(
            eq(leagueMemberships.leagueId, leagueId),
            eq(leagueMemberships.userId, input.recipientUserId!),
          ),
        )
        .limit(1);
      if (!m) throw new BadRequestException('That person is not in this league.');
    }
  }

  async create(actor: SessionUser, leagueId: string, input: z.infer<typeof Notice>) {
    await this.checkAudience(leagueId, input);
    const { email, bannerDays, ...fields } = input;
    const banner = bannerFields(bannerDays, fields.pinned);
    const [a] = await this.db
      .insert(announcements)
      .values({
        leagueId,
        authorUserId: actor.id,
        title: fields.title,
        body: fields.body,
        pinned: fields.pinned,
        ...banner,
        audience: fields.audience,
        groupId: fields.audience === 'group' ? fields.groupId : null,
        recipientUserId: fields.audience === 'person' ? fields.recipientUserId : null,
      })
      .returning();
    const people = (await this.recipients(leagueId, a!)).filter(
      (p) => p.id !== actor.id && !p.disabledAt,
    );
    const { emailed, held } = email ? await this.email(people, a!) : { emailed: 0, held: 0 };
    await this.push.send(
      people.filter((p) => !p.disabledAt).map((p) => p.id),
      { title: a!.title, body: a!.body, url: '/' },
    );
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: a!.id,
      after: { ...fields, ...banner, emailed, held },
    });
    return { ...a!, emailed, held, phones: people.map((p) => p.phone).filter(Boolean) };
  }

  /** Admins: phone numbers of the people a notice is for, to text it from their phone. */
  async phones(actor: SessionUser, leagueId: string, id: string) {
    const a = await this.find(leagueId, id);
    return (await this.recipients(leagueId, a))
      .filter((p) => p.id !== actor.id && !p.disabledAt && p.phone)
      .map((p) => p.phone!);
  }

  /**
   * Emails a notice to the people it's for who want notice emails. The mail guard still
   * applies: anyone it won't let through is counted as held back, not sent.
   */
  private async email(
    people: { email: string; disabledAt: Date | null; noticeEmails: boolean }[],
    n: { title: string; body: string },
  ) {
    let emailed = 0;
    let held = 0;
    for (const p of people) {
      if (p.disabledAt || !p.noticeEmails) continue;
      if (!(await this.mail.allows(p.email))) {
        held++;
        continue;
      }
      await this.mailer
        .send({
          to: p.email,
          subject: n.title,
          text: [
            n.body || n.title,
            '',
            `LeagueMates: ${this.config.APP_URL}`,
            '',
            'To stop notice emails, turn them off on your Account page in LeagueMates.',
          ].join('\n'),
        })
        .then(() => emailed++)
        .catch((err: unknown) => this.log.error(`Notice email failed: ${String(err)}`));
    }
    return { emailed, held };
  }

  /**
   * A notice the app writes itself, never texted. `email` also emails it (rainouts and skips),
   * to those who want notice emails; `push` pushes it to their devices. Failures never block
   * the action.
   */
  async notify(
    leagueId: string,
    n: {
      audience: Audience;
      groupId?: string;
      recipientUserId?: string;
      title: string;
      body?: string;
      kind: string;
      /** A rainout or skip: the day it's about. */
      forDate?: string;
      email?: boolean;
      /** Also push it to the devices of those it's for, and open this page when tapped. */
      push?: { url: string; exceptUserId?: string };
    },
  ) {
    try {
      const [a] = await this.db
        .insert(announcements)
        .values({
          leagueId,
          audience: n.audience,
          groupId: n.groupId ?? null,
          recipientUserId: n.recipientUserId ?? null,
          title: n.title,
          body: n.body ?? '',
          kind: n.kind,
          forDate: n.forDate ?? null,
        })
        .returning();
      if (n.email) {
        const { emailed, held } = await this.email(await this.recipients(leagueId, a!), a!);
        this.log.log(`Emailed ${n.kind}: ${emailed} sent, ${held} held back by the mail guard`);
      }
      if (n.push) {
        const people = await this.recipients(leagueId, a!);
        await this.push.send(
          people.filter((p) => !p.disabledAt && p.id !== n.push!.exceptUserId).map((p) => p.id),
          { title: a!.title, body: a!.body, url: n.push.url },
        );
      }
    } catch (err) {
      this.log.error(`Couldn't post an automatic notice (${n.kind}): ${String(err)}`);
    }
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

  async update(actor: SessionUser, leagueId: string, id: string, input: z.infer<typeof Edit>) {
    const before = await this.find(leagueId, id);
    const { bannerDays, ...fields } = input;
    const changes = { ...fields, ...bannerFields(bannerDays, fields.pinned) };
    const [a] = await this.db
      .update(announcements)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'announcement.update',
      entityType: 'announcement',
      entityId: id,
      before: {
        title: before.title,
        body: before.body,
        pinned: before.pinned,
        expiresAt: before.expiresAt,
      },
      after: changes,
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
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    return this.svc.list(user, leagueId, q.limit);
  }

  @Post('read')
  @HttpCode(200)
  read(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(Ids)) body: z.infer<typeof Ids>,
  ) {
    return this.svc.mark(user, leagueId, body.ids, 'read');
  }

  @Post('dismiss')
  @HttpCode(200)
  dismiss(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(Ids)) body: z.infer<typeof Ids>,
  ) {
    return this.svc.mark(user, leagueId, body.ids, 'dismissed');
  }

  @Post()
  @RequireLeagueRole('admin')
  create(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(Notice)) body: z.infer<typeof Notice>,
  ) {
    return this.svc.create(user, leagueId, body);
  }

  @Get(':id/phones')
  @RequireLeagueRole('admin')
  phones(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Param('id', Uuid) id: string,
  ) {
    return this.svc.phones(user, leagueId, id);
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

/** Global so scorecards, seasons and playoffs can post automatic notices. */
@Global()
@Module({
  controllers: [AnnouncementsController, SiteNoticesController],
  providers: [AnnouncementsService, SiteNoticesService, LeagueGuard],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
