import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { DB, type Database } from '../db/db.js';
import { sql } from 'drizzle-orm';
import { auditLog } from '../db/schema.js';
import { LeagueGuard } from '../leagues/league.guard.js';
import { AuditController } from './audit.controller.js';

export interface AuditEntry {
  leagueId?: string | null;
  /** Worked out from the entity when not given (seasons, weeks, cards, matches, scramble, photos). */
  seasonId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

type Executor = Pick<Database, 'insert' | 'execute'>;

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Records an entry; pass a transaction as `tx` so the entry commits with the change. */
  async record(entry: AuditEntry, tx: Executor = this.db): Promise<void> {
    const seasonId =
      entry.seasonId ??
      (entry.entityId ? await this.seasonOf(tx, entry.entityType, entry.entityId) : null);
    await tx.insert(auditLog).values({
      leagueId: entry.leagueId ?? null,
      seasonId,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
    });
  }

  /** The season an entity belongs to, so season activity can be listed. */
  private async seasonOf(tx: Executor, type: string, id: string): Promise<string | null> {
    const q = {
      season: sql`select id from seasons where id::text = ${id}`,
      week: sql`select season_id as id from weeks where id::text = ${id}`,
      scorecard: sql`select w.season_id as id from scorecards sc join groups g on g.id = sc.group_id join weeks w on w.id = g.week_id where sc.id::text = ${id}`,
      match: sql`select w.season_id as id from matches m join weeks w on w.id = m.week_id where m.id::text = ${id}`,
      scramble: sql`select season_id as id from scrambles where id::text = ${id}`,
      scramble_team: sql`select s.season_id as id from scramble_teams t join scrambles s on s.id = t.scramble_id where t.id::text = ${id}`,
      photo: sql`select coalesce(p.season_id, w.season_id) as id from photos p left join groups g on g.id = p.group_id left join weeks w on w.id = g.week_id where p.id::text = ${id}`,
    }[type];
    if (!q) return null;
    const res = await tx.execute(q);
    const row = (res as unknown as { rows?: { id: string | null }[] }).rows?.[0];
    return row?.id ?? null;
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, LeagueGuard],
  exports: [AuditService],
})
export class AuditModule {}
