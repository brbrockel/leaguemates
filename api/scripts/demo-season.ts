/**
 * Builds a demo league to preview a season in progress: "Wednesday League (Demo 2027)" with
 * the live league's current players and handicaps, a generated and locked 2027 schedule,
 * and made-up scores for the first rounds. Uses the app's own services, so it follows
 * the same rules as real use. Nobody is emailed.
 *
 *   node dist/scripts/demo-season.js [rounds-played=8] [--replace]
 *   docker exec <container> node dist/scripts/demo-season.js 8 --replace
 *
 * Delete the demo with the Delete season button, or re-run with --replace.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRng } from '@teemate/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import type { SessionUser } from '../src/auth/decorators.js';
import { loadConfig } from '../src/config.js';
import { DB, type Database } from '../src/db/db.js';
import {
  groups,
  leagueMemberships,
  leagues,
  players,
  scorecards,
  seasons,
  users,
  weeks,
} from '../src/db/schema.js';
import { LeaguesService } from '../src/leagues/leagues.service.js';
import { ScorecardsService } from '../src/scorecards/scorecards.service.js';
import { SeasonsService } from '../src/seasons/seasons.service.js';

const LIVE_SLUG = 'wednesday-league';
const DEMO_NAME = 'Wednesday League (Demo 2027)';
const args = process.argv.slice(2);
const played = Number(args.find((a) => /^\d+$/.test(a)) ?? 8);

const app = await NestFactory.createApplicationContext(AppModule.with(loadConfig()), {
  logger: ['error'],
});
try {
  const db = app.get<Database>(DB);
  const leaguesSvc = app.get(LeaguesService);
  const seasonsSvc = app.get(SeasonsService);
  const cards = app.get(ScorecardsService);

  const [admin] = await db.select().from(users).where(eq(users.isSiteAdmin, true)).limit(1);
  if (!admin) throw new Error('No site admin to act as.');
  const actor: SessionUser = { ...admin, sessionId: 'demo-script', csrfToken: '' };

  const [live] = await db.select().from(leagues).where(eq(leagues.slug, LIVE_SLUG)).limit(1);
  if (!live) throw new Error(`No league "${LIVE_SLUG}".`);
  const [old] = await db.select().from(leagues).where(eq(leagues.name, DEMO_NAME)).limit(1);
  if (old) {
    if (!args.includes('--replace')) throw new Error('The demo exists. Re-run with --replace.');
    await db.delete(seasons).where(eq(seasons.leagueId, old.id));
    await db.delete(leagues).where(eq(leagues.id, old.id));
  }

  const demo = await leaguesSvc.create(actor, DEMO_NAME);
  await db.update(leagues).set({ settings: live.settings }).where(eq(leagues.id, demo.id));
  // Everyone in the live league can look at it, with the same roles.
  const ms = await db
    .select()
    .from(leagueMemberships)
    .where(eq(leagueMemberships.leagueId, live.id));
  for (const m of ms)
    await db
      .insert(leagueMemberships)
      .values({ leagueId: demo.id, userId: m.userId, role: m.role })
      .onConflictDoNothing();

  // The current players and handicaps (no user links, so nobody's Home shows demo rounds).
  const current = await db
    .select()
    .from(players)
    .where(and(eq(players.leagueId, live.id), eq(players.active, true)));
  for (const p of current) {
    const created = await leaguesSvc.addPlayer(actor, demo.id, {
      nickname: p.nickname,
      ...(p.fullName ? { fullName: p.fullName } : {}),
    });
    await leaguesSvc.updatePlayer(actor, demo.id, created.id, { handicap: p.handicap ?? 10 });
  }

  const season = await seasonsSvc.create(actor, demo.id, {
    name: '2027',
    startDate: '2027-04-21',
  });
  const schedule = await seasonsSvc.generate(actor, demo.id, season.id, 2027);
  await seasonsSvc.setLocked(actor, demo.id, season.id, true);

  // Plausible 9-hole scores: about par + 1.2 x handicap, a stroke or so either way per hole.
  const rng = createRng(2027);
  const roster = await db
    .select({ id: players.id, handicap: players.handicap })
    .from(players)
    .where(eq(players.leagueId, demo.id));
  const hcp = new Map(roster.map((p) => [p.id, p.handicap ?? 10]));
  for (const w of schedule.weeks.filter((x) => x.playoffRound === null).slice(0, played)) {
    for (const g of w.groups) {
      const view = await cards.view(actor, demo.id, season.id, w.id, g.id);
      const layout = view.layouts.find((l) => l.id === view.plannedLayoutId)!;
      const rounds = g.matches
        .flatMap((m) => [m.playerA, m.playerB])
        .map((playerId) => {
          const absent = rng() < 0.04;
          const extra = (hcp.get(playerId)! * 1.2) / layout.holes.length;
          return absent
            ? {
                playerId,
                attendance: 'absent' as const,
                subName: 'Sub',
                holeScores: layout.holes.map(() => null),
              }
            : {
                playerId,
                attendance: 'played' as const,
                holeScores: layout.holes.map((h) =>
                  Math.max(2, Math.round(h.par + extra + (rng() + rng() + rng() - 1.5) * 1.4)),
                ),
              };
        });
      await cards.save(actor, demo.id, season.id, w.id, g.id, {
        layoutId: layout.id,
        rounds,
      });
      await cards.submit(actor, demo.id, season.id, w.id, g.id);
    }
  }
  // Past rounds are final (their dispute windows long over).
  const at = new Date();
  at.setDate(at.getDate() - 7);
  const demoGroups = db
    .select({ id: groups.id })
    .from(groups)
    .innerJoin(weeks, eq(weeks.id, groups.weekId))
    .where(eq(weeks.seasonId, season.id));
  await db
    .update(scorecards)
    .set({ submittedAt: at })
    .where(and(eq(scorecards.status, 'submitted'), inArray(scorecards.groupId, demoGroups)));

  console.log(
    `Built ${DEMO_NAME}: 2027 season, ${current.length} players, ${played} rounds scored.`,
  );
} finally {
  await app.close();
}
