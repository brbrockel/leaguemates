import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { computeHandicap, withDefaults, type LeagueSettings } from '@leaguemates/shared';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.js';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { DB, type Database } from '../db/db.js';
import { cardRounds, groups, leagues, players, scorecards, weeks } from '../db/schema.js';
import { LeagueGuard, RequireLeagueRole } from '../leagues/league.guard.js';
import { grossOf } from '../scorecards/results.js';

const Apply = z.object({ playerIds: z.array(z.uuid()).max(100).optional() });

interface Scored {
  date: string;
  gross: number;
  league: 'this' | 'included';
}

/** Suggested handicaps from each player's recent scores. Admins review and apply them. */
@Injectable()
export class HandicapsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Played rounds with a full score, by player, oldest first. Draft cards don't count. */
  private async rounds(leagueId: string): Promise<Map<string, Omit<Scored, 'league'>[]>> {
    const rs = await this.db
      .select({
        playerId: cardRounds.playerId,
        date: weeks.date,
        attendance: cardRounds.attendance,
        handicap: cardRounds.handicap,
        holeScores: cardRounds.holeScores,
        gross: cardRounds.gross,
      })
      .from(cardRounds)
      .innerJoin(scorecards, eq(scorecards.id, cardRounds.scorecardId))
      .innerJoin(groups, eq(groups.id, scorecards.groupId))
      .innerJoin(weeks, eq(weeks.id, groups.weekId))
      .innerJoin(players, eq(players.id, cardRounds.playerId))
      .where(and(eq(players.leagueId, leagueId), ne(scorecards.status, 'draft')))
      .orderBy(asc(weeks.date));
    const out = new Map<string, Omit<Scored, 'league'>[]>();
    for (const r of rs) {
      const g = grossOf(r);
      if (g === null) continue;
      out.set(r.playerId, [...(out.get(r.playerId) ?? []), { date: r.date, gross: g }]);
    }
    return out;
  }

  async suggestions(leagueId: string) {
    const [league] = await this.db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
    const rule = withDefaults(league!.settings as Partial<LeagueSettings>).handicap;
    const roster = await this.db
      .select()
      .from(players)
      .where(and(eq(players.leagueId, leagueId), eq(players.active, true)))
      .orderBy(asc(players.nickname));
    const own = await this.rounds(leagueId);

    // Rounds from the included league, matched by nickname.
    let included: { id: string; name: string } | null = null;
    const extra = new Map<string, Omit<Scored, 'league'>[]>();
    if (rule.includeLeagueId) {
      const [other] = await this.db
        .select({ id: leagues.id, name: leagues.name })
        .from(leagues)
        .where(eq(leagues.id, rule.includeLeagueId))
        .limit(1);
      if (other) {
        included = other;
        const names = new Map(roster.map((p) => [p.nickname.toLowerCase(), p.id]));
        const theirs = await this.db
          .select({ id: players.id, nickname: players.nickname })
          .from(players)
          .where(
            and(
              eq(players.leagueId, other.id),
              inArray(sql`lower(${players.nickname})`, [...names.keys()]),
            ),
          );
        const rounds = theirs.length ? await this.rounds(other.id) : new Map();
        for (const t of theirs)
          extra.set(names.get(t.nickname.toLowerCase())!, rounds.get(t.id) ?? []);
      }
    }

    return {
      rule,
      includedLeague: included,
      players: roster.map((p) => {
        const scored: Scored[] = [
          ...(extra.get(p.id) ?? []).map((r) => ({ ...r, league: 'included' as const })),
          ...(own.get(p.id) ?? []).map((r) => ({ ...r, league: 'this' as const })),
        ].sort((a, b) => a.date.localeCompare(b.date));
        const result = computeHandicap(
          scored.map((r) => r.gross),
          rule,
        );
        // Mark which of the window's rounds were averaged (the lowest, earliest first on ties).
        const window = scored.slice(-result.window.length || scored.length);
        const take = [...window.keys()]
          .sort((a, b) => window[a]!.gross - window[b]!.gross || a - b)
          .slice(0, result.counted.length);
        return {
          playerId: p.id,
          nickname: p.nickname,
          current: p.handicap,
          suggested: result.handicap,
          average: result.average,
          totalRounds: scored.length,
          window: result.window.length
            ? window.map((r, i) => ({ ...r, counted: take.includes(i) }))
            : [],
        };
      }),
    };
  }

  /** Sets suggested handicaps for the chosen players (default: every one that changes). */
  async apply(actor: SessionUser, leagueId: string, playerIds?: string[]) {
    const s = await this.suggestions(leagueId);
    const changes = s.players.filter(
      (p) =>
        p.suggested !== null &&
        p.suggested !== p.current &&
        (!playerIds || playerIds.includes(p.playerId)),
    );
    if (changes.length) {
      await this.db.transaction(async (tx) => {
        for (const c of changes)
          await tx.update(players).set({ handicap: c.suggested }).where(eq(players.id, c.playerId));
        await this.audit.record(
          {
            leagueId,
            actorUserId: actor.id,
            action: 'handicap.apply',
            entityType: 'league',
            entityId: leagueId,
            before: Object.fromEntries(changes.map((c) => [c.nickname, c.current])),
            after: Object.fromEntries(changes.map((c) => [c.nickname, c.suggested])),
          },
          tx,
        );
      });
    }
    return { changed: changes.length, ...(await this.suggestions(leagueId)) };
  }
}

@Controller('leagues/:leagueId/handicaps')
@UseGuards(LeagueGuard)
export class HandicapsController {
  constructor(private readonly svc: HandicapsService) {}

  @Get()
  list(@Param('leagueId') leagueId: string) {
    return this.svc.suggestions(leagueId);
  }

  @Post('apply')
  @RequireLeagueRole('admin')
  apply(
    @CurrentUser() user: SessionUser,
    @Param('leagueId') leagueId: string,
    @Body(new ZodPipe(Apply)) body: z.infer<typeof Apply>,
  ) {
    return this.svc.apply(user, leagueId, body.playerIds);
  }
}

@Module({
  controllers: [HandicapsController],
  providers: [HandicapsService, LeagueGuard],
})
export class HandicapsModule {}
