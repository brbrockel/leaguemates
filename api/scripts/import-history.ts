/**
 * Loads the league's spreadsheet history (tools/import/history_export.py output) into the
 * live league, so 2018-2026 sit alongside new seasons.
 *
 *   node dist/scripts/import-history.js history-export.json [--replace] [--drop-old]
 *   docker exec -i <container> node dist/scripts/import-history.js - --replace --drop-old < history-export.json
 *
 * - Seasons are imported as complete, with their final standings exactly as published and
 *   their own roster (the players in those standings, in finishing order).
 * - Names from the sheets are matched to the league's players (see canonical() for the
 *   nicknames that changed). Anyone not in the league is added as a past player.
 * - Each match keeps the official result, handicaps and gross totals. The sheets have no
 *   hole scores, tee times or record of who was absent. They list "Match 1..8": Matches 1
 *   and 2 played together and teed off first, 3 and 4 second, and so on.
 * - Which nine was played isn't recorded; weeks alternate front/back as the league does.
 * - --season <year> rebuilds just that imported season's rounds, roster and standings in
 *   place (after an export fix), keeping the season and what's linked to it.
 * - --replace removes previously imported seasons first; --drop-old deletes the separate
 *   "Wednesday League (History)" league from before the merge.
 */
import { DEFAULT_LEAGUE_SETTINGS, withDefaults, type LeagueSettings } from '@leaguemates/shared';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { createDb, createPool } from '../src/db/db.js';
import {
  auditLog,
  cardRounds,
  courses,
  groups,
  layouts,
  leagues,
  matches,
  photos,
  players,
  scorecards,
  seasonPlayers,
  seasons,
  weeks,
} from '../src/db/schema.js';

interface Side {
  name: string;
  handicap: number | null;
  gross: number | null;
}
interface ExportSeason {
  year: number;
  regularSeasonRounds: number;
  finalStandings: { name: string; W: number; L: number; T: number; points: number }[];
  weeks: {
    round: number;
    date: string;
    source: 'results' | 'schedule';
    matches: { a: Side; b: Side; recorded: 'A' | 'B' | 'T' | null }[];
  }[];
  report: Record<string, unknown>;
}

const LIVE_SLUG = 'wednesday-league';
const OLD_SLUG = 'wednesday-league-history';

/**
 * The league's name for someone on the sheets (confirmed with the league, 2026-10-15):
 * Anthony is Tony and Jerod is Jarrod. "Dave" was Doc, except from round 6 of 2021, when Doc
 * appears under his own name and a second Dave (handicap 5) took over Todd's spot, with Todd's
 * record: that's "Dave (stand-in for Todd)".
 * `round` is undefined for the season's final standings.
 */
function canonical(name: string, year: number, round?: number): string {
  if (name === 'Dave')
    return year === 2021 && (round === undefined || round >= 6)
      ? 'Dave (stand-in for Todd)'
      : 'Doc';
  return ({ Anthony: 'Tony', Jerod: 'Jarrod' } as Record<string, string>)[name] ?? name;
}

const [file, ...flags] = process.argv.slice(2);
const seasonFlag = flags.indexOf('--season');
const onlyYear = seasonFlag >= 0 ? Number(flags[seasonFlag + 1]) : null;
if (!file || (onlyYear !== null && !Number.isInteger(onlyYear))) {
  console.error(
    'Usage: import-history <export.json | -> [--replace [--drop-old] | --season <year>]',
  );
  process.exit(1);
}
const data = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8')) as {
  seasons: ExportSeason[];
};
if (onlyYear !== null) {
  data.seasons = data.seasons.filter((s) => s.year === onlyYear);
  if (!data.seasons.length) throw new Error(`The export has no ${onlyYear} season.`);
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);

