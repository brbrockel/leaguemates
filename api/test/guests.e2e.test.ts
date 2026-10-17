import request from 'supertest';
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

const NAMES = ['Richie Jr', 'Jerry', 'Paul', 'Doc'];

/** A public league with a locked four-player season and one card entered. */
async function setup() {
  const L = (await as(site).post('/leagues', { name: 'Wednesday League' }).expect(201)).body
    .id as string;
  const ids: string[] = [];
  for (const n of NAMES) {
    const { body } = await as(site)
      .post(`/leagues/${L}/players`, { nickname: n, fullName: `${n} Fakesurname` })
      .expect(201);
    ids.push(body.id);
    await as(site).patch(`/leagues/${L}/players/${body.id}`, { handicap: 10 }).expect(200);
  }
  const S = (
    await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201)
  ).body.id as string;
  const sched = (
    await as(site).post(`/leagues/${L}/seasons/${S}/generate`, { seed: 5 }).expect(201)
  ).body;
  await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
  const week = sched.weeks[0];
  const card = `/leagues/${L}/seasons/${S}/weeks/${week.id}/groups/${week.groups[0].id}/scorecard`;
  const view = (await as(site).get(card).expect(200)).body;
  await as(site)
    .put(card, {
      layoutId: view.plannedLayoutId,
      rounds: view.players.map((p: { playerId: string }) => ({
        playerId: p.playerId,
        attendance: 'played',
        holeScores: Array.from({ length: 9 }, () => 5),
      })),
    })
    .expect(200);
  await as(site).patch(`/leagues/${L}`, { visibility: 'public' }).expect(200);
  return { L, S, ids, card };
}

async function guest(): Promise<SignedIn> {
  const agent = request.agent(t.app.getHttpServer());
  const res = await agent.post('/api/auth/guest').expect(200);
  return { agent, csrf: res.body.csrfToken };
}

describe('guests', () => {
  it('are offered only while a league is public', async () => {
    const anon = request(t.app.getHttpServer());
    expect((await anon.get('/api/auth/options').expect(200)).body.guests).toBe(false);
    await anon.post('/api/auth/guest').expect(404);
    await setup();
    expect((await anon.get('/api/auth/options').expect(200)).body.guests).toBe(true);
  });

  it('see public leagues, nicknames and golf, but nothing personal', async () => {
    const { L, S, ids, card } = await setup();
    const g = await guest();
    const me = (await as(g).get('/auth/me').expect(200)).body;
    expect(me.user).toMatchObject({ isGuest: true, email: '', isSiteAdmin: false });
    expect(me.leagues).toEqual([expect.objectContaining({ id: L, role: 'viewer' })]);

    const members = (await as(g).get(`/leagues/${L}/members`).expect(200)).body;
    expect(members.members).toEqual([]);
    expect(members.players.map((p: { nickname: string }) => p.nickname).sort()).toEqual(
      [...NAMES].sort(),
    );
    const schedule = (await as(g).get(`/leagues/${L}/seasons/${S}`).expect(200)).body;
    expect(schedule.weeks.length).toBeGreaterThan(0);
    const cardView = (await as(g).get(card).expect(200)).body;
    expect(cardView.card.enteredBy).toBeNull();
    expect(cardView.permissions.canEdit).toBe(false);
    const history = (await as(g).get(`/leagues/${L}/players/${ids[0]}/history`).expect(200)).body;
    expect(history.player.nickname).toBe('Richie Jr');
    await as(g).get(`/leagues/${L}/seasons/${S}/standings`).expect(200);
    await as(g).get(`/leagues/${L}/stats/holes?playerId=${ids[0]}`).expect(200);
    await as(g).get('/courses').expect(200);

    const everything = JSON.stringify([members, schedule, cardView, history]);
    expect(everything).not.toContain('Fakesurname');
    expect(everything).not.toContain('site@example.com');

    // Not for guests: notices, photos, people, the activity log, accounts.
    await as(g).get(`/leagues/${L}/announcements`).expect(403);
    await as(g).get(`/leagues/${L}/photos`).expect(403);
    await as(g).get(`/leagues/${L}/audit`).expect(403);
    await as(g).get('/users').expect(403);
    await as(g).get('/auth/security').expect(403);
    await as(g).get('/me/this-week').expect(403);
  });

  it('cannot change anything', async () => {
    const { L, card } = await setup();
    const g = await guest();
    await as(g).post(`${card}/submit`).expect(403);
    await as(g).post(`/leagues/${L}/announcements`, { title: 'Hi', body: 'x' }).expect(403);
    await as(g).patch(`/leagues/${L}`, { visibility: 'private' }).expect(403);
    await as(g).post('/bug-reports', { title: 'x', body: 'y' }).expect(403);
  });

  it("don't see private leagues, and lose a league when it goes private", async () => {
    const { L } = await setup();
    const g = await guest();
    await as(site).patch(`/leagues/${L}`, { visibility: 'private' }).expect(200);
    await as(g).get(`/leagues/${L}`).expect(404);
    expect((await as(g).get('/auth/me').expect(200)).body.leagues).toEqual([]);
  });

  it('can stop being a guest', async () => {
    await setup();
    const g = await guest();
    await as(g).post('/auth/logout').expect(204);
    await as(g).get('/auth/me').expect(401);
  });
});
