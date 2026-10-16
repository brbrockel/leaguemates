import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { magicLinkTokens, sessions, users } from '../src/db/schema.js';
import {
  createTestApp,
  createUser,
  resetDb,
  signIn,
  tokenFromOutbox,
  type TestApp,
} from './helpers.js';

let t: TestApp;
const http = () => request(t.app.getHttpServer());

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.outbox.length = 0;
});

describe('everything requires sign-in', () => {
  it('health is public', async () => {
    await http().get('/api/health').expect(200, { ok: true });
  });

  it.each(['/api/auth/me', '/api/leagues'])('%s returns 401 without a session', async (path) => {
    await http().get(path).expect(401);
  });

  it('a made-up session cookie is rejected', async () => {
    await http()
      .get('/api/auth/me')
      .set('Cookie', 'teemate_session=not-a-real-session')
      .expect(401);
  });

  it('sets security headers', async () => {
    const res = await http().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('magic link sign-in', () => {
  it('signs in an existing user with a one-time link', async () => {
    await createUser(t.db, 'brian@example.com', true);
    const { agent, csrf } = await signIn(t, 'brian@example.com');

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ email: 'brian@example.com', isSiteAdmin: true });
    expect(me.body.csrfToken).toBe(csrf);
  });

  it('puts the token in the URL fragment and stores only its hash', async () => {
    await createUser(t.db, 'brian@example.com');
    await http().post('/api/auth/magic-link').send({ email: 'Brian@Example.com ' }).expect(202);
    const token = tokenFromOutbox(t.outbox, 'brian@example.com');
    expect(t.outbox[0]!.text).toContain(`http://localhost:4101/sign-in/verify#token=${token}`);
    const rows = await t.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
  });

  it('gives the same answer for unknown emails but sends nothing', async () => {
    const res = await http().post('/api/auth/magic-link').send({ email: 'stranger@example.com' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(t.outbox).toHaveLength(0);
    expect(await t.db.select().from(magicLinkTokens)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    await http().post('/api/auth/magic-link').send({ email: 'not-an-email' }).expect(400);
  });

  it('a link works only once', async () => {
    await createUser(t.db, 'brian@example.com');
    await http().post('/api/auth/magic-link').send({ email: 'brian@example.com' }).expect(202);
    const token = tokenFromOutbox(t.outbox, 'brian@example.com');
    await http().post('/api/auth/verify').send({ token }).expect(200);
    const again = await http().post('/api/auth/verify').send({ token }).expect(401);
    expect(again.body.message).toMatch(/already used/);
  });

  it('an expired link is rejected', async () => {
    await createUser(t.db, 'brian@example.com');
    await http().post('/api/auth/magic-link').send({ email: 'brian@example.com' }).expect(202);
    const token = tokenFromOutbox(t.outbox, 'brian@example.com');
    await t.db.update(magicLinkTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await http().post('/api/auth/verify').send({ token }).expect(401);
    expect(res.body.message).toMatch(/expired/);
  });

  it('a made-up token is rejected', async () => {
    await http()
      .post('/api/auth/verify')
      .send({ token: 'x'.repeat(43) })
      .expect(401);
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    await createUser(t.db, 'brian@example.com');
    await http().post('/api/auth/magic-link').send({ email: 'brian@example.com' });
    const res = await http()
      .post('/api/auth/verify')
      .send({ token: tokenFromOutbox(t.outbox, 'brian@example.com') });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/teemate_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('a disabled user cannot get a link, and their sessions stop working', async () => {
    const user = await createUser(t.db, 'brian@example.com');
    const { agent } = await signIn(t, 'brian@example.com');
    await t.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));
    await agent.get('/api/auth/me').expect(401);
    t.outbox.length = 0;
    await http().post('/api/auth/magic-link').send({ email: 'brian@example.com' }).expect(202);
    expect(t.outbox).toHaveLength(0);
  });
});

describe('sessions', () => {
  it('logout revokes the session on the server', async () => {
    await createUser(t.db, 'brian@example.com');
    const { agent, csrf } = await signIn(t, 'brian@example.com');
    const [session] = await t.db.select().from(sessions);
    await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf).expect(204);
    await agent.get('/api/auth/me').expect(401);
    const [after] = await t.db.select().from(sessions).where(eq(sessions.id, session!.id));
    expect(after!.revokedAt).not.toBeNull();
  });

  it('an expired session is rejected', async () => {
    await createUser(t.db, 'brian@example.com');
    const { agent } = await signIn(t, 'brian@example.com');
    await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('CSRF protection', () => {
  it('state-changing requests need the session CSRF token', async () => {
    await createUser(t.db, 'brian@example.com', true);
    const { agent, csrf } = await signIn(t, 'brian@example.com');
    await agent.post('/api/leagues').send({ name: 'Wednesday League' }).expect(403);
    await agent
      .post('/api/leagues')
      .set('X-CSRF-Token', 'wrong')
      .send({ name: 'Wednesday League' })
      .expect(403);
    await agent
      .post('/api/leagues')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Wednesday League' })
      .expect(201);
  });
});

describe('rate limits', () => {
  it('quietly stops sending links after 3 requests per email in 15 minutes', async () => {
    await createUser(t.db, 'brian@example.com');
    for (let i = 0; i < 5; i++) {
      await http().post('/api/auth/magic-link').send({ email: 'brian@example.com' }).expect(202);
    }
    expect(t.outbox).toHaveLength(3);
  });

  it('returns 429 after 10 link requests from one IP in 15 minutes', async () => {
    for (let i = 0; i < 10; i++) {
      await http()
        .post('/api/auth/magic-link')
        .send({ email: `p${i}@example.com` })
        .expect(202);
    }
    await http().post('/api/auth/magic-link').send({ email: 'p10@example.com' }).expect(429);
  });
});
