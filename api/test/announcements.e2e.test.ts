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
