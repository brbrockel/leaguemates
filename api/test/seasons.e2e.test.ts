import { addDays } from '@teemate/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { todayInLeague } from '../src/seasons/seasons.service.js';
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

const ROSTER = [
  'Richie Jr',
  'Jerry',
  'Paul',
  'Doc',
  'Rich',
  'Jarrod',
  'Todd',
  'Mike B',
  'Don',
  'Keith',
  'Jason',
  'Brian',
  'Tony',
  'Rick H',
  'Dickie',
  'Mike M',
];

async function leagueWithRoster(size = 16) {
  const { body: league } = await as(site)
    .post('/leagues', { name: 'Wednesday League' })
    .expect(201);
  const ids: Record<string, string> = {};
  for (const nickname of ROSTER.slice(0, size)) {
    ids[nickname] = (
      await as(site).post(`/leagues/${league.id}/players`, { nickname }).expect(201)
    ).body.id;
  }
  return { leagueId: league.id as string, ids };
}

interface Schedule {
  season: { status: string; seed: number };
  roster: { playerId: string; spot: number; nickname: string }[];
  weeks: {
    id: string;
    round: number;
    date: string;
    layout: string;
    groups: { teeTime: string; matches: { playerA: string; playerB: string }[] }[];
  }[];
  report: {
    pairsMet: number;
    possiblePairs: number;
    maxOpponentRepeats: number;
    maxGroupMateRepeats: number;
    everyoneTeesFirstAndLast: boolean;
  };
}

