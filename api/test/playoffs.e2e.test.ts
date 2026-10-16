import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  resetDb,
  signIn,
  type SignedIn,
  type TestApp,
} from './helpers.js';

let t: TestApp;
let site: SignedIn;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  put: (path: string, body: object) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

const NAMES = ['Richie Jr', 'Jerry', 'Paul', 'Doc', 'Rich', 'Jarrod', 'Todd', 'Mike B'];
const holes = (...v: number[]) => (v.length === 1 ? Array.from({ length: 9 }, () => v[0]!) : v);

type Rounds = Record<string, { holes?: number[]; absent?: boolean }>;

async function enterCard(L: string, S: string, weekId: string, groupId: string, scores: Rounds) {
  const path = `/leagues/${L}/seasons/${S}/weeks/${weekId}/groups/${groupId}/scorecard`;
  const view = (await as(site).get(path).expect(200)).body;
  const rounds = view.players.map((p: { playerId: string }) => {
    const s = scores[p.playerId] ?? { holes: holes(5) };
    return s.absent
      ? { playerId: p.playerId, attendance: 'absent', holeScores: holes(0).map(() => null) }
      : { playerId: p.playerId, attendance: 'played', holeScores: s.holes };
  });
  await as(site).put(path, { layoutId: view.plannedLayoutId, rounds }).expect(200);
  await as(site).post(`${path}/submit`).expect(201);
}

/** 8 players, all handicap 10 (no strokes between anyone), a one-week regular season. */
async function setup() {
  const { body: league } = await as(site)
    .post('/leagues', { name: 'Wednesday League' })
    .expect(201);
  const L = league.id as string;
  const ids: Record<string, string> = {};
  for (const n of NAMES) {
    const { body } = await as(site).post(`/leagues/${L}/players`, { nickname: n }).expect(201);
    ids[n] = body.id;
    await as(site).patch(`/leagues/${L}/players/${body.id}`, { handicap: 10 }).expect(200);
  }
  const { body: lg } = await as(site).get(`/leagues/${L}`).expect(200);
  await as(site)
    .patch(`/leagues/${L}`, { settings: { ...lg.settings, season: { regularSeasonWeeks: 1 } } })
    .expect(200);
  const { body: season } = await as(site)
    .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
    .expect(201);
  const S = season.id as string;
  const sched = (
    await as(site).post(`/leagues/${L}/seasons/${S}/generate`, { seed: 5 }).expect(201)
  ).body;
  await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
  return { L, S, ids, sched };
}

