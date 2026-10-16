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
  t.outbox.length = 0;
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  delete: (path: string) => who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf),
  put: (path: string, body: object) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

describe('announcements', () => {
  it('admins post, members read, pinned first; nothing is emailed', async () => {
    const { body: league } = await as(site)
      .post('/leagues', { name: 'Wednesday League' })
      .expect(201);
    const L = league.id as string;
    await as(site).post('/users', { email: 'user@example.com', leagueId: L }).expect(201);
    await createUser(t.db, 'outsider@example.com');
    const user = await signIn(t, 'user@example.com');
    const outsider = await signIn(t, 'outsider@example.com');
    t.outbox.length = 0;

    const { body: first } = await as(site)
      .post(`/leagues/${L}/announcements`, {
        title: 'Rainout',
        body: 'No golf tonight.\nSee you next week.',
      })
      .expect(201);
    await as(site)
      .post(`/leagues/${L}/announcements`, { title: 'Dues are $40', pinned: true })
      .expect(201);
    await as(site).post(`/leagues/${L}/announcements`, { title: '' }).expect(400);

    const list = (await as(user).get(`/leagues/${L}/announcements`).expect(200)).body;
    expect(list.map((a: { title: string }) => a.title)).toEqual(['Dues are $40', 'Rainout']);
    expect(list[1]).toMatchObject({ body: 'No golf tonight.\nSee you next week.', pinned: false });
    expect(
      (await as(user).get(`/leagues/${L}/announcements?limit=1`).expect(200)).body,
    ).toHaveLength(1);

    await as(user).post(`/leagues/${L}/announcements`, { title: 'Hi' }).expect(403);
    await as(user).delete(`/leagues/${L}/announcements/${first.id}`).expect(403);
    await as(outsider).get(`/leagues/${L}/announcements`).expect(404);

    const edited = (
      await as(site)
        .patch(`/leagues/${L}/announcements/${first.id}`, { title: 'Rainout tonight' })
        .expect(200)
    ).body;
    expect(edited.title).toBe('Rainout tonight');
    expect(edited.updatedAt).not.toBeNull();
    await as(site).delete(`/leagues/${L}/announcements/${first.id}`).expect(200);
    await as(site).delete(`/leagues/${L}/announcements/${first.id}`).expect(404);
    expect((await as(user).get(`/leagues/${L}/announcements`).expect(200)).body).toHaveLength(1);

    const log = (await as(site).get(`/leagues/${L}/audit`).expect(200)).body.entries;
    expect(log.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['announcement.create', 'announcement.update', 'announcement.delete']),
    );
    expect(t.outbox).toHaveLength(0);
  });
});

