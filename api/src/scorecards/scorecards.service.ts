import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CardGrid,
  computeStandings,
  type NetsByRound,
  withDefaults,
  type Layout,
  type LeagueSettings,
  type Outcome,
} from '@leaguemates/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { AnnouncementsService } from '../announcements/announcements.js';
import { AuditService } from '../audit/audit.js';
import type { SessionUser } from '../auth/decorators.js';
import { MembershipService } from '../auth/membership.service.js';
import { DB, type Database } from '../db/db.js';
import {
  cardGrids,
  cardRounds,
  courseImages,
  courses,
  groups,
  holes,
  layouts,
  matches,
  players,
  roundAbsences,
  scorecards,
  seasonPlayers,
  seasons,
  users,
  weeks,
} from '../db/schema.js';
import { finalsResult, knockoutResult } from '../playoffs/results.js';
import { grossOf, isComplete, matchResults, type RoundData } from './results.js';

type CardStatus = 'draft' | 'submitted' | 'disputed' | 'final';

interface GridRow {
  layoutId: string;
  imageId: string;
  grid: CardGrid;
  width: number;
  height: number;
  holes: number;
}
/** A nine's card, with the card whose name column it folds over (fold-over panels). */
const cardGridOf = (g: GridRow | undefined, all: GridRow[]) => {
  if (!g) return null;
  const names = g.grid.nameFrom ? all.find((x) => x.layoutId === g.grid.nameFrom) : undefined;
  return {
    imageId: g.imageId,
    grid: g.grid,
    width: g.width,
    height: g.height,
    names: names
      ? {
          imageId: names.imageId,
          grid: names.grid,
          width: names.width,
          height: names.height,
          holes: names.holes,
        }
      : null,
  };
};
type Card = typeof scorecards.$inferSelect;

export interface SaveCardInput {
  layoutId: string;
  version?: number | undefined;
  reason?: string | undefined;
  rounds: {
    playerId: string;
    handicap?: number | undefined;
    attendance: 'played' | 'absent';
    subName?: string | null | undefined;
    holeScores: (number | null)[];
  }[];
}

/** A submitted card becomes final once the dispute window has passed. */
export function effectiveStatus(
  card: Pick<Card, 'status' | 'submittedAt'>,
  windowHours: number,
  now = new Date(),
): CardStatus {
  if (
    card.status === 'submitted' &&
    card.submittedAt &&
    now.getTime() - card.submittedAt.getTime() >= windowHours * 3600_000
  ) {
    return 'final';
  }
  return card.status;
}

