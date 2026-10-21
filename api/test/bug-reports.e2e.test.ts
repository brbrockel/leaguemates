import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ISSUE_TRACKER, reporterLabel, type IssueTracker } from '../src/bugs/bug-reports.js';
import { bugReports, users } from '../src/db/schema.js';
import {
  createTestApp,
  createUser,
  resetDb,
  signIn,
  type SignedIn,
  type TestApp,
} from './helpers.js';

let t: TestApp;
let filed: Parameters<IssueTracker['create']>[0][];
let failNext = false;
const tracker: IssueTracker = {
  async create(issue) {
    if (failNext) {
      failNext = false;
      throw new Error('GitHub answered 503: down');
    }
    filed.push(issue);
    return { number: filed.length, url: `https://github.com/x/y/issues/${filed.length}` };
  },
};

beforeAll(async () => {
  t = await createTestApp({ APP_VERSION: 'abc1234' }, (m) =>
    m.overrideProvider(ISSUE_TRACKER).useValue(tracker),
  );
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  filed = [];
  failNext = false;
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent
      .post(`/api${path}`)
      .set('X-CSRF-Token', who.csrf)
      .set('User-Agent', 'Mozilla/5.0 (iPhone)')
      .send(body),
});

async function person(email: string, values: { name?: string; nickname?: string } = {}) {
  const u = await createUser(t.db, email);
  if (Object.keys(values).length) await t.db.update(users).set(values).where(eq(users.id, u.id));
  return signIn(t, email);
}

describe('reporting a problem', () => {
  it('files a public issue signed only with the nickname, and keeps who sent it', async () => {
    const jerry = await person('jerry@example.com', { name: 'Jerry Smith', nickname: 'Big Dog' });
    const { body } = await as(jerry)
      .post('/bug-reports', {
        title: 'Scores vanish',
        happened: 'I saved hole 3 and it went blank. @everyone look',
        expected: 'The score stays',
        page: '/leagues/1/seasons/2',
      })
      .expect(201);
    expect(body).toMatchObject({ issueNumber: 1, issueUrl: 'https://github.com/x/y/issues/1' });

    const issue = filed[0]!;
    expect(issue.title).toBe('Scores vanish');
    expect(issue.labels).toEqual(['bug']);
    expect(issue.body).toContain('Reported in the app by Big Dog');
    expect(issue.body).toContain('/leagues/1/seasons/2');
    expect(issue.body).toContain('abc1234');
    expect(issue.body).toContain('iPhone');
    // Nothing that identifies them beyond the nickname, and no pings.
    expect(issue.body).not.toMatch(/Smith|jerry@example\.com/);
    expect(issue.body).not.toContain('@everyone');

    const [row] = await t.db.select().from(bugReports);
    expect(row).toMatchObject({ title: 'Scores vanish', issueNumber: 1, appVersion: 'abc1234' });
  });

  it('signs with the first name when there is no nickname', () => {
    expect(reporterLabel({ nickname: null, name: 'Jerry Smith' })).toBe('Jerry');
    expect(reporterLabel({ nickname: '  ', name: null })).toBe('a LeagueMates user');
  });

  it('keeps the report when GitHub fails, and site admins see it with the reporter', async () => {
    const jerry = await person('jerry@example.com', { name: 'Jerry Smith' });
    failNext = true;
    const { body } = await as(jerry)
      .post('/bug-reports', { title: 'Crash', happened: 'It crashed' })
      .expect(201);
    expect(body.issueUrl).toBeNull();

    await createUser(t.db, 'site@example.com', true);
    const site = await signIn(t, 'site@example.com');
    const list = (await as(site).get('/bug-reports').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({
        title: 'Crash',
        reporterName: 'Jerry Smith',
        reporterEmail: 'jerry@example.com',
        issueUrl: null,
        issueError: expect.stringContaining('503'),
      }),
    ]);
    await as(jerry).get('/bug-reports').expect(403);
  });

  it('allows 5 reports a day per person', async () => {
    const jerry = await person('jerry@example.com');
    for (let i = 0; i < 5; i++)
      await as(jerry)
        .post('/bug-reports', { title: `Problem ${i}`, happened: 'x' })
        .expect(201);
    await as(jerry).post('/bug-reports', { title: 'One more', happened: 'x' }).expect(429);
  });

  it('needs a title and what happened, and a sign-in', async () => {
    const jerry = await person('jerry@example.com');
    await as(jerry).post('/bug-reports', { title: 'x', happened: 'y' }).expect(400);
    await as(jerry).post('/bug-reports', { title: 'Something', happened: '' }).expect(400);
    const { default: request } = await import('supertest');
    const res = await request(t.app.getHttpServer())
      .post('/api/bug-reports')
      .send({ title: 'Something', happened: 'y' });
    expect([401, 403]).toContain(res.status);
    expect(await t.db.select().from(bugReports)).toHaveLength(0);
  });
});
