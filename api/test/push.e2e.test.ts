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
  t.pushed.length = 0;
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  put: (path: string, body: object = {}) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  delete: (path: string, body: object = {}) =>
    who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

const device = (name: string) => ({
  endpoint: `https://push.example.com/${name}`,
  keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
});

/** A locked 8-player season where Jerry and his round-1 opponent have accounts. */
async function setup() {
  const { body: league } = await as(site).post('/leagues', { name: 'Wed' }).expect(201);
  const L = league.id as string;
  const ids: Record<string, string> = {};
  for (const nickname of ['Jerry', 'Keith', 'Doc', 'Paul', 'Rich', 'Todd', 'Tony', 'Don'])
    ids[nickname] = (
      await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201)
    ).body.id;
  const { body: season } = await as(site)
    .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
    .expect(201);
  const S = season.id as string;
  await as(site)
    .put(`/leagues/${L}/seasons/${S}/roster`, { playerIds: Object.values(ids) })
    .expect(200);
  const { body: sched } = await as(site).post(`/leagues/${L}/seasons/${S}/generate`, { seed: 3 });
  await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
  const week = sched.weeks[0] as {
    id: string;
    groups: { id: string; matches: { playerA: string; playerB: string }[] }[];
  };
  const group = week.groups.find((g) =>
    g.matches.some((m) => [m.playerA, m.playerB].includes(ids['Jerry']!)),
  )!;
  const m = group.matches.find((x) => [x.playerA, x.playerB].includes(ids['Jerry']!))!;
  const mateId = m.playerA === ids['Jerry'] ? m.playerB : m.playerA;
  for (const [email, playerId] of [
    ['jerry@example.com', ids['Jerry']],
    ['mate@example.com', mateId],
  ])
    await as(site).post('/users', { email, leagueId: L, playerId }).expect(201);
  const jerry = await signIn(t, 'jerry@example.com');
  const mate = await signIn(t, 'mate@example.com');
  return { L, S, ids, week, group, jerry, mate };
}

describe('push notifications', () => {
  it('gives the key, and only signed-in people can turn push on', async () => {
    const { body } = await as(site).get('/push/key').expect(200);
    expect(body).toEqual({ publicKey: 'BTestVapidPublicKey000000000' });
    await as(site)
      .post('/push/subscriptions', { endpoint: 'not a url', keys: { p256dh: 'x', auth: 'y' } })
      .expect(400);
    await as(site).post('/push/subscriptions', device('site')).expect(200);
  });

  it('goes to the devices of those a notice is for, never the person who caused it', async () => {
    const { L, S, ids, week, group, jerry, mate } = await setup();
    await as(jerry).post('/push/subscriptions', device('jerry-phone')).expect(200);
    await as(mate).post('/push/subscriptions', device('mate-phone')).expect(200);
    await as(mate).post('/push/subscriptions', device('mate-gone')).expect(200);
    await as(site).post('/push/subscriptions', device('site')).expect(200);

    // An admin's notice to the league: everyone but the admin who posted it.
    await as(site).post(`/leagues/${L}/announcements`, { title: 'Dues', body: '$40' }).expect(201);
    expect(t.pushed.map((p) => p.endpoint).sort()).toEqual([
      'https://push.example.com/jerry-phone',
      'https://push.example.com/mate-phone',
    ]);
    expect(t.pushed[0]).toMatchObject({ title: 'Dues', body: '$40', url: '/' });

    // The device the push service said was gone has been dropped.
    t.pushed.length = 0;
    await as(site).post(`/leagues/${L}/announcements`, { title: 'Again' }).expect(201);
    expect(t.pushed).toHaveLength(2);

    // Jerry can't make it: his foursome hears, Jerry doesn't.
    t.pushed.length = 0;
    await as(jerry)
      .put(`/leagues/${L}/seasons/${S}/weeks/${week.id}/absences/${ids['Jerry']}`, {})
      .expect(200);
    expect(t.pushed).toEqual([
      {
        endpoint: 'https://push.example.com/mate-phone',
        title: "Jerry can't make round 1",
        body: 'No sub yet.',
        url: `/leagues/${L}/seasons/${S}/weeks/${week.id}/groups/${group.id}`,
      },
    ]);

    // A rainout goes to the league's members (the site admin isn't one) and opens the season.
    t.pushed.length = 0;
    await as(site).post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/rainout`).expect(201);
    expect(t.pushed.map((p) => p.endpoint).sort()).toEqual([
      'https://push.example.com/jerry-phone',
      'https://push.example.com/mate-phone',
    ]);
    expect(t.pushed[0]).toMatchObject({
      title: 'Rained out: round 1',
      url: `/leagues/${L}/seasons/${S}`,
    });

    // Card approvals and playoff updates stay in the app; site-wide notices reach everyone.
    t.pushed.length = 0;
    await as(site).post('/notices/site', { title: 'Down Sunday' }).expect(201);
    expect(t.pushed).toHaveLength(3);
  });

  it('turning it off removes only your own device', async () => {
    const { jerry, mate } = await setup();
    await as(jerry).post('/push/subscriptions', device('jerry-phone')).expect(200);
    await as(mate).delete('/push/subscriptions', { endpoint: device('jerry-phone').endpoint });
    await as(site).post('/notices/site', { title: 'Still on' }).expect(201);
    expect(t.pushed.map((p) => p.endpoint)).toEqual(['https://push.example.com/jerry-phone']);

    t.pushed.length = 0;
    await as(jerry).delete('/push/subscriptions', { endpoint: device('jerry-phone').endpoint });
    await as(site).post('/notices/site', { title: 'Now off' }).expect(201);
    expect(t.pushed).toEqual([]);
  });
});