describe('courses', () => {
  it('includes Timberlin with front and back nines, par 36 each', async () => {
    const { body } = await as(site).get('/courses').expect(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Timberlin Golf Club');
    expect(
      body[0].layouts.map((l: { name: string; par: number; holes: unknown[] }) => [
        l.name,
        l.par,
        l.holes.length,
      ]),
    ).toEqual([
      ['Front 9', 36, 9],
      ['Back 9', 36, 9],
    ]);
  });
});

describe('seasons and the schedule', () => {
  it('needs an even roster of at least 4 to generate the schedule', async () => {
    const { leagueId } = await leagueWithRoster(5);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const res = await as(site)
      .post(`/leagues/${leagueId}/seasons/${season.id}/generate`, {})
      .expect(400);
    expect(res.body.message).toMatch(/even roster/);
  });

  it('each season has its own roster, set while it is a draft', async () => {
    const { leagueId, ids } = await leagueWithRoster(6);
    const base = `/leagues/${leagueId}/seasons`;
    const { body: s1 } = await as(site)
      .post(base, { name: '2026', startDate: '2026-04-22' })
      .expect(201);
    const order = Object.values(ids).slice(0, 4).reverse();
    let view = (await as(site).put(`${base}/${s1.id}/roster`, { playerIds: order }).expect(200))
      .body;
    expect(
      view.roster.map((r: { playerId: string; spot: number }) => [r.spot, r.playerId]),
    ).toEqual(order.map((id, i) => [i + 1, id]));
    view = (await as(site).post(`${base}/${s1.id}/generate`, { seed: 1 }).expect(201)).body;
    expect(view.weeks.length).toBeGreaterThan(0);
    // Changing the roster clears the schedule built for the old one.
    view = (
      await as(site)
        .put(`${base}/${s1.id}/roster`, { playerIds: order.slice(0, 2) })
        .expect(200)
    ).body;
    expect(view.weeks).toHaveLength(0);
    await as(site)
      .put(`${base}/${s1.id}/roster`, { playerIds: [order[0], order[0]] })
      .expect(400);
    await as(site).put(`${base}/${s1.id}/roster`, { playerIds: order }).expect(200);
    await as(site).post(`${base}/${s1.id}/generate`, { seed: 1 }).expect(201);
    await as(site).post(`${base}/${s1.id}/lock`).expect(201);
    await as(site).put(`${base}/${s1.id}/roster`, { playerIds: order }).expect(400);

    // The next season starts from this one's roster; past players drop off.
    await as(site).patch(`/leagues/${leagueId}/players/${order[0]}`, { active: false }).expect(200);
    const { body: s2 } = await as(site)
      .post(base, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const next = (await as(site).get(`${base}/${s2.id}`).expect(200)).body;
    expect(next.roster.map((r: { playerId: string }) => r.playerId)).toEqual(order.slice(1));
  });

  it('generates a full 16-player season: everyone meets once, mixed foursomes, alternating nines', async () => {
    const { leagueId } = await leagueWithRoster();
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const { body } = (await as(site)
      .post(`/leagues/${leagueId}/seasons/${season.id}/generate`, { seed: 7 })
      .expect(201)) as { body: Schedule };

    expect(body.roster.map((r) => r.spot)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const list = (await as(site).get(`/leagues/${leagueId}/seasons`).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ name: '2027', status: 'draft', weeks: 15 })]);
    expect(body.weeks).toHaveLength(15);
    expect(body.weeks.map((w) => w.date).slice(0, 3)).toEqual([
      '2027-04-21',
      '2027-04-28',
      '2027-05-05',
    ]);
    expect(body.weeks.map((w) => w.layout).slice(0, 4)).toEqual([
      'Front 9',
      'Back 9',
      'Front 9',
      'Back 9',
    ]);
    expect(body.weeks[0]!.groups.map((g) => g.teeTime)).toEqual([
      '17:00',
      '17:09',
      '17:18',
      '17:27',
    ]);
    for (const w of body.weeks) {
      expect(w.groups).toHaveLength(4);
      expect(
        new Set(w.groups.flatMap((g) => g.matches.flatMap((m) => [m.playerA, m.playerB]))).size,
      ).toBe(16);
    }
    expect(body.report).toEqual({
      pairsMet: 120,
      possiblePairs: 120,
      maxOpponentRepeats: 1,
      maxGroupMateRepeats: expect.any(Number),
      everyoneTeesFirstAndLast: true,
    });
    expect(body.report.maxGroupMateRepeats).toBeLessThanOrEqual(3);
  }, 30_000);

  it('the same seed gives the same schedule; regenerating gives a new mix', async () => {
    const { leagueId } = await leagueWithRoster();
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const path = `/leagues/${leagueId}/seasons/${season.id}/generate`;
    const pairs = (s: Schedule) =>
      s.weeks.map((w) => w.groups.map((g) => g.matches.map((m) => [m.playerA, m.playerB])));
    const a = (await as(site).post(path, { seed: 11 }).expect(201)).body as Schedule;
    const b = (await as(site).post(path, { seed: 11 }).expect(201)).body as Schedule;
    const c = (await as(site).post(path, {}).expect(201)).body as Schedule;
    expect(pairs(b)).toEqual(pairs(a));
    expect(pairs(c)).not.toEqual(pairs(a));
  }, 30_000);

  it('users can view the schedule but only admins can change it', async () => {
    const { leagueId } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    await as(site).post('/users', { email: 'jerry@example.com', leagueId }).expect(201);
    const jerry = await signIn(t, 'jerry@example.com');
    await as(jerry).get(`/leagues/${leagueId}/seasons`).expect(200);
    await as(jerry).get(`/leagues/${leagueId}/seasons/${season.id}`).expect(200);
    await as(jerry).post(`/leagues/${leagueId}/seasons/${season.id}/generate`).expect(403);
    await as(jerry)
      .post(`/leagues/${leagueId}/seasons`, { name: '2028', startDate: '2028-04-19' })
      .expect(403);
  });

  it('locking freezes the schedule; unlocking allows changes again', async () => {
    const { leagueId } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const base = `/leagues/${leagueId}/seasons/${season.id}`;
    await as(site).post(`${base}/lock`).expect(400); // nothing generated yet
    await as(site).post(`${base}/generate`).expect(201);
    expect((await as(site).post(`${base}/lock`).expect(201)).body.season.status).toBe('scheduled');
    await as(site).post(`${base}/generate`).expect(400);
    expect((await as(site).post(`${base}/unlock`).expect(201)).body.season.status).toBe('draft');
  });

  it('a rainout moves that round and every later one back a week', async () => {
    const { leagueId } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const base = `/leagues/${leagueId}/seasons/${season.id}`;
    const before = (await as(site).post(`${base}/generate`).expect(201)).body as Schedule;
    await as(site).post(`${base}/weeks/${before.weeks[1]!.id}/rainout`).expect(400); // must be locked first
    await as(site).post(`${base}/lock`).expect(201);
    const after = (await as(site).post(`${base}/weeks/${before.weeks[1]!.id}/rainout`).expect(201))
      .body as Schedule;
    expect(after.weeks.map((w) => w.date)).toEqual([
      before.weeks[0]!.date,
      ...before.weeks.slice(1).map((w) => addDays(w.date, 7)),
    ]);
  });
});

