import { eq } from 'drizzle-orm';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { normalizePhone } from '../src/common/phone.js';
import { auditLog } from '../src/db/schema.js';
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
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

describe('phone numbers', () => {
  it('normalises US numbers typed any way, and international numbers with +', () => {
    expect(normalizePhone('860-555-1234')).toBe('+18605551234');
    expect(normalizePhone('(860) 555 1234')).toBe('+18605551234');
    expect(normalizePhone('1 860 555 1234')).toBe('+18605551234');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('555-1234')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('contact details', () => {
  async function league() {
    const { body } = await as(site).post('/leagues', { name: 'Wednesday League' }).expect(201);
    return body.id as string;
  }

  it('people edit their own phone and address; it shows in /auth/me and is audited', async () => {
    const L = await league();
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: L }).expect(201);
    const jerry = await signIn(t, 'jerry@example.com');
    const res = await as(jerry)
      .patch('/me', { phone: '(860) 555-1234', address: ' 12 Main St, Berlin CT ' })
      .expect(200);
    expect(res.body).toMatchObject({ phone: '+18605551234', address: '12 Main St, Berlin CT' });
    expect((await as(jerry).get('/auth/me').expect(200)).body.user).toMatchObject({
      phone: '+18605551234',
    });
    await as(jerry).patch('/me', { phone: '12345' }).expect(400);
    await as(jerry).patch('/me', { phone: '' }).expect(200);
    expect((await as(jerry).get('/auth/me')).body.user.phone).toBeNull();
    const entries = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'user.update_self'));
    expect(entries).toHaveLength(2);
  });

  it('people set and clear their own nickname (optional; none by default)', async () => {
    const L = await league();
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: L }).expect(201);
    const jerry = await signIn(t, 'jerry@example.com');
    expect((await as(jerry).get('/auth/me').expect(200)).body.user.nickname).toBeNull();
    await as(jerry).patch('/me', { nickname: '  Big Dog ' }).expect(200);
    expect((await as(jerry).get('/auth/me')).body.user.nickname).toBe('Big Dog');
    await as(jerry)
      .patch('/me', { nickname: 'x'.repeat(31) })
      .expect(400);
    await as(jerry).patch('/me', { nickname: '' }).expect(200);
    expect((await as(jerry).get('/auth/me')).body.user.nickname).toBeNull();
  });

  it('league members see each other’s contact details; admins can edit them', async () => {
    const L = await league();
    const { body: jerry } = await as(site)
      .post('/users', { email: 'jerry@example.com', leagueId: L })
      .expect(201);
    await as(site)
      .patch(`/users/${jerry.id}`, { phone: '860.555.9999', address: '1 Golf Rd' })
      .expect(200);
    await as(site).post('/users', { email: 'paul@example.com', leagueId: L }).expect(201);
    const paul = await signIn(t, 'paul@example.com');
    const members = (await as(paul).get(`/leagues/${L}/members`).expect(200)).body.members;
    expect(members.find((m: { email: string }) => m.email === 'jerry@example.com')).toMatchObject({
      phone: '+18605559999',
      address: '1 Golf Rd',
    });
  });

  it('people outside the league cannot see them', async () => {
    const L = await league();
    const { body: other } = await as(site)
      .post('/leagues', { name: 'Thursday League' })
      .expect(201);
    await as(site).post('/users', { email: 'keith@example.com', leagueId: other.id }).expect(201);
    const keith = await signIn(t, 'keith@example.com');
    await as(keith).get(`/leagues/${L}/members`).expect(404);
  });
});
