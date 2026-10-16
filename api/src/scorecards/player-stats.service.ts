import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  pointsFor,
  withDefaults,
  type Layout,
  type LeagueSettings,
  type Outcome,
} from '@teemate/shared';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { DB, type Database } from '../db/db.js';
import {
  cardRounds,
  courses,
  groups,
  holes,
  layouts,
  matches,
  players,
  scorecards,
  seasons,
  weeks,
} from '../db/schema.js';
import { finalsResult, knockoutResult } from '../playoffs/results.js';
import { holeStats, type HoleRound } from './hole-stats.js';
import { grossOf, matchResults, type RoundData } from './results.js';
import { effectiveStatus, ScorecardsService } from './scorecards.service.js';

export interface PlayerMatch {
  matchId: string;
  seasonId: string;
  season: string;
  weekId: string;
  groupId: string;
  round: number;
  playoffRound: number | null;
  date: string;
  opponentId: string;
  opponent: string;
  handicap: number | null;
  absent: boolean;
  gross: number | null;
  net: number | null;
  result: 'W' | 'L' | 'T' | null;
  points: number | null;
  official: boolean;
}

const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

@Injectable()
export class PlayerStatsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cards: ScorecardsService,
  ) {}

  private async layoutMap(layoutIds: string[]): Promise<Map<string, Layout>> {
    if (!layoutIds.length) return new Map();
    const ls = await this.db.select().from(layouts).where(inArray(layouts.id, layoutIds));
    const hs = await this.db.select().from(holes).where(inArray(holes.layoutId, layoutIds));
    return new Map(
      ls.map((l) => [
        l.id,
        {
          name: l.name,
          holes: hs
            .filter((h) => h.layoutId === l.id)
            .sort((a, b) => a.number - b.number)
            .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.strokeIndex })),
        },
      ]),
    );
  }

  /**
   * How each hole plays, per nine, from every submitted card with hole scores in the league
   * (or one season), plus one player's averages per hole when asked (EH-014).
   */
  async holes(leagueId: string, seasonId?: string, playerId?: string) {
    const rows = await this.db
      .select({
        layoutId: scorecards.layoutId,
        playerId: cardRounds.playerId,
        holeScores: cardRounds.holeScores,
        seasonId: seasons.id,
        seasonName: seasons.name,
        startDate: seasons.startDate,
      })
      .from(cardRounds)
      .innerJoin(scorecards, eq(scorecards.id, cardRounds.scorecardId))
      .innerJoin(groups, eq(groups.id, scorecards.groupId))
      .innerJoin(weeks, eq(weeks.id, groups.weekId))
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(
        and(
          eq(seasons.leagueId, leagueId),
          ne(scorecards.status, 'draft'),
          eq(cardRounds.attendance, 'played'),
        ),
      )
      .orderBy(desc(seasons.startDate));
    const withHoles = rows.filter((r) => r.holeScores.some((x) => typeof x === 'number'));
    const seasonList = [
      ...new Map(
        withHoles.map((r) => [r.seasonId, { id: r.seasonId, name: r.seasonName }]),
      ).values(),
    ];
    const counted = seasonId ? withHoles.filter((r) => r.seasonId === seasonId) : withHoles;
    const layoutIds = [...new Set(counted.map((r) => r.layoutId))];
    const layoutById = await this.layoutMap(layoutIds);
    const courseOf = new Map(
      layoutIds.length
        ? (
            await this.db
              .select({ id: layouts.id, course: courses.name })
              .from(layouts)
              .innerJoin(courses, eq(courses.id, layouts.courseId))
              .where(inArray(layouts.id, layoutIds))
          ).map((l) => [l.id, l.course])
        : [],
    );
    const nines = layoutIds.map((id) => {
      const layout = layoutById.get(id)!;
      const rounds: HoleRound[] = counted.filter((r) => r.layoutId === id);
      return {
        layoutId: id,
        name: layout.name,
        course: courseOf.get(id) ?? '',
        rounds: rounds.length,
        mine: playerId ? rounds.filter((r) => r.playerId === playerId).length : null,
        holes: holeStats(layout.holes, rounds, playerId),
      };
    });
    nines.sort((a, b) => b.rounds - a.rounds);
    return { seasons: seasonList, nines };
  }

  /** Everything about one player in a league: record by season, every match, scoring and head-to-head. */
  async history(leagueId: string, playerId: string) {
    const [player] = await this.db
      .select()
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.leagueId, leagueId)))
      .limit(1);
    if (!player) throw new NotFoundException();

    const rows = await this.db
      .select({ match: matches, week: weeks, season: seasons, groupId: groups.id })
      .from(matches)
      .innerJoin(weeks, eq(weeks.id, matches.weekId))
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .innerJoin(groups, eq(groups.id, matches.groupId))
      .where(
        and(
          eq(seasons.leagueId, leagueId),
          or(eq(matches.playerAId, playerId), eq(matches.playerBId, playerId)),
        ),
      );
    const groupIds = rows.map((r) => r.groupId);
    const cs = groupIds.length
      ? await this.db.select().from(scorecards).where(inArray(scorecards.groupId, groupIds))
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
    const layoutById = await this.layoutMap([...new Set(cs.map((c) => c.layoutId))]);
    const names = new Map(
      (
        await this.db
          .select({ id: players.id, nickname: players.nickname })
          .from(players)
          .where(eq(players.leagueId, leagueId))
      ).map((p) => [p.id, p.nickname]),
    );

    const matchesOut: PlayerMatch[] = [];
    for (const r of rows) {
      const card = cs.find((c) => c.groupId === r.groupId);
      if (!card) continue;
      const settings = withDefaults(r.season.settings as Partial<LeagueSettings>);
      const isPlayoff = r.week.playoffRound !== null;
      if (
        effectiveStatus(card, settings.scorecards.disputeWindowHours) === 'draft' &&
        !(isPlayoff && r.match.decidedWinnerId)
      )
        continue;
      const rounds: RoundData[] = rs
        .filter((x) => x.scorecardId === card.id)
        .map((x) => ({
          playerId: x.playerId,
          handicap: x.handicap,
          attendance: x.attendance,
          holeScores: x.holeScores,
          gross: x.gross,
        }));
      const side = r.match.playerAId === playerId ? 'A' : 'B';
      const opponent = side === 'A' ? r.match.playerBId : r.match.playerAId;
      const [res] = matchResults(
        [
          {
            id: r.match.id,
            playerA: r.match.playerAId,
            playerB: r.match.playerBId,
            recordedOutcome: r.match.recordedOutcome,
          },
        ],
        rounds,
        layoutById.get(card.layoutId)!,
      );
      const mine = rounds.find((x) => x.playerId === playerId);
      const layout = layoutById.get(card.layoutId)!;
      const outcome = res?.result?.outcome;
      // Playoffs follow their own rules (card tie-breaks, absences lose, admin decisions,
      // the Finals foursome), exactly as the bracket shows them.
      let playoff: { result: 'W' | 'L' | null; net: number | null } | null = null;
      if (isPlayoff) {
        let winner: string | null;
        let net: number | null;
        if (r.week.isFinal) {
          const group = await this.db.select().from(matches).where(eq(matches.groupId, r.groupId));
          const finalists = group.flatMap((m) => [
            { playerId: m.playerAId, seed: m.seedA ?? 99 },
            { playerId: m.playerBId, seed: m.seedB ?? 99 },
          ]);
          const f = finalsResult(
            finalists,
            rounds,
            layout,
            settings,
            group.find((m) => m.decidedWinnerId)?.decidedWinnerId ?? null,
          );
          winner = f?.winner ?? null;
          net = f?.standings.find((x) => x.id === playerId)?.net ?? null;
        } else {
          const k = knockoutResult(
            {
              id: r.match.id,
              playerA: r.match.playerAId,
              playerB: r.match.playerBId,
              seedA: r.match.seedA,
              seedB: r.match.seedB,
              bracketSlot: r.match.bracketSlot,
              decidedWinnerId: r.match.decidedWinnerId,
            },
            rounds,
            layout,
            settings,
          );
          winner = k.winner;
          net = k.net[side];
        }
        playoff = { result: winner ? (winner === playerId ? 'W' : 'L') : null, net };
      }
      matchesOut.push({
        matchId: r.match.id,
        seasonId: r.season.id,
        season: r.season.name,
        weekId: r.week.id,
        groupId: r.groupId,
        round: r.week.round,
        playoffRound: r.week.playoffRound,
        date: r.week.date,
        opponentId: opponent,
        opponent: names.get(opponent) ?? '?',
        handicap: mine?.handicap ?? null,
        absent: mine?.attendance === 'absent',
        gross: mine ? grossOf(mine) : null,
        net: playoff ? playoff.net : (res?.result?.net[side] ?? null),
        result: playoff
          ? playoff.result
          : outcome
            ? outcome === 'T'
              ? 'T'
              : outcome === side
                ? 'W'
                : 'L'
            : null,
        points:
          outcome && r.week.playoffRound === null
            ? pointsFor(outcome as Outcome, side, settings.points)
            : null,
        official: !playoff && res?.result?.decidedBy === 'official',
      });
    }
    matchesOut.sort((a, b) => b.date.localeCompare(a.date));

    const regular = matchesOut.filter((m) => m.playoffRound === null && m.result);
    const tally = (ms: typeof matchesOut) => ({
      W: ms.filter((m) => m.result === 'W').length,
      L: ms.filter((m) => m.result === 'L').length,
      T: ms.filter((m) => m.result === 'T').length,
    });

    // Season records: the official published standings where they exist, else the results.
    const seasonIds = [...new Set(matchesOut.map((m) => m.seasonId))];
    const seasonRows = seasonIds.length
      ? await this.db.select().from(seasons).where(inArray(seasons.id, seasonIds))
      : [];
    const bySeason = seasonRows
      .map((s) => {
        const official = s.officialStandings?.find((o) => o.name === player.nickname);
        const ms = regular.filter((m) => m.seasonId === s.id);
        const t = tally(ms);
        return {
          seasonId: s.id,
          season: s.name,
          startDate: s.startDate,
          ...(official
            ? {
                W: official.W,
                L: official.L,
                T: official.T,
                points: official.points,
                official: true,
              }
            : { ...t, points: ms.reduce((p, m) => p + (m.points ?? 0), 0), official: false }),
          rank: official && s.officialStandings ? s.officialStandings.indexOf(official) + 1 : null,
        };
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));

    const played = matchesOut.filter((m) => m.gross !== null);
    const best = played.reduce<(typeof played)[number] | null>(
      (b, m) => (!b || m.gross! < b.gross! ? m : b),
      null,
    );
    // Career record follows the season rows, so it agrees with the published standings.
    const total = {
      W: bySeason.reduce((n, x) => n + x.W, 0),
      L: bySeason.reduce((n, x) => n + x.L, 0),
      T: bySeason.reduce((n, x) => n + x.T, 0),
    };
    const decided = total.W + total.L + total.T;

    const h2h = new Map<
      string,
      { opponentId: string; opponent: string; W: number; L: number; T: number; last: string }
    >();
    for (const m of regular) {
      const e = h2h.get(m.opponentId) ?? {
        opponentId: m.opponentId,
        opponent: m.opponent,
        W: 0,
        L: 0,
        T: 0,
        last: m.date,
      };
      e[m.result as 'W' | 'L' | 'T'] += 1;
      if (m.date > e.last) e.last = m.date;
      h2h.set(m.opponentId, e);
    }

    return {
      player: {
        id: player.id,
        nickname: player.nickname,
        fullName: player.fullName,
        handicap: player.handicap,
      },
      stats: {
        rounds: played.length,
        scoringAverage: avg(played.map((m) => m.gross!)),
        netAverage: avg(
          played.filter((m) => m.handicap !== null).map((m) => m.gross! - m.handicap!),
        ),
        best: best ? { gross: best.gross, date: best.date, season: best.season } : null,
        winPct: decided ? Math.round((total.W / decided) * 100) : null,
        record: total,
      },
      seasons: bySeason,
      headToHead: [...h2h.values()].sort(
        (a, b) => b.W + b.L + b.T - (a.W + a.L + a.T) || a.opponent.localeCompare(b.opponent),
      ),
      matches: matchesOut,
    };
  }

  /** Scoring table for a season: rounds, scoring average, best round and net average (gross less the player's own handicap). */
  async seasonStats(leagueId: string, seasonId: string) {
    const { groups: gs } = await this.cards.seasonResults(leagueId, seasonId);
    const per = new Map<string, { gross: number[]; net: number[] }>();
    for (const g of gs) {
      if (g.status === 'draft' || g.playoffRound !== null) continue;
      for (const r of g.rounds) {
        if (r.gross === null) continue;
        const e = per.get(r.playerId) ?? { gross: [], net: [] };
        e.gross.push(r.gross);
        e.net.push(r.gross - r.handicap);
        per.set(r.playerId, e);
      }
    }
    const names = new Map(
      (
        await this.db
          .select({ id: players.id, nickname: players.nickname })
          .from(players)
          .where(eq(players.leagueId, leagueId))
      ).map((p) => [p.id, p.nickname]),
    );
    return [...per.entries()]
      .map(([playerId, e]) => ({
        playerId,
        nickname: names.get(playerId) ?? '?',
        rounds: e.gross.length,
        scoringAverage: avg(e.gross),
        best: Math.min(...e.gross),
        netAverage: avg(e.net),
      }))
      .sort((a, b) => (a.scoringAverage ?? 999) - (b.scoringAverage ?? 999));
  }
}