describe('this week', () => {
  it('shows a player their next round: date, nine, tee time, opponent and foursome', async () => {
    const { leagueId, ids } = await leagueWithRoster(4);
    await as(site)
      .post('/users', { email: 'jerry@example.com', leagueId, playerId: ids['Jerry'] })
      .expect(201);
    const start = addDays(todayInLeague(), 2);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: start })
      .expect(201);
    const base = `/leagues/${leagueId}/seasons/${season.id}`;
    const schedule = (await as(site).post(`${base}/generate`).expect(201)).body as Schedule;

    const jerry = await signIn(t, 'jerry@example.com');
    expect((await as(jerry).get('/me/this-week').expect(200)).body).toEqual([
      { leagueId, leagueName: 'Wednesday League', next: null }, // not locked yet
    ]);
    await as(site).post(`${base}/lock`).expect(201);

    const [entry] = (await as(jerry).get('/me/this-week').expect(200)).body;
    const round1 = schedule.weeks[0]!;
    const myMatch = round1.groups
      .flatMap((g) => g.matches)
      .find((m) => [m.playerA, m.playerB].includes(ids['Jerry']!))!;
    const opponentId = myMatch.playerA === ids['Jerry'] ? myMatch.playerB : myMatch.playerA;
    expect(entry.next).toMatchObject({
      seasonName: '2027',
      round: 1,
      rounds: 15,
      date: start,
      layout: 'Front 9',
      teeTime: '17:00',
      opponent: Object.keys(ids).find((k) => ids[k] === opponentId),
      bye: false,
    });
    expect(entry.next.foursome.flat().sort()).toEqual(['Doc', 'Jerry', 'Paul', 'Richie Jr']);
  });

  it('is empty for someone without a roster spot', async () => {
    await leagueWithRoster(4);
    expect((await as(site).get('/me/this-week').expect(200)).body).toEqual([]);
  });
});

describe('imported seasons', () => {
  it('show the official final standings exactly as published', async () => {
    const { leagueId, ids } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2019', startDate: '2019-04-24' })
      .expect(201);
    const { seasons: seasonsTable } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await t.db
      .update(seasonsTable)
      .set({
        status: 'complete',
        officialStandings: [
          { name: 'Jerry', W: 9, L: 2, T: 2, points: 29 },
          { name: 'Paul', W: 8, L: 4, T: 1, points: 25 },
          { name: 'Richie Jr', W: 5, L: 7, T: 1, points: 16 },
          { name: 'Doc', W: 1, L: 10, T: 2, points: 5 },
        ],
      })
      .where(eq(seasonsTable.id, season.id));
    const st = (
      await as(site).get(`/leagues/${leagueId}/seasons/${season.id}/standings`).expect(200)
    ).body;
    expect(st.official).toBe(true);
    expect(
      st.rows.map((r: { nickname: string; points: number; rank: number }) => [
        r.rank,
        r.nickname,
        r.points,
      ]),
    ).toEqual([
      [1, 'Jerry', 29],
      [2, 'Paul', 25],
      [3, 'Richie Jr', 16],
      [4, 'Doc', 5],
    ]);
    expect(st.rows[0].playerId).toBe(ids['Jerry']);
  });
});