describe('notices for a foursome or one person, read and dismissed', () => {
  /** 8 players (Jerry and Keith with accounts) in a locked season. */
  async function setup() {
    const { body: league } = await as(site).post('/leagues', { name: 'Wed' }).expect(201);
    const L = league.id as string;
    const ids: Record<string, string> = {};
    for (const nickname of ['Jerry', 'Keith', 'Doc', 'Paul', 'Rich', 'Todd', 'Tony', 'Don'])
      ids[nickname] = (
        await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201)
      ).body.id;
    for (const n of ['Jerry', 'Keith'])
      await as(site)
        .post('/users', { email: `${n.toLowerCase()}@example.com`, leagueId: L, playerId: ids[n] })
        .expect(201);
    const { body: season } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const S = season.id as string;
    await as(site)
      .put(`/leagues/${L}/seasons/${S}/roster`, { playerIds: Object.values(ids) })
      .expect(200);
    const sched = (await as(site).post(`/leagues/${L}/seasons/${S}/generate`, { seed: 3 }))
      .body as {
      weeks: {
        id: string;
        groups: { id: string; matches: { playerA: string; playerB: string }[] }[];
      }[];
    };
    await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
    const week = sched.weeks[0]!;
    const groupOf = (name: string) =>
      week.groups.find((g) => g.matches.some((m) => [m.playerA, m.playerB].includes(ids[name]!)))!;
    const jerry = await signIn(t, 'jerry@example.com');
    const keith = await signIn(t, 'keith@example.com');
    const people = (await as(site).get('/users').expect(200)).body as {
      id: string;
      email: string;
    }[];
    const userId = (email: string) => people.find((p) => p.email === email)!.id;
    return { L, S, week, groupOf, jerry, keith, userId };
  }
  const titles = (list: { title: string }[]) => list.map((a) => a.title);

  it('each person sees what is for them; admins see everything', async () => {
    const { L, groupOf, jerry, keith, userId } = await setup();
    // Make sure Jerry and Keith aren't in the same foursome for this test.
    const jerryGroup = groupOf('Jerry');
    const keithInJerrysGroup = jerryGroup === groupOf('Keith');

    await as(site)
      .post(`/leagues/${L}/announcements`, {
        title: 'Pay your fee',
        audience: 'person',
        recipientUserId: userId('jerry@example.com'),
      })
      .expect(201);
    await as(site)
      .post(`/leagues/${L}/announcements`, {
        title: 'Tee time moved',
        audience: 'group',
        groupId: jerryGroup.id,
      })
      .expect(201);
    await as(site)
      .post(`/leagues/${L}/announcements`, { title: 'Dues', audience: 'person' })
      .expect(400);

    const forJerry = (await as(jerry).get(`/leagues/${L}/announcements`).expect(200)).body;
    expect(titles(forJerry).sort()).toEqual(['Pay your fee', 'Tee time moved']);
    expect(forJerry.find((a: { title: string }) => a.title === 'Pay your fee').to).toBe('You');
    expect(forJerry.find((a: { title: string }) => a.title === 'Tee time moved').to).toBe(
      'Your foursome',
    );
    const forKeith = (await as(keith).get(`/leagues/${L}/announcements`).expect(200)).body;
    expect(titles(forKeith)).toEqual(keithInJerrysGroup ? ['Tee time moved'] : []);
    const forAdmin = (await as(site).get(`/leagues/${L}/announcements`).expect(200)).body;
    expect(forAdmin.find((a: { title: string }) => a.title === 'Pay your fee').to).toBe('Jerry');
    expect(forAdmin.find((a: { title: string }) => a.title === 'Tee time moved').to).toMatch(
      /^Round 1, \d(st|nd|rd|th) off$/,
    );
  });

  it('read and dismissed per person; an edited pinned notice comes back', async () => {
    const { L, jerry, keith } = await setup();
    const { body: n } = await as(site)
      .post(`/leagues/${L}/announcements`, { title: 'Bring $20', pinned: true })
      .expect(201);
    const state = async (who: SignedIn) =>
      (await as(who).get(`/leagues/${L}/announcements`).expect(200)).body[0];
    expect(await state(jerry)).toMatchObject({ read: false, dismissed: false });

    await as(jerry)
      .post(`/leagues/${L}/announcements/read`, { ids: [n.id] })
      .expect(200);
    expect(await state(jerry)).toMatchObject({ read: true, dismissed: false });
    expect(await state(keith)).toMatchObject({ read: false });

    await as(jerry)
      .post(`/leagues/${L}/announcements/dismiss`, { ids: [n.id] })
      .expect(200);
    expect(await state(jerry)).toMatchObject({ read: true, dismissed: true });

    await as(site).patch(`/leagues/${L}/announcements/${n.id}`, { title: 'Bring $25' });
    expect(await state(jerry)).toMatchObject({ title: 'Bring $25', read: false, dismissed: false });
  });

  it('can be emailed (the mail guard applies) and gives the phones to text it', async () => {
    const { L } = await setup();
    t.outbox.length = 0; // the sign-in emails from setup
    const { body } = await as(site)
      .post(`/leagues/${L}/announcements`, { title: 'Rained out', email: true })
      .expect(201);
    // The test app's allowlist is empty, so both members' emails are held back.
    expect(body).toMatchObject({ emailed: 0, held: 2 });
    expect(t.outbox).toHaveLength(0);
    await as(site).get(`/leagues/${L}/announcements/${body.id}/phones`).expect(200);
  });

  it('the app posts notices itself, e.g. for a rainout', async () => {
    const { L, S, week, jerry } = await setup();
    await as(site).post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/rainout`).expect(201);
    const list = (await as(jerry).get(`/leagues/${L}/announcements`).expect(200)).body;
    expect(list[0]).toMatchObject({
      title: 'Rained out: round 1',
      kind: 'week.rainout',
      author: 'TeeMate',
      to: 'League',
    });
  });
});
