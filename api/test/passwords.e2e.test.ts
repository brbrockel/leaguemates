import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, hashRecovery, totpAt, currentStep } from '../src/auth/totp.js';
import { auditLog, users } from '../src/db/schema.js';
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
  t = await createTestApp({ APP_SECRET });
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
});

const PASSWORD = 'four fairways and a green';
const http = () => request(t.app.getHttpServer());
const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

/** Jerry, a user in a league, with a password set from an admin's link. */
async function jerryWithPassword() {
  const { body: league } = await as(site)
    .post('/leagues', { name: 'Wednesday League' })
    .expect(201);
  const { body: jerry } = await as(site)
    .post('/users', { email: 'jerry@example.com', leagueId: league.id })
    .expect(201);
  const { body } = await as(site).post(`/users/${jerry.id}/password-link`).expect(201);
  const token = (body.link as string).split('#token=')[1]!;
  await http().post('/api/auth/password-link').send({ token, password: PASSWORD }).expect(200);
  return jerry.id as string;
}

const login = (email: string, password: string, code?: string) => {
  const agent = request.agent(t.app.getHttpServer());
  return {
    agent,
    res: agent.post('/api/auth/login').send({ email, password, ...(code ? { code } : {}) }),
  };
};

describe('password sign-in', () => {
  it('signs in with the right password; the same message for a wrong password or unknown email', async () => {
    await jerryWithPassword();
    const ok = login('Jerry@Example.com', PASSWORD);
    const res = await ok.res.expect(200);
    expect(res.body.user.email).toBe('jerry@example.com');
    await ok.agent.get('/api/auth/me').expect(200);

    const wrong = await login('jerry@example.com', 'not the password').res.expect(401);
    const nobody = await login('nobody@example.com', 'not the password').res.expect(401);
    expect(wrong.body.message).toBe('Email or password is incorrect.');
    expect(nobody.body.message).toBe(wrong.body.message);
    // No password set yet: also the same message.
    await createUser(t.db, 'nopass@example.com');
    expect((await login('nopass@example.com', PASSWORD).res.expect(401)).body.message).toBe(
      wrong.body.message,
    );
  });

  it('cools an account down after 5 wrong passwords, longer each time; an admin can unlock it', async () => {
    const jerryId = await jerryWithPassword();
    for (let i = 0; i < 5; i++) await login('jerry@example.com', 'wrong password').res.expect(401);
    const locked = await login('jerry@example.com', PASSWORD).res.expect(429);
    expect(locked.body.message).toMatch(/Try again in 15 minutes/);
    let [row] = await t.db.select().from(users).where(eq(users.id, jerryId));
    expect(row!.lockouts).toBe(1);

    // An admin unlocks it; the next lockout in a row would be 30 minutes.
    const people = (await as(site).get('/users').expect(200)).body;
    expect(people.find((p: { id: string }) => p.id === jerryId).lockedUntil).not.toBeNull();
    await as(site).post(`/users/${jerryId}/unlock`).expect(204);
    await login('jerry@example.com', PASSWORD).res.expect(200);
    [row] = await t.db.select().from(users).where(eq(users.id, jerryId));
    expect(row).toMatchObject({ failedLogins: 0, lockouts: 0, lockedUntil: null });

    await t.db.update(users).set({ lockouts: 1 }).where(eq(users.id, jerryId));
    for (let i = 0; i < 5; i++) await login('jerry@example.com', 'wrong password').res;
    expect((await login('jerry@example.com', PASSWORD).res.expect(429)).body.message).toMatch(
      /30 minutes/,
    );
    const actions = (await t.db.select().from(auditLog)).map((r) => r.action);
    expect(actions.filter((a) => a === 'auth.lockout')).toHaveLength(2);
    expect(actions).toContain('user.unlock');
  });

  it('a burst of parallel wrong passwords gets no more than 5 tries', async () => {
    const jerryId = await jerryWithPassword();
    const tries = await Promise.all(
      Array.from({ length: 12 }, (_, i) => login('jerry@example.com', `wrong guess ${i}xx`).res),
    );
    const checked = tries.filter((r) => r.status === 401);
    expect(checked.length).toBeLessThanOrEqual(5);
    expect(tries.every((r) => [401, 423, 429].includes(r.status))).toBe(true);
    const [row] = await t.db.select().from(users).where(eq(users.id, jerryId));
    expect(row!.lockedUntil).not.toBeNull();
    // Even the right password waits out the cooldown.
    expect((await login('jerry@example.com', PASSWORD).res).status).not.toBe(200);
  });

  it('changing your password signs out your other sessions', async () => {
    await jerryWithPassword();
    const phone = login('jerry@example.com', PASSWORD);
    await phone.res.expect(200);
    const laptop = login('jerry@example.com', PASSWORD);
    const { body } = await laptop.res.expect(200);
    await laptop.agent
      .post('/api/auth/password')
      .set('X-CSRF-Token', body.csrfToken)
      .send({ current: 'wrong', password: 'a brand new passphrase' })
      .expect(401);
    await laptop.agent
      .post('/api/auth/password')
      .set('X-CSRF-Token', body.csrfToken)
      .send({ current: PASSWORD, password: 'a brand new passphrase' })
      .expect(200);
    await laptop.agent.get('/api/auth/me').expect(200);
    await phone.agent.get('/api/auth/me').expect(401);
    await login('jerry@example.com', 'a brand new passphrase').res.expect(200);
  });
});

