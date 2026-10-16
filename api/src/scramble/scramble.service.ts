import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  balancedTeams,
  rankScramble,
  teamHandicap,
  teeTime,
  withDefaults,
  type Layout,
  type LeagueSettings,
} from '@teemate/shared';
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.js';
import type { SessionUser } from '../auth/decorators.js';
import { MembershipService } from '../auth/membership.service.js';
import { DB, type Database } from '../db/db.js';
import {
  holes,
  layouts,
  players,
  scrambles,
  scrambleTeamMembers,
  scrambleTeams,
  seasonPlayers,
  seasons,
  weeks,
} from '../db/schema.js';

export interface ScrambleSetup {
  date: string;
  layoutId: string;
  teamSize: number;
  allowance: number[];
  playerIds: string[];
  seed?: number | undefined;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class ScrambleService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly memberships: MembershipService,
  ) {}

  private async season(leagueId: string, seasonId: string) {
    const [s] = await this.db
      .select()
      .from(seasons)
      .where(and(eq(seasons.id, seasonId), eq(seasons.leagueId, leagueId)))
      .limit(1);
    if (!s) throw new NotFoundException();
    return { ...s, settings: withDefaults(s.settings as Partial<LeagueSettings>) };
  }

  /**
   * The scramble comes after the playoffs: it can be set up once the Finals week is played
   * (or, with no playoffs, once every regular-season week is played or skipped).
   */
  private async readyFor(season: { id: string; settings: LeagueSettings }) {
    const ws = await this.db
      .select({ status: weeks.status, playoffRound: weeks.playoffRound, isFinal: weeks.isFinal })
      .from(weeks)
      .where(eq(weeks.seasonId, season.id));
    if (season.settings.playoffs.format === 'none') {
      const left = ws.filter((w) => w.playoffRound === null && w.status === 'scheduled').length;
      return left === 0 && ws.length > 0
        ? { ready: true, waitingFor: null }
        : { ready: false, waitingFor: 'the regular season to finish' };
    }
    return ws.some((w) => w.isFinal && w.status === 'played')
      ? { ready: true, waitingFor: null }
      : { ready: false, waitingFor: 'the playoffs to finish' };
  }

  private async layout(layoutId: string): Promise<Layout & { id: string }> {
    const [l] = await this.db.select().from(layouts).where(eq(layouts.id, layoutId)).limit(1);
    const hs = await this.db
      .select()
      .from(holes)
      .where(eq(holes.layoutId, layoutId))
      .orderBy(asc(holes.number));
    return {
      id: l!.id,
      name: l!.name,
      holes: hs.map((h) => ({ number: h.number, par: h.par, strokeIndex: h.strokeIndex })),
    };
  }

  private async current(seasonId: string) {
    const [s] = await this.db
      .select()
      .from(scrambles)
      .where(eq(scrambles.seasonId, seasonId))
      .limit(1);
    return s ?? null;
  }

  private async roster(seasonId: string) {
    return this.db
      .select({
        playerId: players.id,
        nickname: players.nickname,
        handicap: players.handicap,
        userId: players.userId,
      })
      .from(seasonPlayers)
      .innerJoin(players, eq(players.id, seasonPlayers.playerId))
      .where(eq(seasonPlayers.seasonId, seasonId))
      .orderBy(asc(seasonPlayers.spot));
  }

  /** The scramble with teams and leaderboard, or the defaults for setting one up. */
  async view(user: SessionUser, leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const roster = await this.roster(seasonId);
    const s = await this.current(seasonId);
    const isAdmin = (await this.memberships.roleIn(user, leagueId)) === 'admin';

    if (!s) {
      const courseLayouts = await this.db
        .select({ id: layouts.id, name: layouts.name })
        .from(layouts)
        .where(and(eq(layouts.courseId, season.courseId), isNull(layouts.retiredAt)))
        .orderBy(asc(layouts.sortOrder));
      const [last] = await this.db
        .select({ date: weeks.date })
        .from(weeks)
        .where(eq(weeks.seasonId, seasonId))
        .orderBy(desc(weeks.date))
        .limit(1);
      const next = last ? new Date(`${last.date}T12:00:00Z`) : null;
      next?.setUTCDate(next.getUTCDate() + 7);
      return {
        scramble: null,
        ...(await this.readyFor(season)),
        defaults: {
          ...season.settings.scramble,
          date: next?.toISOString().slice(0, 10) ?? season.startDate,
          layouts: courseLayouts,
          players: roster.map(({ userId: _, ...p }) => p),
        },
        canManage: isAdmin,
      };
    }

    const layout = await this.layout(s.layoutId);
    const teams = await this.db
      .select()
      .from(scrambleTeams)
      .where(eq(scrambleTeams.scrambleId, s.id))
      .orderBy(asc(scrambleTeams.number));
    const members = teams.length
      ? await this.db
          .select({
            teamId: scrambleTeamMembers.teamId,
            playerId: scrambleTeamMembers.playerId,
            handicap: scrambleTeamMembers.handicap,
            nickname: players.nickname,
            userId: players.userId,
          })
          .from(scrambleTeamMembers)
          .innerJoin(players, eq(players.id, scrambleTeamMembers.playerId))
          .where(
            inArray(
              scrambleTeamMembers.teamId,
              teams.map((t) => t.id),
            ),
          )
          .orderBy(asc(scrambleTeamMembers.handicap))
      : [];
    const ranked = new Map(
      rankScramble(
        teams.map((t) => ({ id: t.id, handicap: t.handicap, holeScores: t.holeScores })),
        layout,
      ).map((r) => [r.id, r]),
    );
    const started = teams.some((t) => t.holeScores.some((x) => x !== null));
    const allIn = teams.length > 0 && [...ranked.values()].every((r) => r.position !== null);

    return {
      scramble: {
        id: s.id,
        date: s.date,
        teamSize: s.teamSize,
        allowance: s.allowance,
        layout,
        started,
        complete: allIn,
      },
      teams: teams.map((t) => {
        const ms = members.filter((m) => m.teamId === t.id);
        const r = ranked.get(t.id)!;
        return {
          id: t.id,
          number: t.number,
          teeTime: t.teeTime,
          handicap: t.handicap,
          holeScores: t.holeScores,
          version: t.version,
          members: ms.map(({ teamId: _, userId: __, ...m }) => m),
          gross: r.gross,
          net: r.net,
          position: r.position,
          onCards: r.onCards,
          canEnter: isAdmin || ms.some((m) => m.userId === user.id),
        };
      }),
      canManage: isAdmin,
    };
  }

  /** Writes teams, their members and handicaps (replacing any existing ones). */
  private async writeTeams(
    tx: Tx,
    scrambleId: string,
    teams: { playerId: string; handicap: number }[][],
    allowance: number[],
    settings: LeagueSettings,
    holeCount: number,
  ) {
    await tx.delete(scrambleTeams).where(eq(scrambleTeams.scrambleId, scrambleId));
    for (const [i, members] of teams.entries()) {
      const [team] = await tx
        .insert(scrambleTeams)
        .values({
          scrambleId,
          number: i + 1,
          teeTime: teeTime(settings.teeTimes.firstTeeTime, i, settings.teeTimes.intervalMinutes),
          handicap: teamHandicap(
            members.map((m) => m.handicap),
            allowance,
          ),
          holeScores: Array.from({ length: holeCount }, () => null),
        })
        .returning();
      await tx.insert(scrambleTeamMembers).values(members.map((m) => ({ teamId: team!.id, ...m })));
    }
  }

  async create(actor: SessionUser, leagueId: string, seasonId: string, input: ScrambleSetup) {
    const season = await this.season(leagueId, seasonId);
    if (season.status === 'draft')
      throw new BadRequestException('Lock the season schedule before setting up the scramble.');
    if (await this.current(seasonId))
      throw new ConflictException('This season already has a scramble.');
    const { ready, waitingFor } = await this.readyFor(season);
    if (!ready) throw new BadRequestException(`The scramble is set up after ${waitingFor}.`);
    const [layout] = await this.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.id, input.layoutId),
          eq(layouts.courseId, season.courseId),
          isNull(layouts.retiredAt),
        ),
      )
      .limit(1);
    if (!layout) throw new BadRequestException('That nine is not on this season’s course.');

    const roster = await this.roster(seasonId);
    const chosen = roster.filter((p) => input.playerIds.includes(p.playerId));
    if (chosen.length !== new Set(input.playerIds).size)
      throw new BadRequestException('Every player must be on this season’s roster.');
    if (chosen.length < 2) throw new BadRequestException('A scramble needs at least 2 players.');
    const noHcp = chosen.filter((p) => p.handicap === null);
    if (noHcp.length)
      throw new BadRequestException(
        `Set a handicap for ${noHcp.map((p) => p.nickname).join(', ')} first.`,
      );

    const seed = input.seed ?? randomInt(1, 2 ** 31 - 1);
    const teams = balancedTeams(
      chosen.map((p) => ({ id: p.playerId, handicap: p.handicap! })),
      { teamSize: input.teamSize, allowance: input.allowance },
      seed,
    );
    const holeCount = (await this.layout(layout.id)).holes.length;

    await this.db.transaction(async (tx) => {
      const [s] = await tx
        .insert(scrambles)
        .values({
          seasonId,
          date: input.date,
          layoutId: layout.id,
          teamSize: input.teamSize,
          allowance: input.allowance,
        })
        .returning();
      await this.writeTeams(
        tx,
        s!.id,
        teams.map((t) => t.map((p) => ({ playerId: p.id, handicap: p.handicap }))),
        input.allowance,
        season.settings,
        holeCount,
      );
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'scramble.create',
          entityType: 'scramble',
          entityId: s!.id,
          after: { ...input, seed, teams: teams.length },
        },
        tx,
      );
    });
    return this.view(actor, leagueId, seasonId);
  }

  private async editable(leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const s = await this.current(seasonId);
    if (!s) throw new NotFoundException();
    const teams = await this.db
      .select({ id: scrambleTeams.id, holeScores: scrambleTeams.holeScores })
      .from(scrambleTeams)
      .where(eq(scrambleTeams.scrambleId, s.id));
    if (teams.some((t) => t.holeScores.some((x) => x !== null)))
      throw new ConflictException('Scores are already in, so the teams can’t change.');
    const members = teams.length
      ? await this.db
          .select()
          .from(scrambleTeamMembers)
          .where(
            inArray(
              scrambleTeamMembers.teamId,
              teams.map((t) => t.id),
            ),
          )
      : [];
    return { season, s, members };
  }

  /** Sets teams by hand: the same players, regrouped. */
  async setTeams(actor: SessionUser, leagueId: string, seasonId: string, teams: string[][]) {
    const { season, s, members } = await this.editable(leagueId, seasonId);
    const before = members.map((m) => m.playerId).sort();
    const after = teams.flat();
    if (
      after.length !== before.length ||
      [...after].sort().join() !== before.join() ||
      teams.some((t) => t.length === 0)
    )
      throw new BadRequestException('Each player must be on exactly one team.');
    const hcp = new Map(members.map((m) => [m.playerId, m.handicap]));
    const holeCount = (await this.layout(s.layoutId)).holes.length;
    await this.db.transaction(async (tx) => {
      await this.writeTeams(
        tx,
        s.id,
        teams.map((t) => t.map((playerId) => ({ playerId, handicap: hcp.get(playerId)! }))),
        s.allowance,
        season.settings,
        holeCount,
      );
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'scramble.teams',
          entityType: 'scramble',
          entityId: s.id,
          after: { teams },
        },
        tx,
      );
    });
    return this.view(actor, leagueId, seasonId);
  }

  /** Balances the same players again with a new seed. */
  async regenerate(actor: SessionUser, leagueId: string, seasonId: string, seed?: number) {
    const { s, members } = await this.editable(leagueId, seasonId);
    const teams = balancedTeams(
      members.map((m) => ({ id: m.playerId, handicap: m.handicap })),
      { teamSize: s.teamSize, allowance: s.allowance },
      seed ?? randomInt(1, 2 ** 31 - 1),
    );
    return this.setTeams(
      actor,
      leagueId,
      seasonId,
      teams.map((t) => t.map((p) => p.id)),
    );
  }

  /** A team's hole scores, entered by a team member or an admin. */
  async saveScores(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    teamId: string,
    input: { holeScores: (number | null)[]; version: number },
  ) {
    await this.season(leagueId, seasonId);
    const s = await this.current(seasonId);
    if (!s) throw new NotFoundException();
    const [team] = await this.db
      .select()
      .from(scrambleTeams)
      .where(and(eq(scrambleTeams.id, teamId), eq(scrambleTeams.scrambleId, s.id)))
      .limit(1);
    if (!team) throw new NotFoundException();
    const isAdmin = (await this.memberships.roleIn(user, leagueId)) === 'admin';
    if (!isAdmin) {
      const [mine] = await this.db
        .select({ id: players.id })
        .from(scrambleTeamMembers)
        .innerJoin(players, eq(players.id, scrambleTeamMembers.playerId))
        .where(and(eq(scrambleTeamMembers.teamId, teamId), eq(players.userId, user.id)))
        .limit(1);
      if (!mine)
        throw new ForbiddenException('Only someone on this team or an admin can enter its card.');
    }
    if (input.holeScores.length !== team.holeScores.length)
      throw new BadRequestException(`Enter ${team.holeScores.length} holes.`);
    if (input.version !== team.version)
      throw new ConflictException(
        'Someone else saved this card while you were editing. Reload to see their changes.',
      );
    await this.db
      .update(scrambleTeams)
      .set({
        holeScores: input.holeScores,
        version: team.version + 1,
        enteredBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(scrambleTeams.id, teamId));
    await this.audit.record({
      leagueId,
      actorUserId: user.id,
      action: 'scramble.scores',
      entityType: 'scramble_team',
      entityId: teamId,
      before: { holeScores: team.holeScores },
      after: { holeScores: input.holeScores },
    });
    return this.view(user, leagueId, seasonId);
  }

  async remove(actor: SessionUser, leagueId: string, seasonId: string) {
    await this.season(leagueId, seasonId);
    const s = await this.current(seasonId);
    if (!s) throw new NotFoundException();
    await this.db.delete(scrambles).where(eq(scrambles.id, s.id));
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'scramble.delete',
      entityType: 'scramble',
      entityId: s.id,
      before: { date: s.date },
    });
    return this.view(actor, leagueId, seasonId);
  }
}
