import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, siteSettings } from '../src/db/schema.js';
import {
  createTestApp,
  createUser,
  resetDb,
  signIn,
  type SignedIn,
  type TestApp,
} from './helpers.js';

const APP_SECRET = 'test-app-secret-0123456789-abcdefghij';
let t: TestApp;
let site: SignedIn;

beforeAll(async () => {
  t = await createTestApp({ APP_SECRET, MAIL_MODE: 'off' });
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
  t.outbox.length = 0;
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  put: (path: string, body: object) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

const gmail = {
  mode: 'allowlist',
  allowlist: 'allowed@example.com',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  user: 'league@example.com',
  password: 'abcd efgh ijkl mnop',
  from: 'TeeMate <league@example.com>',
};

describe('email settings', () => {
  it("use the server's settings until a site admin saves some in the app", async () => {
    const { body } = await as(site).get('/site-settings').expect(200);
    expect(body.mail).toMatchObject({ source: 'server', mode: 'off', hasPassword: false });
    expect(body.mail).not.toHaveProperty('password');

    const saved = (await as(site).put('/site-settings/mail', gmail).expect(200)).body;
    expect(saved.mail).toMatchObject({
      source: 'site',
      mode: 'allowlist',
      host: 'smtp.gmail.com',
      hasPassword: true,
    });
    expect(JSON.stringify(saved)).not.toContain('abcd efgh');
    // Stored encrypted; the audit log never has it.
    const [row] = await t.db.select().from(siteSettings).where(eq(siteSettings.id, 1));
    expect(row!.mail!.passwordEncrypted).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('abcd efgh');
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'site.mail'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('abcd efgh');
    expect(JSON.stringify(audit)).not.toContain(row!.mail!.passwordEncrypted!);
  });

  it('keeps the password unless a new one is given; null removes it', async () => {
    await as(site).put('/site-settings/mail', gmail).expect(200);
    const noPassword: Partial<typeof gmail> = { ...gmail };
    delete noPassword.password;
    const kept = (await as(site).put('/site-settings/mail', { ...noPassword, port: 587 })).body;
    expect(kept.mail).toMatchObject({ port: 587, hasPassword: true });
    const removed = (await as(site).put('/site-settings/mail', { ...gmail, password: null })).body;
    expect(removed.mail.hasPassword).toBe(false);
  });

  it('the guard follows the saved mode and allowlist straight away', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Wed' }).expect(201);
    const allowed = (
      await as(site).post('/users', { email: 'allowed@example.com', leagueId: league.id })
    ).body;
    const other = (
      await as(site).post('/users', { email: 'other@example.com', leagueId: league.id })
    ).body;
    // Server setting: off.
    expect(
      (await as(site).post(`/users/${allowed.id}/password-link/email`).expect(201)).body.sent,
    ).toBe(false);
    await as(site).put('/site-settings/mail', gmail).expect(200);
    expect(
      (await as(site).post(`/users/${allowed.id}/password-link/email`).expect(201)).body.sent,
    ).toBe(true);
    expect(
      (await as(site).post(`/users/${other.id}/password-link/email`).expect(201)).body.sent,
    ).toBe(false);
    expect(t.outbox.map((m) => m.to)).toEqual(['allowed@example.com']);
  });

  it("can't send to everyone while testing mode is on", async () => {
    await as(site)
      .put('/site-settings/test-login', { enabled: true, generateCode: true })
      .expect(200);
    await as(site)
      .put('/site-settings/mail', { ...gmail, mode: 'all' })
      .expect(400);
  });

  it("the test email reports the mail server's answer", async () => {
    await as(site)
      .put('/site-settings/mail', { ...gmail, host: '127.0.0.1', port: 1, secure: false })
      .expect(200);
    const { body } = await as(site).post('/site-settings/mail/test').expect(200);
    expect(body).toMatchObject({ ok: false, to: 'site@example.com' });
    expect(body.error).toMatch(/ECONNREFUSED|connect|timeout/i);
  });

  it('only site admins can see or change them', async () => {
    await createUser(t.db, 'jerry@example.com');
    const jerry = await signIn(t, 'jerry@example.com');
    await as(jerry).get('/site-settings').expect(403);
    await as(jerry).put('/site-settings/mail', gmail).expect(403);
    await as(jerry).post('/site-settings/mail/test').expect(403);
  });
});
