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

interface Week {
  id: string;
  groups: { id: string; matches: { playerA: string; playerB: string }[] }[];
}

/** 4 players at handicap 10; A shoots 4s, everyone else 6s, for two weeks. */
async function setup() {
  const { body: league } = await as(site).post('/leagues', { name: 'Hcp League' }).expect(201);
  const L = league.id as string;
  const ids: Record<string, string> = {};
  for (const nickname of ['A', 'B', 'C', 'D']) {
    ids[nickname] = (
      await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201)
    ).body.id;
    await as(site).patch(`/leagues/${L}/players/${ids[nickname]}`, { handicap: 10 }).expect(200);
  }
  const settings = (await as(site).get(`/leagues/${L}`).expect(200)).body.settings;
  await as(site)
    .patch(`/leagues/${L}`, {
      settings: { ...settings, handicap: { ...settings.handicap, minimumRounds: 2 } },
    })
    .expect(200);
  const { body: season } = await as(site)
    .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
    .expect(201);
  const S = season.id as string;
  const { body: sched } = await as(site)
    .post(`/leagues/${L}/seasons/${S}/generate`, { seed: 1 })
    .expect(201);
  await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
  for (const week of (sched.weeks as Week[]).slice(0, 2)) {
    const g = week.groups[0]!;
    const path = `/leagues/${L}/seasons/${S}/weeks/${week.id}/groups/${g.id}/scorecard`;
    const view = (await as(site).get(path).expect(200)).body;
    await as(site)
      .put(path, {
        layoutId: view.plannedLayoutId,
        rounds: g.matches
          .flatMap((m) => [m.playerA, m.playerB])
          .map((playerId) => ({
            playerId,
            attendance: 'played',
            holeScores: Array(9).fill(playerId === ids['A'] ? 4 : 6),
          })),
      })
      .expect(200);
    await as(site).post(`${path}/submit`).expect(201);
  }
  return { L, ids, settings };
}

describe('handicaps', () => {
  it('suggests from recent scores; admins apply, with an audit entry', async () => {
    const { L, ids } = await setup();
    await createUser(t.db, 'user@example.com');
    await as(site).post('/users', { email: 'user@example.com', leagueId: L }).expect(201);
    const user = await signIn(t, 'user@example.com');

    const s = (await as(user).get(`/leagues/${L}/handicaps`).expect(200)).body;
    expect(s.rule).toMatchObject({
      rounds: 20,
      best: 10,
      allowance: 75,
      base: 35,
      minimumRounds: 2,
    });
    const a = s.players.find((p: { playerId: string }) => p.playerId === ids['A']);
    const b = s.players.find((p: { playerId: string }) => p.playerId === ids['B']);
    // A: 36 → (36-35)*0.75 = 0.75 → 0. B: 54 → 19*0.75 = 14.25 → 14.
    expect(a).toMatchObject({ current: 10, suggested: 0, average: 36, totalRounds: 2 });
    expect(b).toMatchObject({ current: 10, suggested: 14, average: 54 });
    expect(a.window).toHaveLength(2);
    expect(a.window.filter((w: { counted: boolean }) => w.counted)).toHaveLength(1);

    await as(user).post(`/leagues/${L}/handicaps/apply`).expect(403);
    const applied = (
      await as(site)
        .post(`/leagues/${L}/handicaps/apply`, { playerIds: [ids['A']] })
        .expect(201)
    ).body;
    expect(applied.changed).toBe(1);
    const after = (await as(site).get(`/leagues/${L}/members`).expect(200)).body.players;
    expect(after.find((p: { id: string }) => p.id === ids['A']).handicap).toBe(0);
    expect(after.find((p: { id: string }) => p.id === ids['B']).handicap).toBe(10);

    expect((await as(site).post(`/leagues/${L}/handicaps/apply`).expect(201)).body.changed).toBe(3);
    const log = (await as(site).get(`/leagues/${L}/audit?action=handicap.apply`).expect(200)).body
      .entries;
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ before: { A: 10 }, after: { A: 0 } });
  });

  it('counts rounds from another league by nickname, only one the admin belongs to', async () => {
    const { L, settings } = await setup();
    const { body: other } = await as(site)
      .post('/leagues', { name: 'Hcp League (History)' })
      .expect(201);
    const handicap = { ...settings.handicap, minimumRounds: 2, includeLeagueId: other.id };

    // A league admin who isn't in the other league can't point at it.
    await as(site)
      .post('/users', { email: 'admin@example.com', leagueId: L, role: 'admin' })
      .expect(201);
    const admin = await signIn(t, 'admin@example.com');
    const res = await as(admin)
      .patch(`/leagues/${L}`, { settings: { ...settings, handicap } })
      .expect(400);
    expect(res.body.message).toMatch(/belong to/);
    await as(site)
      .patch(`/leagues/${L}`, {
        settings: { ...settings, handicap: { ...handicap, includeLeagueId: L } },
      })
      .expect(400);

    await as(site)
      .patch(`/leagues/${L}`, { settings: { ...settings, handicap } })
      .expect(200);
    const s = (await as(site).get(`/leagues/${L}/handicaps`).expect(200)).body;
    expect(s.includedLeague).toMatchObject({ id: other.id, name: 'Hcp League (History)' });
  });
});
