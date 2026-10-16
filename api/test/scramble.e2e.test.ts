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
  delete: (path: string) => who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf),
});

const HCP: Record<string, number> = { A: 3, B: 5, C: 7, D: 9, E: 11, F: 13, G: 15, H: 17 };

interface Team {
  id: string;
  number: number;
  teeTime: string;
  handicap: number;
  version: number;
  members: { playerId: string; nickname: string; handicap: number }[];
  position: number | null;
  net: number | null;
  canEnter: boolean;
}

async function setup(lock = true) {
  const { body: league } = await as(site).post('/leagues', { name: 'Scramble League' }).expect(201);
  const L = league.id as string;
  const ids: Record<string, string> = {};
  for (const [nickname, handicap] of Object.entries(HCP)) {
    ids[nickname] = (
      await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201)
    ).body.id;
    await as(site).patch(`/leagues/${L}/players/${ids[nickname]}`, { handicap }).expect(200);
  }
  await as(site)
    .post('/users', { email: 'a@example.com', leagueId: L, playerId: ids['A'] })
    .expect(201);
  // One regular-season round and no playoffs, so the scramble is ready once that round is in.
  const settings = (await as(site).get(`/leagues/${L}`).expect(200)).body.settings;
  await as(site)
    .patch(`/leagues/${L}`, {
      settings: {
        ...settings,
        season: { regularSeasonWeeks: 1 },
        playoffs: { ...settings.playoffs, format: 'none' },
      },
    })
    .expect(200);
  const { body: season } = await as(site)
    .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
    .expect(201);
  const S = season.id as string;
  await as(site).post(`/leagues/${L}/seasons/${S}/generate`, { seed: 1 }).expect(201);
  if (lock) await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
  const base = `/leagues/${L}/seasons/${S}/scramble`;
  /** Plays the one regular-season round: every card in at 5s. */
  const finishSeason = async () => {
    const sched = (await as(site).get(`/leagues/${L}/seasons/${S}`).expect(200)).body;
    for (const w of sched.weeks)
      for (const g of w.groups) {
        const path = `/leagues/${L}/seasons/${S}/weeks/${w.id}/groups/${g.id}/scorecard`;
        const view = (await as(site).get(path).expect(200)).body;
        await as(site)
          .put(path, {
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
      }
  };
  return { L, S, ids, base, finishSeason };
}

describe('team scramble', () => {
  it('sets up balanced teams, takes team cards and ranks by net', async () => {
    const { L, ids, base, finishSeason } = await setup();
    const a = await signIn(t, 'a@example.com');

    let blank = (await as(a).get(base).expect(200)).body;
    expect(blank).toMatchObject({
      scramble: null,
      ready: false,
      waitingFor: 'the regular season to finish',
    });
    await as(site)
      .post(base, {
        date: blank.defaults.date,
        layoutId: blank.defaults.layouts[0].id,
        teamSize: 4,
        allowance: [20, 15, 10, 5],
        playerIds: Object.values(ids),
      })
      .expect(400);
    await finishSeason();
    blank = (await as(a).get(base).expect(200)).body;
    expect(blank.ready).toBe(true);
    expect(blank.scramble).toBeNull();
    expect(blank.defaults).toMatchObject({ teamSize: 4, allowance: [20, 15, 10, 5] });
    expect(blank.defaults.players).toHaveLength(8);
    const layoutId = blank.defaults.layouts[0].id;
    const setupBody = {
      date: blank.defaults.date,
      layoutId,
      teamSize: 4,
      allowance: [20, 15, 10, 5],
      playerIds: Object.values(ids),
      seed: 5,
    };
    await as(a).post(base, setupBody).expect(403);

    let v = (await as(site).post(base, setupBody).expect(201)).body;
    await as(site).post(base, setupBody).expect(409);
    let teams = v.teams as Team[];
    expect(teams).toHaveLength(2);
    expect(teams.map((x) => x.teeTime)).toEqual(['17:00', '17:09']);
    expect(teams.every((x) => x.members.length === 4)).toBe(true);
    expect(Math.abs(teams[0]!.handicap - teams[1]!.handicap)).toBeLessThanOrEqual(1);

    // Swap A and the lowest player on the other team by hand.
    const mine = teams.find((x) => x.members.some((m) => m.playerId === ids['A']))!;
    const other = teams.find((x) => x !== mine)!;
    const swap = (ms: Team['members'], out: string, inn: string) =>
      ms.map((m) => (m.playerId === out ? inn : m.playerId));
    const otherLow = other.members[0]!.playerId;
    v = (
      await as(site)
        .put(`${base}/teams`, {
          teams: [
            swap(mine.members, ids['A']!, otherLow),
            swap(other.members, otherLow, ids['A']!),
          ],
        })
        .expect(200)
    ).body;
    teams = v.teams;
    expect(teams[1]!.members.map((m) => m.playerId)).toContain(ids['A']);
    await as(site)
      .put(`${base}/teams`, { teams: [teams[0]!.members.map((m) => m.playerId)] })
      .expect(400);

    // A enters their own team's card; not the other team's.
    v = (await as(a).get(base).expect(200)).body;
    const [t1, t2] = v.teams as Team[];
    expect(t2!.canEnter).toBe(true);
    expect(t1!.canEnter).toBe(false);
    const fours = Array(9).fill(4);
    await as(a)
      .put(`${base}/teams/${t1!.id}/scores`, { holeScores: fours, version: 0 })
      .expect(403);
    await as(a)
      .put(`${base}/teams/${t2!.id}/scores`, { holeScores: fours, version: 0 })
      .expect(200);
    await as(a)
      .put(`${base}/teams/${t2!.id}/scores`, { holeScores: fours, version: 0 })
      .expect(409);
    await as(site).post(`${base}/regenerate`).expect(409); // scores are in

    v = (
      await as(site)
        .put(`${base}/teams/${t1!.id}/scores`, { holeScores: Array(9).fill(3), version: 0 })
        .expect(200)
    ).body;
    expect(v.scramble.complete).toBe(true);
    const ranked = v.teams as Team[];
    const first = ranked.find((x) => x.position === 1)!;
    expect(first.id).toBe(t1!.id); // 27 gross beats 36
    expect(first.net).toBe(27 - t1!.handicap);

    const log = (await as(site).get(`/leagues/${L}/audit`).expect(200)).body.entries;
    expect(log.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['scramble.create', 'scramble.teams', 'scramble.scores']),
    );
    await as(site).delete(base).expect(200);
    expect((await as(site).get(base).expect(200)).body.scramble).toBeNull();
  });

  it('needs a locked schedule and handicaps for everyone', async () => {
    const { L, ids, base, finishSeason } = await setup(false);
    const blank = (await as(site).get(base).expect(200)).body;
    const body = {
      date: '2027-08-18',
      layoutId: blank.defaults.layouts[0].id,
      teamSize: 4,
      allowance: [20, 15, 10, 5],
      playerIds: Object.values(ids),
    };
    await as(site).post(base, body).expect(400);
    await as(site)
      .post(
        `/leagues/${L}/seasons/${(await as(site).get(`/leagues/${L}/seasons`)).body[0].id}/lock`,
      )
      .expect(201);
    await finishSeason();
    await as(site).patch(`/leagues/${L}/players/${ids['H']}`, { handicap: null }).expect(200);
    const res = await as(site).post(base, body).expect(400);
    expect(res.body.message).toMatch(/handicap for H/);
  });
});
