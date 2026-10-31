/**
 * Adds finished past seasons to the demo league, so it has history to look through: each
 * season scheduled, every round scored with made-up cards, the playoffs played out and the
 * season marked complete. Uses the app's own services, so standings, playoffs and stats
 * follow the same rules as real use. Nobody is emailed, and the automatic notices the
 * cards would post are removed afterwards.
 *
 * Each season ends with the team scramble: teams from the league's scramble settings and a
 * made-up card for each team.
 *
 *   node dist/scripts/demo-history.js [--league Demo] [--from 2023] [--to 2026] [--replace]
 *   node dist/scripts/demo-history.js --scrambles-only   (add scrambles to seasons already built)
 *   docker exec <container> node dist/scripts/demo-history.js --replace
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRng } from '@leaguemates/shared';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import type { SessionUser } from '../src/auth/decorators.js';
import { loadConfig } from '../src/config.js';
import { DB, type Database } from '../src/db/db.js';
import { announcements, leagues, players, scorecards, seasons, users } from '../src/db/schema.js';
import { PlayoffsService } from '../src/playoffs/playoffs.service.js';
import { ScorecardsService } from '../src/scorecards/scorecards.service.js';
import { ScrambleService } from '../src/scramble/scramble.service.js';
import { SeasonsService } from '../src/seasons/seasons.service.js';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const LEAGUE = opt('league', 'Demo');
const FROM = Number(opt('from', '2023'));
const TO = Number(opt('to', '2026'));

/** The third Wednesday of April: when the league starts. */
function opening(year: number): string {
  const d = new Date(Date.UTC(year, 3, 1));
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

const app = await NestFactory.createApplicationContext(AppModule.with(loadConfig()), {
  logger: ['error'],
});
try {
  const db = app.get<Database>(DB);
  const seasonsSvc = app.get(SeasonsService);
  const cards = app.get(ScorecardsService);
  const playoffs = app.get(PlayoffsService);
  const scrambles = app.get(ScrambleService);
  const startedAt = new Date();

  const [admin] = await db.select().from(users).where(eq(users.isSiteAdmin, true)).limit(1);
  if (!admin) throw new Error('No site admin to act as.');
  const actor: SessionUser = { ...admin, sessionId: 'demo-script', csrfToken: '' };
  const [league] = await db.select().from(leagues).where(eq(leagues.name, LEAGUE)).limit(1);
  if (!league) throw new Error(`No league named "${LEAGUE}".`);
  const L = league.id;

  const names = Array.from({ length: TO - FROM + 1 }, (_, i) => String(FROM + i));
  const existing = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.leagueId, L), inArray(seasons.name, names)));
  const rng = createRng(FROM * 31 + TO);

  /** The post-season scramble: everyone on the roster, teams balanced by the league's rules. */
  async function scramble(seasonId: string, seed: number) {
    const v = await scrambles.view(actor, L, seasonId);
    if (v.scramble || !('defaults' in v) || !v.defaults) return;
    const d = v.defaults;
    await scrambles.create(actor, L, seasonId, {
      date: d.date,
      layoutId: d.layouts[0]!.id,
      teamSize: d.teamSize,
      allowance: d.allowance,
      playerIds: d.players.map((p) => p.playerId),
      seed,
    });
    const after = await scrambles.view(actor, L, seasonId);
    if (!after.scramble) return;
    const pars = after.scramble.layout.holes.map((h) => h.par);
    for (const t of after.teams) {
      // A team plays near par: a birdie here and there, the odd bogey.
      const holeScores = t.holeScores.map((_, i) => {
        const par = pars[i] ?? 4;
        const r = rng();
        return r < 0.3 ? par - 1 : r < 0.9 ? par : par + 1;
      });
      await scrambles.saveScores(actor, L, seasonId, t.id, { holeScores, version: t.version });
    }
  }

  if (args.includes('--scrambles-only')) {
    for (const s of existing) await scramble(s.id, Number(s.name));
    console.log(`Scrambles added to ${existing.map((s) => s.name).join(', ')}.`);
    await app.close();
    process.exit(0);
  }

  if (existing.length) {
    if (!args.includes('--replace'))
      throw new Error(`${existing.map((s) => s.name).join(', ')} exist. Re-run with --replace.`);
    for (const s of existing) await seasonsSvc.remove(actor, L, s.id);
  }

  const roster = await db
    .select({ id: players.id, handicap: players.handicap })
    .from(players)
    .where(and(eq(players.leagueId, L), eq(players.active, true)));
  // Each player's form drifts from year to year: some were better then, some worse.
  const drift = new Map(roster.map((p) => [p.id, (rng() - 0.4) * 0.12]));

  /** Enters and submits a made-up card for each foursome of a round. */
  async function play(
    seasonId: string,
    week: { id: string; groups: { id: string }[] },
    hcp: Map<string, number>,
    absences: boolean,
  ) {
    for (const g of week.groups) {
      const view = await cards.view(actor, L, seasonId, week.id, g.id);
      const layout = view.layouts.find((l) => l.id === view.plannedLayoutId)!;
      const rounds = view.players.map(({ playerId }) => {
        const handicap = hcp.get(playerId) ?? 10;
        if (absences && rng() < 0.04)
          return {
            playerId,
            handicap,
            attendance: 'absent' as const,
            subName: 'Sub',
            holeScores: layout.holes.map(() => null),
          };
        // About par + 1.2 x handicap over nine, a stroke or so either way per hole.
        const extra = (handicap * 1.2) / layout.holes.length;
        return {
          playerId,
          handicap,
          attendance: 'played' as const,
          holeScores: layout.holes.map((h) =>
            Math.max(2, Math.round(h.par + extra + (rng() + rng() + rng() - 1.5) * 1.4)),
          ),
        };
      });
      await cards.save(actor, L, seasonId, week.id, g.id, { layoutId: layout.id, rounds });
      await cards.submit(actor, L, seasonId, week.id, g.id);
    }
    // Long final: their dispute windows are over.
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    await db
      .update(scorecards)
      .set({ submittedAt: past })
      .where(
        inArray(
          scorecards.groupId,
          week.groups.map((g) => g.id),
        ),
      );
  }

  for (const name of names) {
    const year = Number(name);
    const season = await seasonsSvc.create(actor, L, { name, startDate: opening(year) });
    const sched = await seasonsSvc.generate(actor, L, season.id, year);
    await seasonsSvc.setLocked(actor, L, season.id, true);
    const hcp = new Map(
      roster.map((p) => {
        const base = p.handicap ?? 10;
        const then = base * (1 + drift.get(p.id)! * (2027 - year));
        return [p.id, Math.max(0, Math.min(36, Math.round(then)))];
      }),
    );
    for (const w of sched.weeks.filter((x) => x.playoffRound === null))
      await play(season.id, w, hcp, true);

    if ((await playoffs.bracket(L, season.id)).canStart) {
      await playoffs.start(actor, L, season.id);
      for (;;) {
        const s = await seasonsSvc.schedule(L, season.id);
        const round = s.weeks.filter((w) => w.playoffRound !== null).at(-1)!;
        await play(season.id, round, hcp, false);
        const b = await playoffs.bracket(L, season.id);
        const last = b.rounds.at(-1)!;
        // A dead heat the rules can't split: the higher seed goes through.
        if (last.isFinal) {
          if (!b.champion)
            await playoffs.decide(
              actor,
              L,
              season.id,
              last.matches[0]!.id,
              last.matches[0]!.a.playerId,
              'Demo: higher seed',
            );
          break;
        }
        for (const m of last.matches.filter((x) => !x.winner))
          await playoffs.decide(actor, L, season.id, m.id, m.a.playerId, 'Demo: higher seed');
        await playoffs.advance(actor, L, season.id);
      }
    }
    await scramble(season.id, year);
    await db.update(seasons).set({ status: 'complete' }).where(eq(seasons.id, season.id));
    console.log(`${name}: ${sched.weeks.length} rounds, finished.`);
  }

  // The cards posted "card submitted" and playoff notices; they're noise for a demo.
  await db
    .delete(announcements)
    .where(
      and(
        eq(announcements.leagueId, L),
        isNotNull(announcements.kind),
        gte(announcements.createdAt, startedAt),
      ),
    );
  console.log(`Added ${names.length} finished seasons to ${LEAGUE}.`);
} finally {
  await app.close();
}
