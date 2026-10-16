import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, leagueMemberships, siteSettings, users } from '../src/db/schema.js';
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
const http = () => request(t.app.getHttpServer());

beforeAll(async () => {
  t = await createTestApp({ MAGIC_LINK_LIMIT_PER_IP: 5 });
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
});

const put = (body: object) =>
  site.agent.put('/api/site-settings/test-login').set('X-CSRF-Token', site.csrf).send(body);

async function enableWithLeague() {
  const { body: league } = await site.agent
    .post('/api/leagues')
    .set('X-CSRF-Token', site.csrf)
    .send({ name: 'Wednesday League' })
    .expect(201);
  const { body } = await put({ enabled: true, generateCode: true, leagueId: league.id }).expect(
    200,
  );
  return { code: body.code as string, leagueId: league.id as string };
}

describe('testing mode is off by default', () => {
  it('the sign-in page is told not to offer it, and the endpoint does not exist', async () => {
    expect((await http().get('/api/auth/options').expect(200)).body).toEqual({
      testLogin: false,
      emailSignIn: true,
      passwordSignIn: true,
    });
    await http()
      .post('/api/auth/test-login')
      .send({ email: 'a@example.com', code: 'whatever' })
      .expect(404);
  });
});

describe('site admins control testing mode', () => {
  it('needs a code before it can be switched on; a generated code is shown once', async () => {
    await put({ enabled: true }).expect(400);
    const { body } = await put({ enabled: true, generateCode: true }).expect(200);
    expect(body.code).toMatch(/^TEE-\d{4}-\d{4}$/);
    expect(body.testLogin).toMatchObject({ enabled: true, active: true, hasCode: true });

    const view = (await site.agent.get('/api/site-settings').expect(200)).body;
    expect(JSON.stringify(view)).not.toContain(body.code);
    const [row] = await t.db.select().from(siteSettings);
    expect(row!.testLoginCodeHash).not.toContain(body.code);
    expect((await http().get('/api/auth/options')).body.testLogin).toBe(true);
  });

  it('a chosen code works; the audit log records the change but never the code', async () => {
    await put({ enabled: true, code: 'fairway-2027' }).expect(200);
    await http()
      .post('/api/auth/test-login')
      .send({ email: 'tester@example.com', code: 'fairway-2027' })
      .expect(200);
    const entries = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'site.test_login'));
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('fairway-2027');
  });

  it('only site admins can see or change it', async () => {
    const { leagueId } = await enableWithLeague();
    const [u] = await t.db.insert(users).values({ email: 'paul@example.com' }).returning();
    await t.db.insert(leagueMemberships).values({ leagueId, userId: u!.id, role: 'admin' });
    const { body } = await site.agent
      .post(`/api/users/${u!.id}/password-link`)
      .set('X-CSRF-Token', site.csrf)
      .expect(201);
    const agent = request.agent(t.app.getHttpServer());
    const res = await agent
      .post('/api/auth/password-link')
      .send({ token: body.link.split('#token=')[1], password: 'correct horse battery' })
      .expect(200);
    await agent.get('/api/site-settings').expect(403);
    await agent
      .put('/api/site-settings/test-login')
      .set('X-CSRF-Token', res.body.csrfToken)
      .send({ enabled: false })
      .expect(403);
  });

  it('switching it off makes the endpoint disappear again', async () => {
    const { code } = await enableWithLeague();
    await put({ enabled: false }).expect(200);
    await http().post('/api/auth/test-login').send({ email: 'site@example.com', code }).expect(404);
  });
});

describe('test sign-in', () => {
  it('signs in an existing account', async () => {
    const { code } = await enableWithLeague();
    await createUser(t.db, 'jerry@example.com');
    const agent = request.agent(t.app.getHttpServer());
    const res = await agent
      .post('/api/auth/test-login')
      .send({ email: 'Jerry@Example.com', code })
      .expect(200);
    expect(res.body.user).toMatchObject({ email: 'jerry@example.com', isSiteAdmin: false });
    await agent.get('/api/auth/me').expect(200);
  });

  it('never signs in as an admin or an account with authenticator codes', async () => {
    const { code, leagueId } = await enableWithLeague();
    await http().post('/api/auth/test-login').send({ email: 'site@example.com', code }).expect(403);
    const paul = await createUser(t.db, 'paul@example.com');
    await t.db.insert(leagueMemberships).values({ leagueId, userId: paul.id, role: 'admin' });
    await http().post('/api/auth/test-login').send({ email: 'paul@example.com', code }).expect(403);
    await t.db.insert(users).values({ email: 'safe@example.com', totpEnabledAt: new Date() });
    await http().post('/api/auth/test-login').send({ email: 'safe@example.com', code }).expect(403);
  });

  it('creates a new account as a user in the testing league, never an admin', async () => {
    const { code, leagueId } = await enableWithLeague();
    const agent = request.agent(t.app.getHttpServer());
    await agent
      .post('/api/auth/test-login')
      .send({ email: 'new.tester@example.com', name: 'New Tester', code })
      .expect(200);
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me.user).toMatchObject({
      email: 'new.tester@example.com',
      name: 'New Tester',
      isSiteAdmin: false,
    });
    expect(me.leagues).toEqual([expect.objectContaining({ id: leagueId, role: 'user' })]);
    const actions = (await t.db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['user.create', 'member.add', 'auth.test_login']),
    );
  });

  it('rejects a wrong code, and rate-limits guessing', async () => {
    await enableWithLeague();
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/api/auth/test-login')
        .send({ email: 'site@example.com', code: `wrong-${i}` })
        .expect(401);
    }
    await http()
      .post('/api/auth/test-login')
      .send({ email: 'site@example.com', code: 'wrong-x' })
      .expect(429);
  });

  it('a disabled account cannot sign in', async () => {
    const { code } = await enableWithLeague();
    await t.db.insert(users).values({ email: 'gone@example.com', disabledAt: new Date() });
    await http().post('/api/auth/test-login').send({ email: 'gone@example.com', code }).expect(403);
  });
});

describe('never with email fully on', () => {
  it('cannot be switched on, and an old setting is ignored', async () => {
    const full = await createTestApp({ MAIL_MODE: 'all' });
    try {
      await createUser(full.db, 'owner@example.com', true).catch(() => undefined);
      const owner = await signIn(full, 'site@example.com');
      await owner.agent
        .put('/api/site-settings/test-login')
        .set('X-CSRF-Token', owner.csrf)
        .send({ enabled: true, code: 'fairway-2027' })
        .expect(400);
      await full.db
        .insert(siteSettings)
        .values({ id: 1, testLoginEnabled: true, testLoginCodeHash: 'x' });
      const res = await request(full.app.getHttpServer()).get('/api/auth/options').expect(200);
      expect(res.body.testLogin).toBe(false);
    } finally {
      await full.close();
    }
  });
});
