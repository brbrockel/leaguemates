import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, teeTime, withDefaults, type Layout, type LeagueSettings } from '@teemate/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.js';
import type { SessionUser } from '../auth/decorators.js';
import { DB, type Database } from '../db/db.js';
import {
  cardRounds,
  groups,
  holes,
  layouts,
  matches,
  players,
  scorecards,
  seasons,
  weeks,
} from '../db/schema.js';
import { effectiveStatus, ScorecardsService } from '../scorecards/scorecards.service.js';
import type { RoundData } from '../scorecards/results.js';
import { finalsResult, knockoutResult } from './results.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class PlayoffsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cards: ScorecardsService,
    private readonly audit: AuditService,
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

  private async layoutsOf(
    courseId: string,
  ): Promise<(Layout & { id: string; retired: boolean })[]> {
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
    return ls.map((l) => ({
      id: l.id,
      name: l.name,
      retired: l.retiredAt !== null,
      holes: hs
        .filter((h) => h.layoutId === l.id)
        .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.strokeIndex })),
    }));
  }

  /** The full bracket: every playoff round with seeds, card status and who advanced, plus the champion. */
  async bracket(leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const courseLayouts = await this.layoutsOf(season.courseId);
    const ws = await this.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.seasonId, seasonId), isNotNull(weeks.playoffRound)))
      .orderBy(asc(weeks.playoffRound));
    const regularLeft = await this.db
      .select({ id: weeks.id })
      .from(weeks)
      .where(
        and(
          eq(weeks.seasonId, seasonId),
          isNull(weeks.playoffRound),
          eq(weeks.status, 'scheduled'),
        ),
      );
    const names = new Map(
      (
        await this.db
          .select({ id: players.id, nickname: players.nickname })
          .from(players)
          .where(eq(players.leagueId, leagueId))
      ).map((p) => [p.id, p.nickname]),
    );

    const rounds = [];
    let champion: string | null = null;
    for (const w of ws) {
      const gs = await this.db
        .select()
        .from(groups)
        .where(eq(groups.weekId, w.id))
        .orderBy(asc(groups.slot));
      const ms = await this.db
        .select()
        .from(matches)
        .where(eq(matches.weekId, w.id))
        .orderBy(asc(matches.bracketSlot));
      const cs = gs.length
        ? await this.db
            .select()
            .from(scorecards)
            .where(
              inArray(
                scorecards.groupId,
                gs.map((g) => g.id),
              ),
            )
        : [];
      const rs = cs.length
        ? await this.db
            .select()
            .from(cardRounds)
            .where(
              inArray(
                cardRounds.scorecardId,
                cs.map((c) => c.id),
              ),
            )
        : [];

      const roundsFor = (groupId: string): RoundData[] => {
        const card = cs.find((c) => c.groupId === groupId);
        return rs
          .filter((r) => r.scorecardId === card?.id)
          .map((r) => ({
            playerId: r.playerId,
            handicap: r.handicap,
            attendance: r.attendance,
            holeScores: r.holeScores,
            gross: r.gross,
          }));
      };
      const layoutFor = (groupId: string) => {
        const card = cs.find((c) => c.groupId === groupId);
        return courseLayouts.find((l) => l.id === (card?.layoutId ?? w.layoutId))!;
      };
      const cardStatus = (groupId: string) => {
        const card = cs.find((c) => c.groupId === groupId);
        return card ? effectiveStatus(card, season.settings.scorecards.disputeWindowHours) : null;
      };

      if (w.isFinal) {
        const g = gs[0]!;
        const finalists = ms.flatMap((m) => [
          { playerId: m.playerAId, seed: m.seedA ?? 99 },
          { playerId: m.playerBId, seed: m.seedB ?? 99 },
        ]);
        const counted = cardStatus(g.id) && cardStatus(g.id) !== 'draft';
        const result = counted
          ? finalsResult(
              finalists,
              roundsFor(g.id),
              layoutFor(g.id),
              season.settings,
              ms[0]?.decidedWinnerId ?? null,
            )
          : null;
        champion = result?.winner ?? null;
        rounds.push({
          weekId: w.id,
          round: w.playoffRound,
          isFinal: true,
          date: w.date,
          status: w.status,
          groups: [{ id: g.id, teeTime: g.teeTime, card: cardStatus(g.id) }],
          finalists: finalists.map((f) => ({ ...f, nickname: names.get(f.playerId) ?? '?' })),
          finals: result && {
            winner: result.winner,
            decidedBy: result.decidedBy,
            standings: result.standings.map((s) => ({ ...s, nickname: names.get(s.id) ?? '?' })),
          },
          matches: [],
        });
      } else {
        rounds.push({
          weekId: w.id,
          round: w.playoffRound,
          isFinal: false,
          date: w.date,
          status: w.status,
          groups: gs.map((g) => ({ id: g.id, teeTime: g.teeTime, card: cardStatus(g.id) })),
          matches: ms.map((m) => {
            const status = cardStatus(m.groupId);
            const res =
              m.decidedWinnerId || (status && status !== 'draft')
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
                    roundsFor(m.groupId),
                    layoutFor(m.groupId),
                    season.settings,
                  )
                : { winner: null, decidedBy: null, net: { A: null, B: null } };
            return {
              id: m.id,
              groupId: m.groupId,
              slot: m.bracketSlot,
              a: { playerId: m.playerAId, nickname: names.get(m.playerAId) ?? '?', seed: m.seedA },
              b: { playerId: m.playerBId, nickname: names.get(m.playerBId) ?? '?', seed: m.seedB },
              card: status,
              ...res,
              decidedReason: m.decidedReason,
            };
          }),
        });
      }
    }

    const format = season.settings.playoffs.format;
    return {
      format,
      canStart:
        season.status === 'scheduled' &&
        format !== 'none' &&
        ws.length === 0 &&
        regularLeft.length === 0,
      regularRoundsLeft: regularLeft.length,
      rounds,
      champion: champion ? { playerId: champion, nickname: names.get(champion) ?? '?' } : null,
    };
  }

  /** Seeds the playoffs from the regular-season standings and schedules the first round. */
  async start(actor: SessionUser, leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const view = await this.bracket(leagueId, seasonId);
    if (season.settings.playoffs.format === 'none')
      throw new BadRequestException('This league has no playoffs (League settings).');
    if (!view.canStart) {
      throw new BadRequestException(
        view.rounds.length
          ? 'The playoffs have already started.'
          : view.regularRoundsLeft
            ? `Finish the regular season first (${view.regularRoundsLeft} round${view.regularRoundsLeft === 1 ? '' : 's'} left).`
            : 'Lock the schedule first.',
      );
    }
    const standings = await this.cards.standings(leagueId, seasonId);
    const seeds = standings.rows.map((r) => r.playerId);
    const n = seeds.length;
    const knockout =
      season.settings.playoffs.format === 'knockout' && n >= 8 && (n & (n - 1)) === 0;
    if (!knockout && n < 4) throw new BadRequestException('Playoffs need at least 4 players.');

    await this.db.transaction(async (tx) => {
      if (knockout) {
        // 1 v n, 2 v n-1, ...; matches 1 and 2 share a foursome, and their winners meet next round.
        const pairs = Array.from({ length: n / 2 }, (_, i) => ({ a: i, b: n - 1 - i }));
        await this.createRound(
          tx,
          season,
          1,
          false,
          pairs.map((p, i) => ({
            slot: i + 1,
            a: seeds[p.a]!,
            b: seeds[p.b]!,
            seedA: p.a + 1,
            seedB: p.b + 1,
          })),
        );
      } else {
        await this.createRound(tx, season, 1, true, [
          { slot: 1, a: seeds[0]!, b: seeds[1]!, seedA: 1, seedB: 2 },
          { slot: 2, a: seeds[2]!, b: seeds[3]!, seedA: 3, seedB: 4 },
        ]);
      }
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'playoffs.start',
          entityType: 'season',
          entityId: seasonId,
          after: {
            seeds: seeds.slice(0, knockout ? n : 4),
            format: knockout ? 'knockout' : 'final_foursome',
          },
        },
        tx,
      );
    });
    return this.bracket(leagueId, seasonId);
  }

  /** Creates the next playoff round from the winners of the last one. */
  async advance(actor: SessionUser, leagueId: string, seasonId: string) {
    const season = await this.season(leagueId, seasonId);
    const view = await this.bracket(leagueId, seasonId);
    const last = view.rounds.at(-1);
    if (!last) throw new BadRequestException('The playoffs have not started.');
    if (last.isFinal) throw new BadRequestException('The Finals are the last round.');
    const undecided = last.matches.filter((m) => !m.winner);
    if (undecided.length) {
      throw new BadRequestException(
        `Not decided yet: ${undecided.map((m) => `${m.a.nickname} v ${m.b.nickname}`).join(', ')}. Submit those cards, or decide the match.`,
      );
    }
    const winners = last.matches.map((m) =>
      m.winner === m.a.playerId
        ? { id: m.a.playerId, seed: m.a.seed! }
        : { id: m.b.playerId, seed: m.b.seed! },
    );
    const pairs = Array.from({ length: winners.length / 2 }, (_, i) => {
      const [x, y] = [winners[2 * i]!, winners[2 * i + 1]!];
      const [a, b] = x.seed <= y.seed ? [x, y] : [y, x];
      return { slot: i + 1, a: a.id, b: b.id, seedA: a.seed, seedB: b.seed };
    });
    const isFinal = winners.length === 4;
    await this.db.transaction(async (tx) => {
      await this.createRound(tx, season, (last.round ?? 0) + 1, isFinal, pairs);
      await this.audit.record(
        {
          leagueId,
          actorUserId: actor.id,
          action: 'playoffs.advance',
          entityType: 'season',
          entityId: seasonId,
          after: { round: (last.round ?? 0) + 1, isFinal, players: winners.map((w) => w.id) },
        },
        tx,
      );
    });
    return this.bracket(leagueId, seasonId);
  }

  /** An admin decides a playoff match (or the Finals) the rules can't settle, e.g. both absent. */
  async decide(
    actor: SessionUser,
    leagueId: string,
    seasonId: string,
    matchId: string,
    winnerId: string,
    reason: string,
  ) {
    const [row] = await this.db
      .select({ match: matches, week: weeks })
      .from(matches)
      .innerJoin(weeks, eq(weeks.id, matches.weekId))
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(
        and(
          eq(matches.id, matchId),
          eq(seasons.id, seasonId),
          eq(seasons.leagueId, leagueId),
          isNotNull(weeks.playoffRound),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException();
    const inGroup = row.week.isFinal
      ? (await this.db.select().from(matches).where(eq(matches.weekId, row.week.id))).flatMap(
          (m) => [m.playerAId, m.playerBId],
        )
      : [row.match.playerAId, row.match.playerBId];
    if (!inGroup.includes(winnerId))
      throw new BadRequestException('The winner must be one of the players.');
    const target = row.week.isFinal ? eq(matches.weekId, row.week.id) : eq(matches.id, matchId);
    await this.db
      .update(matches)
      .set({ decidedWinnerId: winnerId, decidedReason: reason })
      .where(target);
    await this.audit.record({
      leagueId,
      actorUserId: actor.id,
      action: 'playoffs.decide',
      entityType: 'match',
      entityId: matchId,
      after: { winnerId },
      reason,
    });
    return this.bracket(leagueId, seasonId);
  }

  /** Schedules a playoff round the week after the latest round, on the other nine. */
  private async createRound(
    tx: Tx,
    season: Awaited<ReturnType<PlayoffsService['season']>>,
    playoffRound: number,
    isFinal: boolean,
    pairs: { slot: number; a: string; b: string; seedA: number; seedB: number }[],
  ) {
    const [latest] = await tx
      .select()
      .from(weeks)
      .where(eq(weeks.seasonId, season.id))
      .orderBy(desc(weeks.round))
      .limit(1);
    if (!latest) throw new BadRequestException('This season has no schedule.');
    const courseLayouts = await this.layoutsOf(season.courseId);
    const active = courseLayouts.filter((l) => !l.retired);
    const layoutId =
      active.find((l) => l.id !== latest.layoutId)?.id ?? active[0]?.id ?? latest.layoutId;
    const [week] = await tx
      .insert(weeks)
      .values({
        seasonId: season.id,
        round: latest.round + 1,
        date: addDays(latest.date, 7),
        layoutId,
        playoffRound,
        isFinal,
      })
      .returning();
    const perGroup = isFinal ? pairs.length : 2;
    for (let i = 0, slot = 0; i < pairs.length; i += perGroup, slot++) {
      const [group] = await tx
        .insert(groups)
        .values({
          weekId: week!.id,
          slot,
          teeTime: teeTime(
            season.settings.teeTimes.firstTeeTime,
            slot,
            season.settings.teeTimes.intervalMinutes,
          ),
        })
        .returning();
      await tx.insert(matches).values(
        pairs.slice(i, i + perGroup).map((p) => ({
          weekId: week!.id,
          groupId: group!.id,
          playerAId: p.a,
          playerBId: p.b,
          seedA: p.seedA,
          seedB: p.seedB,
          bracketSlot: p.slot,
        })),
      );
    }
  }
}
