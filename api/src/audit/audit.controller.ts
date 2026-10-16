import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, like, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, SiteAdminOnly, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { DB, type Database } from '../db/db.js';
import { auditLog, leagueMemberships, users } from '../db/schema.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';

const Query_ = z.object({
  /** Action prefix, e.g. "scorecard" or "scorecard.override". */
  action: z.string().max(60).optional(),
  /** Return entries older than this id (for "load more"). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Only this season's entries (its schedule, cards, playoffs, scramble, photos). */
  seasonId: z.uuid().optional(),
  /** Only entries about this one thing, e.g. a scorecard's history. */
  entityId: z.string().max(60).optional(),
});

/** Reading the audit log: league admins see their league; site admins can see everything. */
@Controller()
export class AuditController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async page(scope: SQL | undefined, q: z.infer<typeof Query_>) {
    const where = and(
      scope,
      q.action
        ? or(eq(auditLog.action, q.action), like(auditLog.action, `${q.action}.%`))
        : undefined,
      q.before ? lt(auditLog.id, q.before) : undefined,
      q.seasonId ? eq(auditLog.seasonId, q.seasonId) : undefined,
      q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
    );
    const rows = await this.db
      .select({
        id: auditLog.id,
        leagueId: auditLog.leagueId,
        seasonId: auditLog.seasonId,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
        actor: users.name,
        actorEmail: users.email,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(q.limit + 1);
    return { entries: rows.slice(0, q.limit), more: rows.length > q.limit };
  }

  @Get('leagues/:leagueId/audit')
  @UseGuards(LeagueGuard)
  @RequireLeagueRole('admin')
  league(
    @Param('leagueId') leagueId: string,
    @Query(new ZodPipe(Query_)) q: z.infer<typeof Query_>,
  ) {
    return this.page(eq(auditLog.leagueId, leagueId), q);
  }

  /** Everything, including account and site changes that belong to no league. */
  @Get('audit')
  @SiteAdminOnly()
  site(@Query(new ZodPipe(Query_)) q: z.infer<typeof Query_>) {
    return this.page(undefined, q);
  }

  /** Account and site changes only (no league). */
  @Get('audit/site')
  @SiteAdminOnly()
  siteOnly(@Query(new ZodPipe(Query_)) q: z.infer<typeof Query_>) {
    return this.page(isNull(auditLog.leagueId), q);
  }

  /**
   * One person's activity: what they did, and what was done to their account (sign-ins,
   * lockouts, password links, roles). Site admins see all of it; a league admin sees it for
   * people in a league they run, limited to their leagues plus account-level entries.
   */
  @Get('users/:userId/audit')
  async person(
    @CurrentUser() actor: SessionUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query(new ZodPipe(Query_)) q: z.infer<typeof Query_>,
  ) {
    const about = or(
      eq(auditLog.actorUserId, userId),
      and(eq(auditLog.entityType, 'user'), eq(auditLog.entityId, userId)),
    );
    if (actor.isSiteAdmin) return this.page(about, q);
    const mine = await this.db
      .select({ leagueId: leagueMemberships.leagueId })
      .from(leagueMemberships)
      .where(and(eq(leagueMemberships.userId, actor.id), eq(leagueMemberships.role, 'admin')));
    const adminOf = mine.map((m) => m.leagueId);
    const theirs = adminOf.length
      ? await this.db
          .select({ leagueId: leagueMemberships.leagueId })
          .from(leagueMemberships)
          .where(
            and(eq(leagueMemberships.userId, userId), inArray(leagueMemberships.leagueId, adminOf)),
          )
      : [];
    if (theirs.length === 0) throw new ForbiddenException('Admins of their league only.');
    return this.page(
      and(about, or(isNull(auditLog.leagueId), inArray(auditLog.leagueId, adminOf))),
      q,
    );
  }
}