@Injectable()
export class ScorecardsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly memberships: MembershipService,
    private readonly audit: AuditService,
    private readonly notices: AnnouncementsService,
  ) {}

  /** Who did something, as the foursome knows them. */
  private by(
    user: SessionUser,
    c: { groupPlayers: { userId: string | null; nickname: string }[] },
  ) {
    return (
      c.groupPlayers.find((p) => p.userId === user.id)?.nickname ??
      user.nickname ??
      user.name?.split(/\s+/)[0] ??
      'An admin'
    );
  }

  /** A course's nines with their holes, in order. */
  async courseLayouts(courseId: string) {
    const ls = await this.db
      .select()
      .from(layouts)
      .where(eq(layouts.courseId, courseId))
      .orderBy(asc(layouts.sortOrder));
    const hs = ls.length
      ? await this.db
          .select()
          .from(holes)
          .where(
            inArray(
              holes.layoutId,
              ls.map((l) => l.id),
            ),
          )
          .orderBy(asc(holes.number))
      : [];
    const grids = ls.length
      ? await this.db
          .select({
            layoutId: cardGrids.layoutId,
            imageId: cardGrids.imageId,
            grid: cardGrids.grid,
            width: courseImages.width,
            height: courseImages.height,
          })
          .from(cardGrids)
          .innerJoin(courseImages, eq(courseImages.id, cardGrids.imageId))
          .where(
            inArray(
              cardGrids.layoutId,
              ls.map((l) => l.id),
            ),
          )
      : [];
    const withHoles = grids.map((g) => ({
      ...g,
      holes: hs.filter((h) => h.layoutId === g.layoutId).length,
    }));
    return ls.map((l) => ({
      id: l.id,
      name: l.name,
      tees: l.tees,
      retired: l.retiredAt !== null,
      holes: hs
        .filter((h) => h.layoutId === l.id)
        .map((h) => ({
          number: h.number,
          par: h.par,
          strokeIndex: h.strokeIndex,
          yards: h.yards,
        })),
      /** Where the scores go on a picture of the course's card, if it's set up. */
      cardGrid: cardGridOf(
        withHoles.find((g) => g.layoutId === l.id),
        withHoles,
      ),
    }));
  }

  /** Everything about one group's card, validating the league/season/week/group chain. */
  private async context(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
  ) {
    const [row] = await this.db
      .select({ season: seasons, week: weeks, group: groups })
      .from(groups)
      .innerJoin(weeks, eq(weeks.id, groups.weekId))
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(
        and(
          eq(groups.id, groupId),
          eq(weeks.id, weekId),
          eq(seasons.id, seasonId),
          eq(seasons.leagueId, leagueId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException();
    const settings = withDefaults(row.season.settings as Partial<LeagueSettings>);

    const ms = await this.db.select().from(matches).where(eq(matches.groupId, groupId));
    const ids = ms.flatMap((m) => [m.playerAId, m.playerBId]);
    const ps = await this.db
      .select({
        id: players.id,
        nickname: players.nickname,
        userId: players.userId,
        handicap: players.handicap,
      })
      .from(players)
      .where(inArray(players.id, ids));
    const byId = new Map(ps.map((p) => [p.id, p]));
    const groupPlayers = ids.map((id) => byId.get(id)!);

    const [card] = await this.db
      .select()
      .from(scorecards)
      .where(eq(scorecards.groupId, groupId))
      .limit(1);
    const rounds = card
      ? await this.db.select().from(cardRounds).where(eq(cardRounds.scorecardId, card.id))
      : [];
    const courseLayouts = await this.courseLayouts(row.season.courseId);
    const [course] = await this.db
      .select({ name: courses.name, city: courses.city, state: courses.state })
      .from(courses)
      .where(eq(courses.id, row.season.courseId))
      .limit(1);

    const role = await this.memberships.roleIn(user, leagueId);
    const isAdmin = role === 'admin';
    const inGroup = groupPlayers.some((p) => p.userId === user.id);
    const status = card ? effectiveStatus(card, settings.scorecards.disputeWindowHours) : 'draft';
    return {
      ...row,
      settings,
      matches: ms,
      groupPlayers,
      card,
      rounds,
      status,
      courseLayouts,
      course: course ?? null,
      isAdmin,
      inGroup,
      seasonLocked: row.season.status === 'scheduled',
    };
  }

  private permissions(c: Awaited<ReturnType<ScorecardsService['context']>>) {
    // A skipped round has no points for anyone, so no cards either.
    const canEnter = c.seasonLocked && c.week.status !== 'skipped' && (c.isAdmin || c.inGroup);
    return {
      canEdit: canEnter && (c.isAdmin || c.status === 'draft'),
      canSubmit: canEnter && (c.status === 'draft' || (c.isAdmin && c.status === 'disputed')),
      canDispute: c.inGroup && c.status === 'submitted',
      canApprove: c.isAdmin && (c.status === 'submitted' || c.status === 'disputed'),
      needsReason: c.isAdmin && c.status !== 'draft',
    };
  }

  /** Every match of a round, with its foursome. */
  async matchesOf(weekId: string) {
    return this.db
      .select({
        id: matches.id,
        groupId: matches.groupId,
        playerA: matches.playerAId,
        playerB: matches.playerBId,
      })
      .from(matches)
      .where(eq(matches.weekId, weekId));
  }

  /** The foursomes of a round, in tee order (the round must belong to the league and season). */
  async groupIdsOf(leagueId: string, seasonId: string, weekId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: groups.id })
      .from(groups)
      .innerJoin(weeks, eq(weeks.id, groups.weekId))
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(and(eq(weeks.id, weekId), eq(seasons.id, seasonId), eq(seasons.leagueId, leagueId)))
      .orderBy(asc(groups.slot));
    if (rows.length === 0) throw new NotFoundException();
    return rows.map((r) => r.id);
  }

  async view(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
  ) {
    const c = await this.context(user, leagueId, seasonId, weekId, groupId);
    const layoutId = c.card?.layoutId ?? c.week.layoutId;
    const layout = c.courseLayouts.find((l) => l.id === layoutId)!;
    const rounds: RoundData[] = c.groupPlayers.map((p) => {
      const r = c.rounds.find((x) => x.playerId === p.id);
      return r
        ? {
            playerId: p.id,
            handicap: r.handicap,
            attendance: r.attendance,
            holeScores: r.holeScores,
            gross: r.gross,
          }
        : {
            playerId: p.id,
            handicap: p.handicap ?? 0,
            attendance: 'played',
            holeScores: layout.holes.map(() => null),
          };
    });
    const names = await this.userNames([c.card?.enteredBy, c.card?.disputedBy]);
    // Who said ahead of time they can't make it: the card starts with them absent.
    const outs = new Map(
      (
        await this.db
          .select({ playerId: roundAbsences.playerId, subName: roundAbsences.subName })
          .from(roundAbsences)
          .where(eq(roundAbsences.weekId, c.week.id))
      ).map((a) => [a.playerId, a.subName]),
    );

    return {
      round: c.week.round,
      date: c.week.date,
      teeTime: c.group.teeTime,
      plannedLayoutId: c.week.layoutId,
      /** For drawing the course's paper card. */
      course: c.course ? { id: c.season.courseId, ...c.course } : null,
      // Retired layouts only where this card or week already uses them.
      layouts: c.courseLayouts
        .filter((l) => !l.retired || l.id === c.card?.layoutId || l.id === c.week.layoutId)
        .map(({ retired: _, ...l }) => l),
      players: c.groupPlayers.map((p) => ({
        playerId: p.id,
        nickname: p.nickname,
        handicap: p.handicap,
        out: outs.has(p.id) ? { subName: outs.get(p.id) ?? null } : null,
      })),
      card: c.card
        ? {
            id: c.card.id,
            status: c.status,
            layoutId: c.card.layoutId,
            version: c.card.version,
            enteredBy: names.get(c.card.enteredBy ?? '') ?? null,
            submittedAt: c.card.submittedAt,
            finalAt: c.card.finalAt,
            dispute: c.card.disputeNote
              ? { note: c.card.disputeNote, by: names.get(c.card.disputedBy ?? '') ?? null }
              : null,
            rounds: c.rounds.map((r) => ({
              playerId: r.playerId,
              handicap: r.handicap,
              attendance: r.attendance,
              subName: r.subName,
              holeScores: r.holeScores,
              gross: r.gross,
            })),
          }
        : null,
      matches: matchResults(
        c.matches.map((m) => ({
          id: m.id,
          playerA: m.playerAId,
          playerB: m.playerBId,
          recordedOutcome: m.recordedOutcome,
        })),
        rounds,
        layout,
      ),
      disputeWindowHours: c.settings.scorecards.disputeWindowHours,
      permissions: this.permissions(c),
      playoff: c.week.playoffRound === null ? null : this.playoffView(c, rounds, layout),
    };
  }

  /** Knockout winners (or the Finals result) for a playoff group's card. */
  private playoffView(
    c: Awaited<ReturnType<ScorecardsService['context']>>,
    rounds: RoundData[],
    layout: Layout,
  ) {
    const counted = c.card && c.status !== 'draft';
    if (c.week.isFinal) {
      const finalists = c.matches.flatMap((m) => [
        { playerId: m.playerAId, seed: m.seedA ?? 99 },
        { playerId: m.playerBId, seed: m.seedB ?? 99 },
      ]);
      return {
        round: c.week.playoffRound,
        isFinal: true,
        seeds: Object.fromEntries(finalists.map((f) => [f.playerId, f.seed])),
        finals: counted
          ? finalsResult(
              finalists,
              rounds,
              layout,
              c.settings,
              c.matches[0]?.decidedWinnerId ?? null,
            )
          : null,
        knockout: [],
      };
    }
    return {
      round: c.week.playoffRound,
      isFinal: false,
      seeds: Object.fromEntries(
        c.matches.flatMap((m) => [
          [m.playerAId, m.seedA],
          [m.playerBId, m.seedB],
        ]),
      ),
      finals: null,
      knockout: c.matches.map((m) => ({
        id: m.id,
        ...(counted || m.decidedWinnerId
          ? knockoutResult(
              {
                id: m.id,
                playerA: m.playerAId,
                playerB: m.playerBId,
                seedA: m.seedA,
                seedB: m.seedB,
                bracketSlot: m.bracketSlot,
                decidedWinnerId: m.decidedWinnerId,
              },
              rounds,
              layout,
              c.settings,
            )
          : { winner: null, decidedBy: null, net: { A: null, B: null } }),
      })),
    };
  }

  private async userNames(ids: (string | null | undefined)[]) {
    const wanted = ids.filter((i): i is string => Boolean(i));
    if (!wanted.length) return new Map<string, string>();
    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, wanted));
    return new Map(rows.map((r) => [r.id, r.name ?? r.email]));
  }

  async save(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
    input: SaveCardInput,
  ) {
    const c = await this.context(user, leagueId, seasonId, weekId, groupId);
    const perms = this.permissions(c);
    if (!c.seasonLocked)
      throw new BadRequestException('Scores can be entered once the schedule is locked.');
    if (c.week.status === 'skipped')
      throw new BadRequestException('This round was skipped, so it has no cards.');
    if (!perms.canEdit) {
      throw new ForbiddenException(
        c.inGroup || c.isAdmin
          ? 'This card has been submitted. Dispute it if something is wrong.'
          : 'Only players in this group or an admin can enter this card.',
      );
    }
    if (perms.needsReason && !input.reason?.trim())
      throw new BadRequestException('Give a reason for changing a submitted card.');
    if (c.card && input.version !== undefined && input.version !== c.card.version) {
      throw new ConflictException(
        'Someone else saved this card while you were editing. Reload to see their changes.',
      );
    }
    const layout = c.courseLayouts.find((l) => l.id === input.layoutId);
    if (!layout) throw new BadRequestException('That nine is not on this course.');
    if (layout.retired && layout.id !== c.card?.layoutId && layout.id !== c.week.layoutId)
      throw new BadRequestException('That nine has been replaced by a newer version.');

    const expected = new Set(c.groupPlayers.map((p) => p.id));
    if (
      input.rounds.length !== expected.size ||
      !input.rounds.every((r) => expected.has(r.playerId))
    ) {
      throw new BadRequestException('The card must have exactly the players in this group.');
    }
    const rounds = input.rounds.map((r) => {
      if (r.holeScores.length !== layout.holes.length)
        throw new BadRequestException(`Enter ${layout.holes.length} hole scores per player.`);
      const player = c.groupPlayers.find((p) => p.id === r.playerId)!;
      const existing = c.rounds.find((x) => x.playerId === r.playerId);
      const handicap =
        c.isAdmin && r.handicap !== undefined
          ? r.handicap
          : (existing?.handicap ?? player.handicap);
      if (handicap === null || handicap === undefined) {
        throw new BadRequestException(
          `${player.nickname} has no handicap yet. An admin needs to set it on the roster.`,
        );
      }
      return {
        playerId: r.playerId,
        handicap,
        attendance: r.attendance,
        subName: r.attendance === 'absent' ? r.subName?.trim() || null : null,
        holeScores: r.attendance === 'absent' ? r.holeScores.map(() => null) : r.holeScores,
      };
    });

    await this.db.transaction(async (tx) => {
      const [card] = c.card
        ? await tx
            .update(scorecards)
            .set({
              layoutId: layout.id,
              enteredBy: user.id,
              version: c.card.version + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(scorecards.id, c.card.id), eq(scorecards.version, c.card.version)))
            .returning()
        : await tx
            .insert(scorecards)
            .values({ groupId, layoutId: layout.id, enteredBy: user.id })
            .returning();
      if (!card)
        throw new ConflictException(
          'Someone else saved this card while you were editing. Reload to see their changes.',
        );
      await tx.delete(cardRounds).where(eq(cardRounds.scorecardId, card.id));
      await tx.insert(cardRounds).values(rounds.map((r) => ({ ...r, scorecardId: card.id })));
      // Every save is recorded with the scores before and after; after submission it's an
      // admin correction and needs a reason.
      {
        await this.audit.record(
          {
            leagueId,
            actorUserId: user.id,
            action: perms.needsReason ? 'scorecard.override' : 'scorecard.save',
            entityType: 'scorecard',
            entityId: card.id,
            before: c.rounds.map((r) => ({
              playerId: r.playerId,
              handicap: r.handicap,
              attendance: r.attendance,
              holeScores: r.holeScores,
            })),
            after: rounds.map((r) => ({
              playerId: r.playerId,
              handicap: r.handicap,
              attendance: r.attendance,
              holeScores: r.holeScores,
            })),
            reason: input.reason ?? null,
          },
          tx,
        );
      }
    });
    if (perms.needsReason)
      await this.notices.notify(leagueId, {
        audience: 'group',
        groupId,
        kind: 'card.corrected',
        title: `Round ${c.week.round} card corrected`,
        body: `An admin changed your foursome's card. Reason: ${input.reason?.trim()}`,
      });
    return this.view(user, leagueId, seasonId, weekId, groupId);
  }

  async submit(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
  ) {
    const c = await this.context(user, leagueId, seasonId, weekId, groupId);
    if (!this.permissions(c).canSubmit)
      throw new ForbiddenException('You cannot submit this card.');
    if (!c.card) throw new BadRequestException('Enter the scores first.');
    const missing = c.groupPlayers.filter((p) => {
      const r = c.rounds.find((x) => x.playerId === p.id);
      return !r || !isComplete({ ...r, attendance: r.attendance });
    });
    if (missing.length)
      throw new BadRequestException(
        `Missing hole scores for ${missing.map((p) => p.nickname).join(', ')}.`,
      );

    await this.db
      .update(scorecards)
      .set({
        status: 'submitted',
        submittedAt: new Date(),
        disputeNote: null,
        disputedBy: null,
        version: c.card.version + 1,
      })
      .where(eq(scorecards.id, c.card.id));
    await this.audit.record({
      leagueId,
      actorUserId: user.id,
      action: 'scorecard.submit',
      entityType: 'scorecard',
      entityId: c.card.id,
    });
    await this.notices.notify(leagueId, {
      audience: 'group',
      groupId,
      kind: 'card.submitted',
      push: {
        url: `/leagues/${leagueId}/seasons/${seasonId}/weeks/${weekId}/groups/${groupId}`,
        exceptUserId: user.id,
      },
      title: `Round ${c.week.round} card submitted`,
      body: `${this.by(user, c)} submitted your foursome's card. If something's wrong, open it and dispute it within ${c.settings.scorecards.disputeWindowHours} hours.`,
    });
    await this.updateWeekStatus(weekId);
    return this.view(user, leagueId, seasonId, weekId, groupId);
  }

  async dispute(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
    note: string,
  ) {
    const c = await this.context(user, leagueId, seasonId, weekId, groupId);
    if (!this.permissions(c).canDispute || !c.card)
      throw new ForbiddenException(
        'Only players in this group can dispute a submitted card, within the dispute window.',
      );
    await this.db
      .update(scorecards)
      .set({
        status: 'disputed',
        disputeNote: note,
        disputedBy: user.id,
        version: c.card.version + 1,
      })
      .where(eq(scorecards.id, c.card.id));
    await this.audit.record({
      leagueId,
      actorUserId: user.id,
      action: 'scorecard.dispute',
      entityType: 'scorecard',
      entityId: c.card.id,
      reason: note,
    });
    await this.notices.notify(leagueId, {
      audience: 'group',
      groupId,
      kind: 'card.disputed',
      title: `Round ${c.week.round} card disputed`,
      body: `${this.by(user, c)}: ${note}`,
    });
    return this.view(user, leagueId, seasonId, weekId, groupId);
  }

  async approve(
    user: SessionUser,
    leagueId: string,
    seasonId: string,
    weekId: string,
    groupId: string,
  ) {
    const c = await this.context(user, leagueId, seasonId, weekId, groupId);
    if (!this.permissions(c).canApprove || !c.card)
      throw new ForbiddenException('Only an admin can approve a submitted card.');
    await this.db
      .update(scorecards)
      .set({ status: 'final', finalAt: new Date(), version: c.card.version + 1 })
      .where(eq(scorecards.id, c.card.id));
    await this.audit.record({
      leagueId,
      actorUserId: user.id,
      action: 'scorecard.approve',
      entityType: 'scorecard',
      entityId: c.card.id,
    });
    await this.updateWeekStatus(weekId);
    return this.view(user, leagueId, seasonId, weekId, groupId);
  }

  /** A week is played once every group's card has been submitted. */
  private async updateWeekStatus(weekId: string) {
    const gs = await this.db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.weekId, weekId));
    const cards = await this.db
      .select({ status: scorecards.status })
      .from(scorecards)
      .where(
        inArray(
          scorecards.groupId,
          gs.map((g) => g.id),
        ),
      );
    const done = cards.length === gs.length && cards.every((c) => c.status !== 'draft');
    await this.db
      .update(weeks)
      .set({ status: done ? 'played' : 'scheduled' })
      .where(and(eq(weeks.id, weekId), ne(weeks.status, 'skipped')));
  }

  /**
   * Results of every match in a season that has a submitted card, plus card
   * status per group. Draft cards don't count yet.
   */
  async seasonResults(leagueId: string, seasonId: string) {
    const [season] = await this.db
      .select()
      .from(seasons)
      .where(and(eq(seasons.id, seasonId), eq(seasons.leagueId, leagueId)))
      .limit(1);
    if (!season) throw new NotFoundException();
    const settings = withDefaults(season.settings as Partial<LeagueSettings>);
    const courseLayouts = new Map(
      (await this.courseLayouts(season.courseId)).map((l) => [l.id, l as Layout & { id: string }]),
    );

    const rows = await this.db
      .select({
        card: scorecards,
        groupId: groups.id,
        weekId: weeks.id,
        round: weeks.round,
        playoffRound: weeks.playoffRound,
      })
      .from(scorecards)
      .innerJoin(groups, eq(groups.id, scorecards.groupId))
      .innerJoin(weeks, eq(weeks.id, groups.weekId))
      .where(eq(weeks.seasonId, seasonId));
    const cardIds = rows.map((r) => r.card.id);
    const allRounds = cardIds.length
      ? await this.db.select().from(cardRounds).where(inArray(cardRounds.scorecardId, cardIds))
      : [];
    const allMatches = rows.length
      ? await this.db
          .select()
          .from(matches)
          .where(
            inArray(
              matches.groupId,
              rows.map((r) => r.groupId),
            ),
          )
      : [];

    return {
      settings,
      season,
      groups: rows.map((r) => {
        const status = effectiveStatus(r.card, settings.scorecards.disputeWindowHours);
        const layout = courseLayouts.get(r.card.layoutId)!;
        const rounds: RoundData[] = allRounds
          .filter((x) => x.scorecardId === r.card.id)
          .map((x) => ({
            playerId: x.playerId,
            handicap: x.handicap,
            attendance: x.attendance,
            holeScores: x.holeScores,
            gross: x.gross,
          }));
        return {
          groupId: r.groupId,
          weekId: r.weekId,
          round: r.round,
          playoffRound: r.playoffRound,
          status,
          layout: layout.name,
          rounds: rounds.map((x) => ({
            playerId: x.playerId,
            attendance: x.attendance,
            handicap: x.handicap,
            gross: grossOf(x),
          })),
          matches: matchResults(
            allMatches
              .filter((m) => m.groupId === r.groupId)
              .map((m) => ({
                id: m.id,
                playerA: m.playerAId,
                playerB: m.playerBId,
                recordedOutcome: m.recordedOutcome,
              })),
            rounds,
            layout,
          ),
        };
      }),
    };
  }

  /** Season standings from submitted cards (always calculated, never stored). */
  async standings(leagueId: string, seasonId: string) {
    const { settings, groups: gs, season } = await this.seasonResults(leagueId, seasonId);
    const roster = await this.db
      .select({
        playerId: seasonPlayers.playerId,
        spot: seasonPlayers.spot,
        nickname: players.nickname,
      })
      .from(seasonPlayers)
      .innerJoin(players, eq(players.id, seasonPlayers.playerId))
      .where(eq(seasonPlayers.seasonId, seasonId));
    // Playoff rounds never count towards the regular-season standings.
    const counted = gs.filter((g) => g.status !== 'draft' && g.playoffRound === null);
    const roundsCounted = new Set(counted.map((g) => g.round)).size;

    // Imported seasons show the final standings exactly as the league published them.
    if (season.officialStandings) {
      const byName = new Map(roster.map((r) => [r.nickname, r]));
      return {
        official: true,
        provisional: false,
        roundsCounted,
        rows: season.officialStandings.map((r, i) => ({
          rank: i + 1,
          playerId: byName.get(r.name)?.playerId ?? r.name,
          nickname: r.name,
          spot: byName.get(r.name)?.spot ?? i + 1,
          W: r.W,
          L: r.L,
          T: r.T,
          played: r.W + r.L + r.T,
          points: r.points,
        })),
      };
    }

    const recorded = counted.flatMap((g) =>
      g.matches
        .filter((m) => m.result)
        .map((m) => ({ a: m.playerA, b: m.playerB, outcome: m.result!.outcome as Outcome })),
    );
    // Net (gross minus handicap) per player per round played, for the last tie-break.
    const nets: NetsByRound = new Map();
    for (const g of counted)
      for (const r of g.rounds)
        if (r.attendance === 'played' && r.gross !== null) {
          if (!nets.has(r.playerId)) nets.set(r.playerId, new Map());
          nets.get(r.playerId)!.set(g.round, r.gross - r.handicap);
        }
    const rows = computeStandings(
      roster.map((r) => r.playerId),
      recorded,
      settings.points,
      nets,
    );
    const info = new Map(roster.map((r) => [r.playerId, r]));
    return {
      official: false,
      provisional: counted.some((g) => g.status !== 'final'),
      roundsCounted,
      rows: rows.map((r) => ({
        ...r,
        nickname: info.get(r.playerId)!.nickname,
        spot: info.get(r.playerId)!.spot,
      })),
    };
  }
}
