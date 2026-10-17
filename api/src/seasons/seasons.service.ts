import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  diversityReport,
  generateSeason,
  withDefaults,
  type LeagueSettings,
  type ScheduledWeek,
} from '@teemate/shared';
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { AnnouncementsService } from '../announcements/announcements.js';
import { AuditService } from '../audit/audit.js';
import type { SessionUser } from '../auth/decorators.js';
import { MembershipService } from '../auth/membership.service.js';
import { DB, type Database } from '../db/db.js';
import {
  courses,
  groups,
  layouts,
  leagueMemberships,
  leagues,
  matches,
  photos,
  players,
  roundAbsences,
  scorecards,
  seasonPlayers,
  seasons,
  weeks,
} from '../db/schema.js';

/** Leagues play in Connecticut; "today" and "this week" use Eastern time. */
const LEAGUE_TIME_ZONE = 'America/New_York';
export const todayInLeague = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: LEAGUE_TIME_ZONE }).format(now);

@Injectable()
export class SeasonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notices: AnnouncementsService,
    private readonly memberships: MembershipService,
  ) {}

  async list(leagueId: string) {
    const today = todayInLeague();
    return this.db
      .select({
        id: seasons.id,
        name: seasons.name,
        status: seasons.status,
        startDate: seasons.startDate,
        weeks: sql<number>`count(${weeks.id})::int`,
        /** Rounds dated before today, and the next round still to play (for the season list). */
        past: sql<number>`(count(${weeks.id}) filter (where ${weeks.date} < ${today}))::int`,
        nextDate: sql<
          string | null
        >`min(${weeks.date}) filter (where ${weeks.date} >= ${today} and ${weeks.status} = 'scheduled')`,
      })
      .from(seasons)
      .leftJoin(weeks, eq(weeks.seasonId, seasons.id))
      .where(eq(seasons.leagueId, leagueId))
      .groupBy(seasons.id)
      .orderBy(desc(seasons.startDate));
  }

  private async season(leagueId: string, seasonId: string) {
    const [s] = await this.db
      .select()
      .from(seasons)
      .where(and(eq(seasons.id, seasonId), eq(seasons.leagueId, leagueId)))
      .limit(1);
    if (!s) throw new NotFoundException();
    return { ...s, settings: withDefaults(s.settings as Partial<LeagueSettings>) };
  }

  /** Creates a draft season with the league's rules and a starting roster to adjust. */
  async create(
    actor: SessionUser,
    leagueId: string,
    input: {
      name: string;
      startDate: string;
      courseId?: string | undefined;
      layoutIds?: string[] | undefined;
    },
  ) {
    const [league] = await this.db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
    if (!league) throw new NotFoundException();
    // Default: the pinned home course, else the only course with nines entered.
    const playable = await this.db
      .selectDistinct({ id: courses.id, pinned: courses.pinned })
      .from(courses)
      .innerJoin(layouts, and(eq(layouts.courseId, courses.id), isNull(layouts.retiredAt)));
    const courseId =
      input.courseId ??
      playable.find((c) => c.pinned)?.id ??
      (playable.length === 1 ? playable[0]!.id : undefined);
    if (!courseId || !playable.some((c) => c.id === courseId))
      throw new BadRequestException('Choose a course with its nines entered.');
    if (input.layoutIds) {
      const ok = await this.db
        .select({ id: layouts.id })
        .from(layouts)
        .where(
          and(
            eq(layouts.courseId, courseId),
            isNull(layouts.retiredAt),
            inArray(layouts.id, input.layoutIds),
          ),
        );
      if (ok.length !== new Set(input.layoutIds).size)
        throw new BadRequestException('Choose nines from this course.');
    }

    // Start from the previous season's roster (players still active), else every active player.
    const active = await this.db
      .select({ id: players.id, nickname: players.nickname })
      .from(players)
      .where(and(eq(players.leagueId, leagueId), eq(players.active, true)))
      .orderBy(asc(players.nickname));
    const [previous] = await this.db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.leagueId, leagueId))
      .orderBy(desc(seasons.startDate))
      .limit(1);
    const prevRoster = previous
      ? await this.db
          .select({ playerId: seasonPlayers.playerId })
          .from(seasonPlayers)
          .where(eq(seasonPlayers.seasonId, previous.id))
          .orderBy(asc(seasonPlayers.spot))
      : [];
    const activeIds = new Set(active.map((p) => p.id));
    const carried = prevRoster.map((r) => r.playerId).filter((id) => activeIds.has(id));
    const rosterIds = carried.length ? carried : active.map((p) => p.id);
    const roster = rosterIds.map((id, i) => ({ id, spot: i + 1 }));

    try {
      return await this.db.transaction(async (tx) => {
        const [season] = await tx
          .insert(seasons)
          .values({
            leagueId,
            name: input.name,
            courseId,
            layoutIds: input.layoutIds ?? null,
            startDate: input.startDate,
            settings: withDefaults(league.settings as Partial<LeagueSettings>),
          })
          .returning();
        if (roster.length)
          await tx
            .insert(seasonPlayers)
            .values(roster.map((p) => ({ seasonId: season!.id, playerId: p.id, spot: p.spot })));
        await this.audit.record(
          {
            leagueId,
            actorUserId: actor.id,
            action: 'season.create',
            entityType: 'season',
            entityId: season!.id,
            after: { name: input.name, startDate: input.startDate, players: roster.length },
          },
          tx,
        );
        return season!;
      });
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new ConflictException(`There is already a season called "${input.name}".`);
      }
      throw err;
    }
  }

  /** (Re)generates the schedule of a draft season. A new seed gives a different mix. */
  async generate(actor: SessionUser, leagueId: string, seasonId: string, seedInput?: number) {
    const season = await this.season(leagueId, seasonId);
    if (season.status !== 'draft')
      throw new BadRequestException('Unlock the season before regenerating its schedule.');
    const roster = await this.db
      .select({ playerId: seasonPlayers.playerId })
      .from(seasonPlayers)
      .where(eq(seasonPlayers.seasonId, seasonId))
      .orderBy(asc(seasonPlayers.spot));
    if (roster.length < 4 || roster.length % 2 !== 0)
      throw new BadRequestException(
        `The schedule needs an even roster of at least 4 players (this season has ${roster.length}).`,
      );
    const courseLayouts = await this.db
      .select({ id: layouts.id })
      .from(layouts)
      .where(and(eq(layouts.courseId, season.courseId), isNull(layouts.retiredAt)))
      .orderBy(asc(layouts.sortOrder));
    if (courseLayouts.length === 0) throw new BadRequestException('This course has no layouts.');
    const ids = courseLayouts.map((l) => l.id);
    // The season's chosen nines (still current ones), else the league's nines setting.
    const chosen = (season.layoutIds ?? []).filter((id) => ids.includes(id));
    const nines = season.settings.nines;
    const rotation = chosen.length
      ? chosen
      : nines === 'alternate'
        ? ids.slice(0, 2)
        : nines === 'back'
          ? [ids[1] ?? ids[0]!]
          : [ids[0]!];

    const seed = seedInput ?? randomInt(1, 2 ** 31 - 1);
    const schedule = generateSeason({
      players: roster.map((r) => r.playerId),
      weeks: season.settings.season.regularSeasonWeeks,
      startDate: season.startDate,
      layouts: rotation,
      firstTeeTime: season.settings.teeTimes.firstTeeTime,
      intervalMinutes: season.settings.teeTimes.intervalMinutes,
      seed,
    });

    await this.db.transaction(async (tx) => {
      await tx.delete(weeks).where(eq(weeks.seasonId, seasonId));
      for (const w of schedule) {
        const [week] = await tx
          .insert(weeks)
          .values({ seasonId, round: w.round, date: w.date, layoutId: w.layout })
          .returning({ id: weeks.id });
        for (const g of w.groups) {
          const [group] = await tx
            .insert(groups)
            .values({ weekId: week!.id, slot: g.slot, teeTime: g.teeTime })
            .returning({ id: groups.id });
          await tx.insert(matches).values(
            g.matches.map(([a, b]) => ({
              weekId: week!.id,
              groupId: group!.id,
              playerAId: a,
              playerBId: b,
            })),
          );
        }
      }
      await tx.update(seasons).set({ seed }).where(eq(seasons.id, seasonId));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'season.generate',
          entityType: 'season',
          entityId: seasonId,
          after: { seed, weeks: schedule.length },
        },
        tx,
      );
    });
    return this.schedule(leagueId, seasonId);
  }

  /** The season with its full schedule, roster and a mixing report. */
  async schedule(leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const roster = await this.db
      .select({
        playerId: seasonPlayers.playerId,
        spot: seasonPlayers.spot,
        nickname: players.nickname,
        fullName: players.fullName,
        handicap: players.handicap,
        userId: players.userId,
      })
      .from(seasonPlayers)
      .innerJoin(players, eq(players.id, seasonPlayers.playerId))
      .where(eq(seasonPlayers.seasonId, seasonId))
      .orderBy(asc(seasonPlayers.spot));
    const ws = await this.db
      .select({
        id: weeks.id,
        round: weeks.round,
        date: weeks.date,
        status: weeks.status,
        layout: layouts.name,
        layoutId: weeks.layoutId,
        playoffRound: weeks.playoffRound,
        isFinal: weeks.isFinal,
      })
      .from(weeks)
      .innerJoin(layouts, eq(layouts.id, weeks.layoutId))
      .where(eq(weeks.seasonId, seasonId))
      .orderBy(asc(weeks.round));
    const weekIds = ws.map((w) => w.id);
    const gs = weekIds.length
      ? await this.db
          .select()
          .from(groups)
          .where(inArray(groups.weekId, weekIds))
          .orderBy(asc(groups.slot))
      : [];
    const ms = weekIds.length
      ? await this.db.select().from(matches).where(inArray(matches.weekId, weekIds))
      : [];
    const outs = weekIds.length
      ? await this.db.select().from(roundAbsences).where(inArray(roundAbsences.weekId, weekIds))
      : [];

    const weeksOut = ws.map((w) => ({
      ...w,
      /** Players who said ahead of time they can't make it. */
      absences: outs
        .filter((a) => a.weekId === w.id)
        .map((a) => ({ playerId: a.playerId, subName: a.subName })),
      groups: gs
        .filter((g) => g.weekId === w.id)
        .map((g) => ({
          id: g.id,
          slot: g.slot,
          teeTime: g.teeTime,
          matches: ms
            .filter((m) => m.groupId === g.id)
            .map((m) => ({ id: m.id, playerA: m.playerAId, playerB: m.playerBId })),
        })),
    }));

    // The mixing report covers the regular season only.
    const asScheduled: ScheduledWeek[] = weeksOut
      .filter((w) => w.playoffRound === null)
      .map((w) => ({
        round: w.round,
        date: w.date,
        layout: w.layout,
        groups: w.groups.map((g) => ({
          slot: g.slot,
          teeTime: g.teeTime,
          matches: g.matches.map((m) => [m.playerA, m.playerB] as [string, string]),
        })),
      }));
    const report = asScheduled.length
      ? diversityReport(
          roster.map((r) => r.playerId),
          asScheduled,
        )
      : null;

    return {
      season: {
        id: season.id,
        name: season.name,
        status: season.status,
        startDate: season.startDate,
        seed: season.seed,
        settings: season.settings,
        coverPhotoId: season.coverPhotoId,
        course: (
          await this.db
            .select({ id: courses.id, name: courses.name })
            .from(courses)
            .where(eq(courses.id, season.courseId))
        )[0]!,
        nines: (
          await this.db
            .select({ id: layouts.id, name: layouts.name, retiredAt: layouts.retiredAt })
            .from(layouts)
            .where(eq(layouts.courseId, season.courseId))
            .orderBy(asc(layouts.sortOrder))
        )
          .filter((l) =>
            season.layoutIds?.length ? season.layoutIds.includes(l.id) : l.retiredAt === null,
          )
          .map(({ id, name }) => ({ id, name }))
          .sort(
            (a, b) =>
              (season.layoutIds?.indexOf(a.id) ?? 0) - (season.layoutIds?.indexOf(b.id) ?? 0),
          ),
      },
      roster,
      weeks: weeksOut,
      report: report && {
        pairsMet: report.pairsMet,
        possiblePairs: report.possiblePairs,
        maxOpponentRepeats: report.maxOpponentRepeats,
        maxGroupMateRepeats: report.maxGroupMateRepeats,
        everyoneTeesFirstAndLast: Object.values(report.teeSlotRange).every(
          ([lo, hi]) =>
            lo === 0 && hi === Math.max(0, ...asScheduled.map((w) => w.groups.length - 1)),
        ),
      },
    };
  }

  async setLocked(actor: SessionUser, leagueId: string, seasonId: string, locked: boolean) {
    const season = await this.season(leagueId, seasonId);
    if (locked) {
      if (season.status !== 'draft')
        throw new BadRequestException('This season is already locked.');
      const [{ n } = { n: 0 }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(weeks)
        .where(eq(weeks.seasonId, seasonId));
      if (n === 0) throw new BadRequestException('Generate the schedule before locking it.');
    } else {
      if (season.status !== 'scheduled')
        throw new BadRequestException('This season is not locked.');
      const [played] = await this.db
        .select({ id: weeks.id })
        .from(weeks)
        .where(and(eq(weeks.seasonId, seasonId), eq(weeks.status, 'played')))
        .limit(1);
      if (played)
        throw new BadRequestException("A season can't be unlocked once rounds have been played.");
      // Regenerating or changing the roster deletes the schedule, and every card with it.
      const [card] = await this.db
        .select({ id: scorecards.id })
        .from(scorecards)
        .innerJoin(groups, eq(groups.id, scorecards.groupId))
        .innerJoin(weeks, eq(weeks.id, groups.weekId))
        .where(eq(weeks.seasonId, seasonId))
        .limit(1);
      if (card)
        throw new BadRequestException(
          "A season can't be unlocked once scores have been entered on a card.",
        );
    }
    await this.db
      .update(seasons)
      .set({ status: locked ? 'scheduled' : 'draft', lockedAt: locked ? new Date() : null })
      .where(eq(seasons.id, seasonId));
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: locked ? 'season.lock' : 'season.unlock',
      entityType: 'season',
      entityId: seasonId,
    });
    return this.schedule(leagueId, seasonId);
  }

  /** Deletes a season with its schedule and scorecards (e.g. a test season). Audited. */
  /**
   * Sets a draft season's roster: players in spot order (spot 1 first). Any generated
   * schedule is cleared, since it was built for the old roster.
   */
  async setRoster(actor: SessionUser, leagueId: string, seasonId: string, playerIds: string[]) {
    const season = await this.season(leagueId, seasonId);
    if (season.status !== 'draft')
      throw new BadRequestException(
        'The roster is set once the schedule is locked. Unlock it first.',
      );
    if (new Set(playerIds).size !== playerIds.length)
      throw new BadRequestException('A player can only hold one spot.');
    const known = playerIds.length
      ? await this.db
          .select({ id: players.id })
          .from(players)
          .where(and(eq(players.leagueId, leagueId), inArray(players.id, playerIds)))
      : [];
    if (known.length !== playerIds.length)
      throw new BadRequestException('Every player must belong to this league.');
    const before = await this.db
      .select({ playerId: seasonPlayers.playerId })
      .from(seasonPlayers)
      .where(eq(seasonPlayers.seasonId, seasonId))
      .orderBy(asc(seasonPlayers.spot));
    await this.db.transaction(async (tx) => {
      await tx.delete(weeks).where(eq(weeks.seasonId, seasonId));
      await tx.delete(seasonPlayers).where(eq(seasonPlayers.seasonId, seasonId));
      if (playerIds.length)
        await tx
          .insert(seasonPlayers)
          .values(playerIds.map((playerId, i) => ({ seasonId, playerId, spot: i + 1 })));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'season.roster',
          entityType: 'season',
          entityId: seasonId,
          before: { players: before.map((r) => r.playerId) },
          after: { players: playerIds },
        },
        tx,
      );
    });
    return this.schedule(leagueId, seasonId);
  }

  /** Chooses the photo across the top of the season page (any photo in the league), or clears it. */
  async setCover(actor: SessionUser, leagueId: string, seasonId: string, photoId: string | null) {
    const season = await this.season(leagueId, seasonId);
    if (photoId) {
      const [p] = await this.db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.id, photoId), eq(photos.leagueId, leagueId)))
        .limit(1);
      if (!p) throw new NotFoundException();
    }
    await this.db.update(seasons).set({ coverPhotoId: photoId }).where(eq(seasons.id, seasonId));
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'season.cover',
      entityType: 'season',
      entityId: seasonId,
      before: { photoId: season.coverPhotoId },
      after: { photoId },
    });
    return { coverPhotoId: photoId };
  }

  async remove(actor: SessionUser, leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(weeks)
      .where(eq(weeks.seasonId, seasonId));
    await this.db.transaction(async (tx) => {
      await tx.delete(seasons).where(eq(seasons.id, seasonId));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'season.delete',
          entityType: 'season',
          entityId: seasonId,
          before: { name: season.name, status: season.status, rounds: n },
        },
        tx,
      );
    });
  }

  /** Skips a rained-out round instead of sliding the schedule: no points, other dates unchanged. */
  async skip(actor: SessionUser, leagueId: string, seasonId: string, weekId: string) {
    const season = await this.season(leagueId, seasonId);
    if (season.status !== 'scheduled')
      throw new BadRequestException('Lock the schedule before skipping rounds.');
    const [week] = await this.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.id, weekId), eq(weeks.seasonId, seasonId)))
      .limit(1);
    if (!week) throw new NotFoundException();
    if (week.status !== 'scheduled')
      throw new BadRequestException('Only an unplayed round can be skipped.');
    const submitted = await this.db
      .select({ id: scorecards.id })
      .from(scorecards)
      .innerJoin(groups, eq(groups.id, scorecards.groupId))
      .where(and(eq(groups.weekId, weekId), ne(scorecards.status, 'draft')))
      .limit(1);
    if (submitted.length) throw new BadRequestException('This round already has submitted cards.');
    await this.db.update(weeks).set({ status: 'skipped' }).where(eq(weeks.id, weekId));
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'week.skip',
      entityType: 'week',
      entityId: weekId,
      before: { round: week.round, date: week.date },
    });
    await this.notices.notify(leagueId, {
      audience: 'league',
      kind: 'week.skip',
      title: `Round ${week.round} is off`,
      body: `Round ${week.round} (${week.date}) won't be played, and no points are given for it.`,
    });
    return this.schedule(leagueId, seasonId);
  }

  /** Swaps two players' places in one round of a draft schedule. */
  async swap(
    actor: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    playerA: string,
    playerB: string,
  ) {
    const season = await this.season(leagueId, seasonId);
    if (season.status !== 'draft')
      throw new BadRequestException('Unlock the season to change pairings.');
    const [week] = await this.db
      .select({ id: weeks.id })
      .from(weeks)
      .where(and(eq(weeks.id, weekId), eq(weeks.seasonId, seasonId)))
      .limit(1);
    if (!week) throw new NotFoundException();
    const ms = await this.db.select().from(matches).where(eq(matches.weekId, weekId));
    if (!ms.length) throw new NotFoundException();
    const inWeek = (p: string) => ms.some((m) => m.playerAId === p || m.playerBId === p);
    if (!inWeek(playerA) || !inWeek(playerB))
      throw new BadRequestException('Both players must be in this round.');
    if (
      ms.some(
        (m) =>
          [m.playerAId, m.playerBId].includes(playerA) &&
          [m.playerAId, m.playerBId].includes(playerB),
      )
    ) {
      throw new BadRequestException('Those two already play each other this round.');
    }
    const swap = (p: string) => (p === playerA ? playerB : p === playerB ? playerA : p);
    await this.db.transaction(async (tx) => {
      for (const m of ms) {
        if ([m.playerAId, m.playerBId].some((p) => p === playerA || p === playerB)) {
          await tx
            .update(matches)
            .set({ playerAId: swap(m.playerAId), playerBId: swap(m.playerBId) })
            .where(eq(matches.id, m.id));
        }
      }
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'week.swap',
          entityType: 'week',
          entityId: weekId,
          after: { playerA, playerB },
        },
        tx,
      );
    });
    return this.schedule(leagueId, seasonId);
  }

  /**
   * Game-day changes are open to admins and to anyone playing that round (they're the ones
   * at the course). Returns the round, which must be an unplayed round of a locked season.
   */
  private async gameDayRound(
    actor: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
  ) {
    const season = await this.season(leagueId, seasonId);
    if (season.status !== 'scheduled')
      throw new BadRequestException('Only a locked schedule can be changed on game day.');
    const [week] = await this.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.id, weekId), eq(weeks.seasonId, seasonId)))
      .limit(1);
    if (!week) throw new NotFoundException();
    if (week.status !== 'scheduled')
      throw new BadRequestException('This round has already been played or skipped.');
    if ((await this.memberships.roleIn(actor, leagueId)) !== 'admin') {
      const [plays] = await this.db
        .select({ id: matches.id })
        .from(matches)
        .innerJoin(players, sql`${players.id} in (${matches.playerAId}, ${matches.playerBId})`)
        .where(and(eq(matches.weekId, weekId), eq(players.userId, actor.id)))
        .limit(1);
      if (!plays)
        throw new ForbiddenException('Only admins and the players in this round can change it.');
    }
    return week;
  }

  /**
   * Tee order: moves a foursome one place earlier or later. The tee times stay in place,
   * so the two foursomes trade times. Nothing about the matches changes.
   */
  async teeOrder(
    actor: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
    direction: 'up' | 'down',
  ) {
    const week = await this.gameDayRound(actor, leagueId, seasonId, weekId);
    const gs = await this.db
      .select()
      .from(groups)
      .where(eq(groups.weekId, weekId))
      .orderBy(asc(groups.slot));
    const i = gs.findIndex((g) => g.id === groupId);
    if (i < 0) throw new NotFoundException();
    const j = direction === 'up' ? i - 1 : i + 1;
    const [g, other] = [gs[i]!, gs[j]];
    if (!other)
      throw new BadRequestException(
        `That foursome is already ${direction === 'up' ? 'first' : 'last'} off.`,
      );
    await this.db.transaction(async (tx) => {
      // Slots are unique per round, so park one out of the way first.
      await tx.update(groups).set({ slot: -1 }).where(eq(groups.id, g.id));
      await tx
        .update(groups)
        .set({ slot: g.slot, teeTime: g.teeTime })
        .where(eq(groups.id, other.id));
      await tx
        .update(groups)
        .set({ slot: other.slot, teeTime: other.teeTime })
        .where(eq(groups.id, g.id));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'week.tee_order',
          entityType: 'week',
          entityId: weekId,
          before: { groupId: g.id, slot: g.slot },
          after: { groupId: g.id, slot: other.slot, round: week.round },
        },
        tx,
      );
    });
    return this.schedule(leagueId, seasonId);
  }

  /**
   * Regroup: two matches trade foursomes (each match keeps its two players), e.g. so a late
   * player's match goes off later. Only while neither foursome has a card started, so no
   * scores ever move.
   */
  async regroup(
    actor: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    matchA: string,
    matchB: string,
  ) {
    const week = await this.gameDayRound(actor, leagueId, seasonId, weekId);
    const ms = await this.db
      .select()
      .from(matches)
      .where(and(eq(matches.weekId, weekId), inArray(matches.id, [matchA, matchB])));
    const a = ms.find((m) => m.id === matchA);
    const b = ms.find((m) => m.id === matchB);
    if (!a || !b) throw new NotFoundException();
    if (a.groupId === b.groupId)
      throw new BadRequestException('Those two matches are already in the same foursome.');
    const started = await this.db
      .select({ id: scorecards.id })
      .from(scorecards)
      .where(inArray(scorecards.groupId, [a.groupId, b.groupId]))
      .limit(1);
    if (started.length)
      throw new BadRequestException(
        "A card has already been started for one of these foursomes, so they can't be regrouped.",
      );
    await this.db.transaction(async (tx) => {
      await tx.update(matches).set({ groupId: b.groupId }).where(eq(matches.id, a.id));
      await tx.update(matches).set({ groupId: a.groupId }).where(eq(matches.id, b.id));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'week.regroup',
          entityType: 'week',
          entityId: weekId,
          before: { [a.id]: a.groupId, [b.id]: b.groupId },
          after: { [a.id]: b.groupId, [b.id]: a.groupId, round: week.round },
        },
        tx,
      );
    });
    return this.schedule(leagueId, seasonId);
  }

  /**
   * "Can't make it": a player marks themselves out of an upcoming round (an admin can mark
   * anyone), optionally naming a sub. Their foursome gets a notice, and the card starts with
   * them absent. Only before their foursome's card is started; after that, mark it on the card.
   */
  async setAbsence(
    actor: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    playerId: string,
    out: { subName?: string | null | undefined } | null,
  ) {
    const week = await this.gameDayRound(actor, leagueId, seasonId, weekId);
    const [match] = await this.db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.weekId, weekId),
          sql`${playerId} in (${matches.playerAId}, ${matches.playerBId})`,
        ),
      )
      .limit(1);
    if (!match) throw new NotFoundException("That player isn't in this round.");
    const [player] = await this.db.select().from(players).where(eq(players.id, playerId)).limit(1);
    const isAdmin = (await this.memberships.roleIn(actor, leagueId)) === 'admin';
    if (!isAdmin && player!.userId !== actor.id)
      throw new ForbiddenException("You can only say you can't make it yourself; ask an admin.");
    const [card] = await this.db
      .select({ id: scorecards.id })
      .from(scorecards)
      .where(eq(scorecards.groupId, match.groupId))
      .limit(1);
    if (card)
      throw new BadRequestException(
        'Their foursome has started the card: mark them absent on the card instead.',
      );
    const subName = out?.subName?.trim() || null;
    if (out) {
      await this.db
        .insert(roundAbsences)
        .values({ weekId, playerId, subName, markedBy: actor.id })
        .onConflictDoUpdate({
          target: [roundAbsences.weekId, roundAbsences.playerId],
          set: { subName, markedBy: actor.id },
        });
    } else {
      await this.db
        .delete(roundAbsences)
        .where(and(eq(roundAbsences.weekId, weekId), eq(roundAbsences.playerId, playerId)));
    }
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: out ? 'week.absent' : 'week.absent_undo',
      entityType: 'week',
      entityId: weekId,
      after: { playerId, subName, round: week.round },
    });
    await this.notices.notify(leagueId, {
      audience: 'group',
      groupId: match.groupId,
      kind: out ? 'round.absent' : 'round.absent_undo',
      title: out
        ? `${player!.nickname} can't make round ${week.round}`
        : `${player!.nickname} is playing round ${week.round} after all`,
      body: out ? (subName ? `${subName} is subbing.` : 'No sub yet.') : '',
    });
    return this.schedule(leagueId, seasonId);
  }

  /** Rainout: this round and every later unplayed round move back one week. */
  async rainout(actor: SessionUser, leagueId: string, seasonId: string, weekId: string) {
    const season = await this.season(leagueId, seasonId);
    if (season.status !== 'scheduled')
      throw new BadRequestException('Lock the schedule before recording rainouts.');
    const [week] = await this.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.id, weekId), eq(weeks.seasonId, seasonId)))
      .limit(1);
    if (!week) throw new NotFoundException();
    if (week.status !== 'scheduled')
      throw new BadRequestException('Only an unplayed round can be rained out.');

    const later = await this.db
      .select()
      .from(weeks)
      .where(
        and(
          eq(weeks.seasonId, seasonId),
          gte(weeks.round, week.round),
          eq(weeks.status, 'scheduled'),
        ),
      );
    await this.db.transaction(async (tx) => {
      for (const w of later)
        await tx
          .update(weeks)
          .set({ date: addDays(w.date, 7) })
          .where(eq(weeks.id, w.id));
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'week.rainout',
          entityType: 'week',
          entityId: weekId,
          before: { date: week.date },
          after: { date: addDays(week.date, 7), moved: later.length },
        },
        tx,
      );
    });
    await this.notices.notify(leagueId, {
      audience: 'league',
      kind: 'week.rainout',
      title: `Rained out: round ${week.round}`,
      body: `Round ${week.round} moves to ${addDays(week.date, 7)}, and every later round moves back a week.`,
    });
    return this.schedule(leagueId, seasonId);
  }

  /** For each league the user plays in: their next round (today or later) of the locked season. */
  async thisWeek(user: SessionUser, today = todayInLeague()) {
    const mine = await this.db
      .select({
        leagueId: leagueMemberships.leagueId,
        leagueName: leagues.name,
        playerId: players.id,
      })
      .from(leagueMemberships)
      .innerJoin(leagues, eq(leagues.id, leagueMemberships.leagueId))
      .innerJoin(
        players,
        and(eq(players.leagueId, leagueMemberships.leagueId), eq(players.userId, user.id)),
      )
      .where(eq(leagueMemberships.userId, user.id));

    const out = [];
    for (const m of mine) {
      const [next] = await this.db
        .select({
          seasonId: seasons.id,
          seasonName: seasons.name,
          weekId: weeks.id,
          round: weeks.round,
          date: weeks.date,
          layout: layouts.name,
          rounds: sql<number>`(select count(*)::int from ${weeks} w2 where w2.season_id = ${seasons.id} and w2.playoff_round is null)`,
          playoffRound: weeks.playoffRound,
          isFinal: weeks.isFinal,
        })
        .from(weeks)
        .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
        .innerJoin(layouts, eq(layouts.id, weeks.layoutId))
        .where(
          and(
            eq(seasons.leagueId, m.leagueId),
            eq(seasons.status, 'scheduled'),
            eq(weeks.status, 'scheduled'),
            gte(weeks.date, today),
          ),
        )
        .orderBy(asc(weeks.date))
        .limit(1);
      if (!next) {
        out.push({ leagueId: m.leagueId, leagueName: m.leagueName, next: null });
        continue;
      }
      const gs = await this.db.select().from(groups).where(eq(groups.weekId, next.weekId));
      const ms = await this.db.select().from(matches).where(eq(matches.weekId, next.weekId));
      const myMatch = ms.find((x) => x.playerAId === m.playerId || x.playerBId === m.playerId);
      const group = gs.find((g) => g.id === myMatch?.groupId);
      const groupMatches = ms.filter((x) => x.groupId === group?.id);
      const names = new Map(
        (
          await this.db
            .select({ id: players.id, nickname: players.nickname })
            .from(players)
            .where(eq(players.leagueId, m.leagueId))
        ).map((p) => [p.id, p.nickname]),
      );
      out.push({
        leagueId: m.leagueId,
        leagueName: m.leagueName,
        next: {
          seasonId: next.seasonId,
          seasonName: next.seasonName,
          weekId: next.weekId,
          groupId: group?.id ?? null,
          round: next.round,
          rounds: next.rounds,
          playoffRound: next.playoffRound,
          isFinal: next.isFinal,
          date: next.date,
          layout: next.layout,
          teeTime: group?.teeTime ?? null,
          opponent: myMatch
            ? (names.get(
                myMatch.playerAId === m.playerId ? myMatch.playerBId : myMatch.playerAId,
              ) ?? null)
            : null,
          foursome: groupMatches.map((x) => [names.get(x.playerAId), names.get(x.playerBId)]),
          bye: !myMatch,
          playerId: m.playerId,
          /** Set when you've said you can't make it. */
          out: await this.db
            .select({ subName: roundAbsences.subName })
            .from(roundAbsences)
            .where(
              and(eq(roundAbsences.weekId, next.weekId), eq(roundAbsences.playerId, m.playerId)),
            )
            .limit(1)
            .then((r) => r[0] ?? null),
        },
      });
    }
    return out;
  }
}