describe('playoffs', () => {
  it('cannot start before the regular season is finished', async () => {
    const { L, S } = await setup();
    const res = await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/start`).expect(400);
    expect(res.body.message).toMatch(/Finish the regular season/);
  });

  it('runs a full knockout: seeding, card tie-break, forfeit, admin decision, Finals and champion', async () => {
    const { L, S, sched } = await setup();
    // Regular season: player A of each match wins (4s v 5s).
    for (const g of sched.weeks[0].groups) {
      const scores: Rounds = {};
      for (const m of g.matches) {
        scores[m.playerA] = { holes: holes(4) };
        scores[m.playerB] = { holes: holes(5) };
      }
      await enterCard(L, S, sched.weeks[0].id, g.id, scores);
    }
    const before = (await as(site).get(`/leagues/${L}/seasons/${S}/standings`).expect(200)).body;

    // Seeds follow the standings; round 1 is 1 v 8, 2 v 7, 3 v 6, 4 v 5.
    let bracket = (await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/start`).expect(201))
      .body;
    const r1 = bracket.rounds[0];
    expect(
      r1.matches.map((m: { a: { seed: number }; b: { seed: number } }) => [m.a.seed, m.b.seed]),
    ).toEqual([
      [1, 8],
      [2, 7],
      [3, 6],
      [4, 5],
    ]);
    expect(r1.matches[0].a.playerId).toBe(before.rows[0].playerId);
    expect(r1.groups).toHaveLength(2);
    await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/start`).expect(400);
    await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/advance`).expect(400); // nothing decided yet

    const [m1, m2, m3, m4] = r1.matches;
    // m1: seed 1 wins outright. m2: equal 45s; seed 7 is better on the last 6 holes, so seed 7 advances.
    await enterCard(L, S, r1.weekId, m1.groupId, {
      [m1.a.playerId]: { holes: holes(4) },
      [m1.b.playerId]: { holes: holes(5) },
      [m2.a.playerId]: { holes: [4, 4, 4, 6, 6, 6, 5, 5, 5] },
      [m2.b.playerId]: { holes: [6, 6, 6, 4, 4, 4, 5, 5, 5] },
    });
    // m3: seed 6 absent, so seed 3 advances. m4: both absent, so an admin decides.
    await enterCard(L, S, r1.weekId, m3.groupId, {
      [m3.a.playerId]: { holes: holes(6) },
      [m3.b.playerId]: { absent: true },
      [m4.a.playerId]: { absent: true },
      [m4.b.playerId]: { absent: true },
    });
    bracket = (await as(site).get(`/leagues/${L}/seasons/${S}/playoffs`).expect(200)).body;
    const decided = bracket.rounds[0].matches.map(
      (m: { winner: string | null; decidedBy: string | null }) => [m.winner, m.decidedBy],
    );
    expect(decided).toEqual([
      [m1.a.playerId, 'net'],
      [m2.b.playerId, 'card_match'],
      [m3.a.playerId, 'forfeit'],
      [null, 'commissioner'],
    ]);
    expect(
      (await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/advance`).expect(400)).body.message,
    ).toMatch(/Not decided yet/);
    await as(site)
      .post(`/leagues/${L}/seasons/${S}/playoffs/matches/${m4.id}/decide`, {
        winnerId: m4.b.playerId,
        reason: 'Coin toss',
      })
      .expect(201);

    // The four winners play the Finals foursome.
    bracket = (await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/advance`).expect(201)).body;
    const finals = bracket.rounds[1];
    expect(finals.isFinal).toBe(true);
    expect(finals.finalists.map((f: { playerId: string }) => f.playerId).sort()).toEqual(
      [m1.a.playerId, m2.b.playerId, m3.a.playerId, m4.b.playerId].sort(),
    );
    await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/advance`).expect(400); // finals are last

    await enterCard(L, S, finals.weekId, finals.groups[0].id, {
      [m1.a.playerId]: { holes: holes(5) },
      [m2.b.playerId]: { holes: holes(4) },
      [m3.a.playerId]: { holes: holes(6) },
      [m4.b.playerId]: { holes: holes(5) },
    });
    bracket = (await as(site).get(`/leagues/${L}/seasons/${S}/playoffs`).expect(200)).body;
    expect(bracket.champion.playerId).toBe(m2.b.playerId);

    // Playoff rounds never change the regular-season standings.
    const after = (await as(site).get(`/leagues/${L}/seasons/${S}/standings`).expect(200)).body;
    expect(after.rows).toEqual(before.rows);
  });

  it('a league with "final foursome" playoffs goes straight to the top 4', async () => {
    const { L, S, sched } = await setup();
    for (const g of sched.weeks[0].groups) await enterCard(L, S, sched.weeks[0].id, g.id, {});
    const { db } = t;
    const { seasons } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [s] = await db.select().from(seasons).where(eq(seasons.id, S));
    await db
      .update(seasons)
      .set({
        settings: {
          ...(s!.settings as object),
          playoffs: { format: 'final_foursome', tiebreak: 'standard' },
        },
      })
      .where(eq(seasons.id, S));
    const bracket = (await as(site).post(`/leagues/${L}/seasons/${S}/playoffs/start`).expect(201))
      .body;
    expect(bracket.rounds).toHaveLength(1);
    expect(bracket.rounds[0].isFinal).toBe(true);
    expect(bracket.rounds[0].finalists.map((f: { seed: number }) => f.seed)).toEqual([1, 2, 3, 4]);
  });

  it('only admins start or advance the playoffs', async () => {
    const { L, S } = await setup();
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: L }).expect(201);
    const jerry = await signIn(t, 'jerry@example.com');
    await as(jerry).get(`/leagues/${L}/seasons/${S}/playoffs`).expect(200);
    await as(jerry).post(`/leagues/${L}/seasons/${S}/playoffs/start`).expect(403);
  });
});