describe('authenticator codes (optional)', () => {
  it('turns on with a code, then sign-in asks for one; recovery codes work once', async () => {
    const jerryId = await jerryWithPassword();
    const first = login('jerry@example.com', PASSWORD);
    const { body: s } = await first.res.expect(200);
    const me = { agent: first.agent, csrf: s.csrfToken as string };

    expect((await as(me).get('/auth/security').expect(200)).body).toMatchObject({
      hasPassword: true,
      totpEnabled: false,
      totpAvailable: true,
    });
    const { body: setup } = await as(me).post('/auth/totp/start').expect(200);
    expect(setup.url).toMatch(/^otpauth:\/\/totp\/LeagueMates%3Ajerry%40example\.com\?secret=/);
    // The secret is stored encrypted.
    const [row] = await t.db.select().from(users).where(eq(users.id, jerryId));
    expect(row!.totpSecret).not.toContain(setup.secret);
    expect(decryptSecret(row!.totpSecret!, APP_SECRET)).toBe(setup.secret);

    await as(me).post('/auth/totp/enable', { code: '000000' }).expect(400);
    const step = currentStep();
    const { body: on } = await as(me)
      .post('/auth/totp/enable', { code: totpAt(setup.secret, step) })
      .expect(200);
    expect(on.recoveryCodes).toHaveLength(8);

    // Password alone isn't enough now.
    expect((await login('jerry@example.com', PASSWORD).res.expect(200)).body).toEqual({
      needsCode: true,
    });
    await login('jerry@example.com', PASSWORD, '123456').res.expect(401);
    // The code used to turn it on can't be replayed; the next one works.
    await login('jerry@example.com', PASSWORD, totpAt(setup.secret, step)).res.expect(401);
    await login('jerry@example.com', PASSWORD, totpAt(setup.secret, step + 1)).res.expect(200);

    const code = on.recoveryCodes[0] as string;
    await login('jerry@example.com', PASSWORD, code).res.expect(200);
    await login('jerry@example.com', PASSWORD, code).res.expect(401);
    const [after] = await t.db.select().from(users).where(eq(users.id, jerryId));
    expect(after!.totpRecovery).toHaveLength(7);
    expect(after!.totpRecovery).not.toContain(hashRecovery(code));

    // A lost phone: a site admin turns it off.
    await as(site).post(`/users/${jerryId}/reset-authenticator`).expect(204);
    await login('jerry@example.com', PASSWORD).res.expect(200);
  });

  it('turning it off needs your password', async () => {
    await jerryWithPassword();
    const first = login('jerry@example.com', PASSWORD);
    const { body: s } = await first.res.expect(200);
    const me = { agent: first.agent, csrf: s.csrfToken as string };
    const { body: setup } = await as(me).post('/auth/totp/start').expect(200);
    await as(me)
      .post('/auth/totp/enable', { code: totpAt(setup.secret, currentStep()) })
      .expect(200);
    await as(me).post('/auth/totp/disable', { password: 'nope' }).expect(401);
    await as(me).post('/auth/totp/disable', { password: PASSWORD }).expect(200);
    expect((await as(me).get('/auth/security').expect(200)).body.totpEnabled).toBe(false);
  });

  it("a password link doesn't get past the authenticator", async () => {
    const jerryId = await jerryWithPassword();
    const first = login('jerry@example.com', PASSWORD);
    const { body: s } = await first.res.expect(200);
    const me = { agent: first.agent, csrf: s.csrfToken as string };
    const { body: setup } = await as(me).post('/auth/totp/start').expect(200);
    const step = currentStep();
    await as(me)
      .post('/auth/totp/enable', { code: totpAt(setup.secret, step) })
      .expect(200);

    const { body } = await as(site).post(`/users/${jerryId}/password-link`).expect(201);
    const token = (body.link as string).split('#token=')[1]!;
    const NEW = 'a brand new password here';
    const link = request.agent(t.app.getHttpServer());
    const res = await link
      .post('/api/auth/password-link')
      .send({ token, password: NEW })
      .expect(200);
    // The password is set, but there's no session until the code is given.
    expect(res.body).toEqual({ needsCode: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    await link.get('/api/auth/me').expect(401);
    await login('jerry@example.com', NEW, totpAt(setup.secret, step + 1)).res.expect(200);
  });

  it('only a site admin can reset someone else', async () => {
    const jerryId = await jerryWithPassword();
    const first = login('jerry@example.com', PASSWORD);
    const { body: s } = await first.res.expect(200);
    await first.agent
      .post(`/api/users/${jerryId}/reset-authenticator`)
      .set('X-CSRF-Token', s.csrfToken)
      .expect(403);
  });
});