try {
  const [league] = await db.select().from(leagues).where(eq(leagues.slug, LIVE_SLUG)).limit(1);
  if (!league) throw new Error(`No league with slug "${LIVE_SLUG}".`);
  const imported = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .where(and(eq(seasons.leagueId, league.id), isNotNull(seasons.officialStandings)));
  // --season rebuilds one imported season's rounds in place, keeping the season itself
  // (and so anything linked to it, such as its photos).
  const target = onlyYear !== null ? imported.find((s) => s.name === String(onlyYear)) : undefined;
  if (onlyYear !== null && !target) throw new Error(`No imported ${onlyYear} season to rebuild.`);
  if (onlyYear === null && imported.length && !flags.includes('--replace'))
    throw new Error('History is already imported. Re-run with --replace to rebuild it.');
  const [course] = await db.select().from(courses).orderBy(asc(courses.createdAt)).limit(1);
  if (!course) throw new Error('No course found (Timberlin should be seeded by migrations).');
  const nines = await db
    .select()
    .from(layouts)
    .where(eq(layouts.courseId, course.id))
    .orderBy(asc(layouts.sortOrder));

  // Names mapped to the league's, everywhere they appear.
  for (const s of data.seasons) {
    for (const r of s.finalStandings) r.name = canonical(r.name, s.year);
    for (const w of s.weeks)
      for (const m of w.matches)
        for (const p of [m.a, m.b]) p.name = canonical(p.name, s.year, w.round);
  }

  const summary = await db.transaction(async (tx) => {
    if (target) {
      const linked = await tx
        .select({ id: photos.id })
        .from(photos)
        .innerJoin(groups, eq(groups.id, photos.groupId))
        .innerJoin(weeks, eq(weeks.id, groups.weekId))
        .where(eq(weeks.seasonId, target.id))
        .limit(1);
      if (linked.length)
        throw new Error(`${onlyYear} has photos on its cards; rebuilding would unlink them.`);
      await tx.delete(weeks).where(eq(weeks.seasonId, target.id));
      await tx.delete(seasonPlayers).where(eq(seasonPlayers.seasonId, target.id));
    } else {
      for (const s of imported) await tx.delete(seasons).where(eq(seasons.id, s.id));
    }
    let dropped = false;
    if (!target && flags.includes('--drop-old')) {
      const [old] = await tx.select().from(leagues).where(eq(leagues.slug, OLD_SLUG)).limit(1);
      if (old) {
        await tx.delete(seasons).where(eq(seasons.leagueId, old.id));
        await tx.delete(leagues).where(eq(leagues.id, old.id));
        dropped = true;
      }
      // Handicaps no longer need to count rounds from another league.
      const settings = withDefaults(league.settings as Partial<LeagueSettings>);
      if (settings.handicap.includeLeagueId)
        await tx
          .update(leagues)
          .set({
            settings: { ...settings, handicap: { ...settings.handicap, includeLeagueId: null } },
          })
          .where(eq(leagues.id, league.id));
    }

    // Everyone who appears, matched to the league's players; newcomers are past players.
    const latestHandicap = new Map<string, number>();
    for (const s of data.seasons)
      for (const w of s.weeks)
        for (const m of w.matches)
          for (const p of [m.a, m.b])
            if (p.handicap !== null) latestHandicap.set(p.name, p.handicap);
    const names = [
      ...new Set(
        data.seasons.flatMap((s) => [
          ...s.finalStandings.map((r) => r.name),
          ...s.weeks.flatMap((w) => w.matches.flatMap((m) => [m.a.name, m.b.name])),
        ]),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const existing = await tx
      .select({ id: players.id, nickname: players.nickname })
      .from(players)
      .where(eq(players.leagueId, league.id));
    const playerId = new Map(existing.map((p) => [p.nickname.toLowerCase(), p.id]));
    const added: string[] = [];
    for (const nickname of names) {
      if (playerId.has(nickname.toLowerCase())) continue;
      const [p] = await tx
        .insert(players)
        .values({
          leagueId: league.id,
          nickname,
          handicap: latestHandicap.get(nickname) ?? null,
          active: false,
        })
        .returning({ id: players.id });
      playerId.set(nickname.toLowerCase(), p!.id);
      added.push(nickname);
    }
    const idOf = (name: string) => playerId.get(name.toLowerCase())!;

    let nMatches = 0;
    let nGroups = 0;
    for (const s of data.seasons) {
      const values = {
        leagueId: league.id,
        name: String(s.year),
        courseId: course.id,
        startDate: s.weeks[0]?.date ?? `${s.year}-04-15`,
        status: 'complete' as const,
        settings: {
          ...DEFAULT_LEAGUE_SETTINGS,
          season: { regularSeasonWeeks: s.regularSeasonRounds },
        },
        officialStandings: s.finalStandings.map(({ name, W, L, T, points }) => ({
          name,
          W,
          L,
          T,
          points,
        })),
      };
      const [season] = target
        ? await tx.update(seasons).set(values).where(eq(seasons.id, target.id)).returning()
        : await tx.insert(seasons).values(values).returning();
      await tx.insert(seasonPlayers).values(
        s.finalStandings.map((r, i) => ({
          seasonId: season!.id,
          playerId: idOf(r.name),
          spot: i + 1,
        })),
      );

      for (const w of s.weeks) {
        const layoutId = nines[(w.round - 1) % nines.length]!.id;
        const [week] = await tx
          .insert(weeks)
          .values({
            seasonId: season!.id,
            round: w.round,
            date: w.date,
            layoutId,
            status: 'played',
          })
          .returning();
        // Matches 1+2 are the first foursome off, 3+4 the second, and so on.
        const foursomes: (typeof w.matches)[] = [];
        for (let k = 0; k < w.matches.length; k += 2) {
          const pair = w.matches.slice(k, k + 2);
          const people = pair.flatMap((m) => [m.a.name, m.b.name]);
          // A name twice in one pair would be a sheet error; keep those matches apart.
          if (new Set(people).size === people.length) foursomes.push(pair);
          else foursomes.push(...pair.map((m) => [m]));
        }
        for (const [slot, ms] of foursomes.entries()) {
          const [group] = await tx
            .insert(groups)
            .values({ weekId: week!.id, slot, teeTime: '' })
            .returning();
          for (const m of ms)
            await tx.insert(matches).values({
              weekId: week!.id,
              groupId: group!.id,
              playerAId: idOf(m.a.name),
              playerBId: idOf(m.b.name),
              recordedOutcome: m.recorded,
            });
          const at = new Date(`${w.date}T23:00:00Z`);
          const [card] = await tx
            .insert(scorecards)
            .values({ groupId: group!.id, layoutId, status: 'final', submittedAt: at, finalAt: at })
            .returning();
          await tx.insert(cardRounds).values(
            ms
              .flatMap((m) => [m.a, m.b])
              .map((p) => ({
                scorecardId: card!.id,
                playerId: idOf(p.name),
                handicap: p.handicap ?? 0,
                // On a results sheet, a missing score means the player didn't play.
                attendance:
                  w.source === 'results' && !p.gross ? ('absent' as const) : ('played' as const),
                holeScores: [],
                gross: p.gross,
              })),
          );
          nMatches += ms.length;
          nGroups++;
        }
      }
    }

    const result = {
      league: league.name,
      seasons: data.seasons.map((s) => s.year),
      rebuiltInPlace: Boolean(target),
      pastPlayersAdded: added,
      matches: nMatches,
      foursomes: nGroups,
      droppedOldLeague: dropped,
    };
    await tx.insert(auditLog).values({
      leagueId: league.id,
      action: 'history.import',
      entityType: 'league',
      entityId: league.id,
      after: {
        ...result,
        reports: Object.fromEntries(data.seasons.map((s) => [s.year, s.report])),
      },
    });
    return result;
  });
  console.log(
    `Imported into ${summary.league}: seasons ${summary.seasons.join(', ')}; ${summary.matches} matches in ${summary.foursomes} foursomes; past players added: ${summary.pastPlayersAdded.join(', ') || 'none'}${summary.droppedOldLeague ? '; removed the old History league' : ''}.`,
  );
} finally {
  await pool.end();
}
