import { sql } from 'drizzle-orm';
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
});

describe('activity (audit log)', () => {
  it('league admins read their league, newest first, filter by type and page back', async () => {
    const { body: league } = await as(site)
      .post('/leagues', { name: 'Wednesday League' })
      .expect(201);
    for (const n of ['A', 'B', 'C'])
      await as(site).post(`/leagues/${league.id}/players`, { nickname: n }).expect(201);
    await as(site)
      .post('/users', { email: 'paul@example.com', leagueId: league.id, role: 'admin' })
      .expect(201);
    const paul = await signIn(t, 'paul@example.com');

    const all = (await as(paul).get(`/leagues/${league.id}/audit`).expect(200)).body;
    expect(all.entries[0].action).toBe('member.add');
    expect(all.entries.at(-1).action).toBe('league.create');
    expect(all.entries[0]).toMatchObject({ actorEmail: 'site@example.com' });

    const players = (await as(paul).get(`/leagues/${league.id}/audit?action=player`).expect(200))
      .body;
    expect(players.entries.map((e: { action: string }) => e.action)).toEqual([
      'player.create',
      'player.create',
      'player.create',
    ]);

    const page1 = (await as(paul).get(`/leagues/${league.id}/audit?limit=2`).expect(200)).body;
    expect(page1.entries).toHaveLength(2);
    expect(page1.more).toBe(true);
    const page2 = (
      await as(paul)
        .get(`/leagues/${league.id}/audit?limit=2&before=${page1.entries[1].id}`)
        .expect(200)
    ).body;
    expect(page2.entries[0].id).toBeLessThan(page1.entries[1].id);
  });

  it('users cannot read it; site admins can read everything', async () => {
    const { body: league } = await as(site)
      .post('/leagues', { name: 'Wednesday League' })
      .expect(201);
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: league.id }).expect(201);
    const jerry = await signIn(t, 'jerry@example.com');
    await as(jerry).get(`/leagues/${league.id}/audit`).expect(403);
    await as(jerry).get('/audit').expect(403);
    const everything = (await as(site).get('/audit').expect(200)).body.entries.map(
      (e: { action: string }) => e.action,
    );
    expect(everything).toEqual(
      expect.arrayContaining(['league.create', 'user.create', 'member.add']),
    );
    const siteOnly = (await as(site).get('/audit/site').expect(200)).body.entries;
    expect(siteOnly.every((e: { leagueId: string | null }) => e.leagueId === null)).toBe(true);
  });
});

describe('audit trail guarantees', () => {
  it('cannot be changed or deleted, even directly in the database, and outlives a deleted league', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Gone League' }).expect(201);
    const [row] = (await t.db.execute(sql`select id from audit_log where league_id = ${league.id}`))
      .rows as { id: number }[];
    // The database refuses; drizzle wraps its error, so check the cause.
    const refused = (e: unknown) =>
      /append-only/.test(String((e as { cause?: Error }).cause?.message ?? e));
    await expect(
      t.db.execute(sql`update audit_log set action = 'x' where id = ${row!.id}`),
    ).rejects.toSatisfy(refused);
    await expect(t.db.execute(sql`delete from audit_log where id = ${row!.id}`)).rejects.toSatisfy(
      refused,
    );
    await t.db.execute(sql`delete from leagues where id = ${league.id}`);
    const left = await t.db.execute(
      sql`select count(*)::int as n from audit_log where league_id = ${league.id}`,
    );
    expect((left.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it('records sign-ins and sign-outs', async () => {
    await as(site).post('/auth/logout').expect(204);
    const actions = (await t.db.execute(sql`select action from audit_log order by id`)).rows.map(
      (r) => (r as { action: string }).action,
    );
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'auth.logout']));
  });

  it('lists a season’s activity and one scorecard’s history', async () => {
    const { body: league } = await as(site)
      .post('/leagues', { name: 'Wednesday League' })
      .expect(201);
    const L = league.id as string;
    for (const n of ['A', 'B', 'C', 'D']) {
      const { body: p } = await as(site).post(`/leagues/${L}/players`, { nickname: n }).expect(201);
      await site.agent
        .patch(`/api/leagues/${L}/players/${p.id}`)
        .set('X-CSRF-Token', site.csrf)
        .send({ handicap: 5 })
        .expect(200);
    }
    const { body: season } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const S = season.id as string;
    const { body: sched } = await as(site)
      .post(`/leagues/${L}/seasons/${S}/generate`, { seed: 1 })
      .expect(201);
    await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
    const w = sched.weeks[0];
    const g = w.groups[0];
    const path = `/leagues/${L}/seasons/${S}/weeks/${w.id}/groups/${g.id}/scorecard`;
    const view = (await as(site).get(path).expect(200)).body;
    const { body: card } = await site.agent
      .put(`/api${path}`)
      .set('X-CSRF-Token', site.csrf)
      .send({
        layoutId: view.plannedLayoutId,
        rounds: g.matches
          .flatMap((m: { playerA: string; playerB: string }) => [m.playerA, m.playerB])
          .map((playerId: string) => ({
            playerId,
            attendance: 'played',
            holeScores: Array(9).fill(5),
          })),
      })
      .expect(200);
    await as(site).post(`${path}/submit`).expect(201);

    const seasonLog = (await as(site).get(`/leagues/${L}/audit?seasonId=${S}`).expect(200)).body
      .entries;
    const actions = seasonLog.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'season.create',
        'season.generate',
        'season.lock',
        'scorecard.save',
        'scorecard.submit',
      ]),
    );
    expect(actions).not.toContain('player.create');
    const cardLog = (await as(site).get(`/leagues/${L}/audit?entityId=${card.card.id}`).expect(200))
      .body.entries;
    expect(cardLog.map((e: { action: string }) => e.action).sort()).toEqual([
      'scorecard.save',
      'scorecard.submit',
    ]);
  });

  it('shows one person’s activity to site admins and to admins of their league only', async () => {
    const { body: wed } = await as(site).post('/leagues', { name: 'Wednesday League' }).expect(201);
    const { body: thu } = await as(site).post('/leagues', { name: 'Thursday League' }).expect(201);
    await createUser(t.db, 'jerry@example.com');
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: wed.id }).expect(201);
    await createUser(t.db, 'wedadmin@example.com');
    await as(site)
      .post('/users', { email: 'wedadmin@example.com', leagueId: wed.id, role: 'admin' })
      .expect(201);
    await createUser(t.db, 'thuadmin@example.com');
    await as(site)
      .post('/users', { email: 'thuadmin@example.com', leagueId: thu.id, role: 'admin' })
      .expect(201);
    const jerry = await signIn(t, 'jerry@example.com');
    await as(jerry).post('/auth/logout').expect(204);
    const people = (await as(site).get('/users').expect(200)).body as {
      id: string;
      email: string;
    }[];
    const jerryId = people.find((p) => p.email === 'jerry@example.com')!.id;

    const all = (await as(site).get(`/users/${jerryId}/audit`).expect(200)).body.entries;
    expect(all.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['auth.login', 'auth.logout', 'member.add']),
    );
    const wedAdmin = await signIn(t, 'wedadmin@example.com');
    const seen = (await as(wedAdmin).get(`/users/${jerryId}/audit`).expect(200)).body.entries;
    expect(seen.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['auth.login']),
    );
    const thuAdmin = await signIn(t, 'thuadmin@example.com');
    await as(thuAdmin).get(`/users/${jerryId}/audit`).expect(403);
    await as(jerry).get(`/users/${jerryId}/audit`).expect(401);
  });
});