describe('season tools', () => {
  it('admins delete a season with its schedule; it is audited', async () => {
    const { leagueId } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: 'Test', startDate: '2027-04-21' })
      .expect(201);
    await as(site).post(`/leagues/${leagueId}/seasons/${season.id}/generate`).expect(201);
    await site.agent
      .delete(`/api/leagues/${leagueId}/seasons/${season.id}`)
      .set('X-CSRF-Token', site.csrf)
      .expect(204);
    await as(site).get(`/leagues/${leagueId}/seasons/${season.id}`).expect(404);
    expect((await as(site).get(`/leagues/${leagueId}/seasons`)).body).toEqual([]);
    const { auditLog } = await import('../src/db/schema.js');
    const actions = (await t.db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toContain('season.delete');
  });

  it('skipping a rained-out round leaves the other dates alone', async () => {
    const { leagueId } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const base = `/leagues/${leagueId}/seasons/${season.id}`;
    const before = (await as(site).post(`${base}/generate`).expect(201)).body as Schedule;
    await as(site).post(`${base}/lock`).expect(201);
    const after = (await as(site).post(`${base}/weeks/${before.weeks[1]!.id}/skip`).expect(201))
      .body as Schedule & { weeks: { status: string }[] };
    expect(after.weeks.map((w) => w.date)).toEqual(before.weeks.map((w) => w.date));
    expect(after.weeks[1]!.status).toBe('skipped');
    await as(site).post(`${base}/weeks/${before.weeks[1]!.id}/skip`).expect(400);
  });

  it('swaps two players within a round of a draft schedule', async () => {
    const { leagueId, ids } = await leagueWithRoster(4);
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const base = `/leagues/${leagueId}/seasons/${season.id}`;
    const sched = (await as(site).post(`${base}/generate`, { seed: 3 }).expect(201))
      .body as Schedule;
    const w = sched.weeks[0]!;
    const [m1, m2] = w.groups[0]!.matches;
    const after = (
      await as(site)
        .post(`${base}/weeks/${w.id}/swap`, { playerA: m1!.playerA, playerB: m2!.playerA })
        .expect(201)
    ).body as Schedule;
    const pairs = after.weeks[0]!.groups[0]!.matches.map((m) => [m.playerA, m.playerB]);
    expect(pairs).toEqual([
      [m2!.playerA, m1!.playerB],
      [m1!.playerA, m2!.playerB],
    ]);
    // Now m2.playerA plays m1.playerB, so swapping those two is refused; swapping back works.
    await as(site)
      .post(`${base}/weeks/${w.id}/swap`, { playerA: m1!.playerB, playerB: m2!.playerA })
      .expect(400);
    await as(site)
      .post(`${base}/weeks/${w.id}/swap`, { playerA: m1!.playerA, playerB: m2!.playerA })
      .expect(201);
    await as(site)
      .post(`${base}/weeks/${w.id}/swap`, { playerA: ids['Jerry']!, playerB: ids['Jerry']! })
      .expect(400);
    await as(site).post(`${base}/lock`).expect(201);
    await as(site)
      .post(`${base}/weeks/${w.id}/swap`, { playerA: m1!.playerA, playerB: m2!.playerA })
      .expect(400);
  });

  it("can't swap players in a round from another season, even through your own draft", async () => {
    const { leagueId } = await leagueWithRoster(4);
    const { body: locked } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const lockedBase = `/leagues/${leagueId}/seasons/${locked.id}`;
    const sched = (await as(site).post(`${lockedBase}/generate`, { seed: 3 }).expect(201))
      .body as Schedule;
    await as(site).post(`${lockedBase}/lock`).expect(201);
    const { body: draft } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, { name: '2028', startDate: '2028-04-19' })
      .expect(201);
    const w = sched.weeks[0]!;
    const [m1, m2] = w.groups[0]!.matches;
    await as(site)
      .post(`/leagues/${leagueId}/seasons/${draft.id}/weeks/${w.id}/swap`, {
        playerA: m1!.playerA,
        playerB: m2!.playerA,
      })
      .expect(404);
    const after = (await as(site).get(lockedBase).expect(200)).body as Schedule;
    expect(after.weeks[0]!.groups[0]!.matches).toEqual(w.groups[0]!.matches);
  });
});

describe('season course and nines', () => {
  it('plays only the nines chosen for the season', async () => {
    const { leagueId } = await leagueWithRoster(4);
    const [timberlin] = (await as(site).get('/courses').expect(200)).body;
    const back = timberlin.layouts.find((l: { name: string }) => l.name === 'Back 9');
    const { body: season } = await as(site)
      .post(`/leagues/${leagueId}/seasons`, {
        name: '2027',
        startDate: '2027-04-21',
        courseId: timberlin.id,
        layoutIds: [back.id],
      })
      .expect(201);
    const view = (
      await as(site)
        .post(`/leagues/${leagueId}/seasons/${season.id}/generate`, { seed: 1 })
        .expect(201)
    ).body;
    expect(view.season.nines).toEqual([{ id: back.id, name: 'Back 9' }]);
    expect(new Set(view.weeks.map((w: { layout: string }) => w.layout))).toEqual(
      new Set(['Back 9']),
    );
    await as(site)
      .post(`/leagues/${leagueId}/seasons`, {
        name: '2028',
        startDate: '2028-04-19',
        courseId: timberlin.id,
        layoutIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(400);
  });
});
