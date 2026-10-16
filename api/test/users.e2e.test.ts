import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, players, users } from '../src/db/schema.js';
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
  // Only this address gets mail; the guard holds back everyone else's.
  t = await createTestApp({ MAIL_ALLOWLIST: 'allowed@example.com' });
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.outbox.length = 0;
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
  t.outbox.length = 0; // the setup sign-in email above
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  put: (path: string, body: object) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  del: (path: string) => who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf),
});

async function league(name: string) {
  return (await as(site).post('/leagues', { name }).expect(201)).body as { id: string };
}
async function addPerson(by: SignedIn, body: object) {
  return (await as(by).post('/users', body).expect(201)).body as { id: string };
}
/** Signs in by setting a password from an admin's link, the way a person would. */
async function signInWithLink(by: SignedIn, userId: string): Promise<SignedIn> {
  const { body } = await as(by).post(`/users/${userId}/password-link`).expect(201);
  const token = (body.link as string).split('#token=')[1]!;
  const agent = request.agent(t.app.getHttpServer());
  const res = await agent
    .post('/api/auth/password-link')
    .send({ token, password: 'correct horse battery' })
    .expect(200);
  return { agent, csrf: res.body.csrfToken };
}

describe('adding people', () => {
  it('creates an account in a league without sending any email', async () => {
    const wed = await league('Wednesday League');
    const { body: spot } = await as(site)
      .post(`/leagues/${wed.id}/players`, { nickname: 'Doc' })
      .expect(201);
    const doc = await addPerson(site, {
      email: 'Doc@Example.com',
      name: 'Sam Example',
      leagueId: wed.id,
      playerId: spot.id,
    });
    expect(t.outbox).toHaveLength(0);

    const [row] = await t.db.select().from(users).where(eq(users.id, doc.id));
    expect(row).toMatchObject({
      email: 'doc@example.com',
      name: 'Sam Example',
      lastSignInAt: null,
    });
    const [p] = await t.db.select().from(players).where(eq(players.id, spot.id));
    expect(p!.userId).toBe(doc.id);
  });

  it('adds an existing person to a second league, but not twice to the same one', async () => {
    const wed = await league('Wednesday League');
    const thu = await league('Thursday League');
    await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id });
    await addPerson(site, { email: 'jerry@example.com', leagueId: thu.id, role: 'admin' });
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: wed.id }).expect(409);
  });

  it('a roster spot already claimed cannot be given to someone else', async () => {
    const wed = await league('Wednesday League');
    const { body: spot } = await as(site)
      .post(`/leagues/${wed.id}/players`, { nickname: 'Doc' })
      .expect(201);
    await addPerson(site, { email: 'a@example.com', leagueId: wed.id, playerId: spot.id });
    await as(site)
      .post('/users', { email: 'b@example.com', leagueId: wed.id, playerId: spot.id })
      .expect(400);
  });
});

describe('password links', () => {
  it('lets an admin hand someone a single-use link to set their password, recording when they sign in', async () => {
    const wed = await league('Wednesday League');
    const jerry = await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id });
    const { body } = await as(site).post(`/users/${jerry.id}/password-link`).expect(201);
    expect(body.link).toMatch(/^http:\/\/localhost:4101\/set-password#token=/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 71 * 3600 * 1000);
    expect(t.outbox).toHaveLength(0);

    const token = (body.link as string).split('#token=')[1]!;
    const http = () => request(t.app.getHttpServer());
    const check = await http().post('/api/auth/password-link/check').send({ token }).expect(200);
    expect(check.body).toMatchObject({ email: 'jerry@example.com', hasPassword: false });
    // It isn't a passwordless sign-in link.
    await http().post('/api/auth/verify').send({ token }).expect(401);
    const weak = await http()
      .post('/api/auth/password-link')
      .send({ token, password: 'password1234' })
      .expect(400);
    expect(weak.body.message).toMatch(/too common/);
    await http().post('/api/auth/password-link').send({ token, password: 'short' }).expect(400);
    await http()
      .post('/api/auth/password-link')
      .send({ token, password: 'four fairways and a green' })
      .expect(200);
    await http()
      .post('/api/auth/password-link')
      .send({ token, password: 'four fairways and a green' })
      .expect(401);
    const [row] = await t.db.select().from(users).where(eq(users.id, jerry.id));
    expect(row!.lastSignInAt).not.toBeNull();
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);

    const actions = (await t.db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.password_link', 'auth.password_set']));
  });
});

describe('emailing a password link', () => {
  it('site admins email the link; the mail guard still applies', async () => {
    const wed = await league('Wednesday League');
    const allowed = await addPerson(site, { email: 'allowed@example.com', leagueId: wed.id });
    const held = await addPerson(site, { email: 'held@example.com', leagueId: wed.id });

    const { body } = await as(site).post(`/users/${allowed.id}/password-link/email`).expect(201);
    expect(body).toEqual({ sent: true, to: 'a***@example.com' });
    expect(t.outbox).toHaveLength(1);
    expect(t.outbox[0]!.to).toBe('allowed@example.com');
    const token = t.outbox[0]!.text.match(/#token=([\w-]+)/)![1]!;
    await request(t.app.getHttpServer())
      .post('/api/auth/password-link')
      .send({ token, password: 'correct horse battery' })
      .expect(200);

    // Not on the allowlist: nothing is sent and no link is made.
    expect((await as(site).post(`/users/${held.id}/password-link/email`).expect(201)).body).toEqual(
      { sent: false, to: 'h***@example.com' },
    );
    expect(t.outbox).toHaveLength(1);
  });

  it('only site admins can email links', async () => {
    const wed = await league('Wednesday League');
    const paul = await signInWithLink(
      site,
      (await addPerson(site, { email: 'paul@example.com', leagueId: wed.id, role: 'admin' })).id,
    );
    const jerry = await addPerson(site, { email: 'allowed@example.com', leagueId: wed.id });
    await as(paul).post(`/users/${jerry.id}/password-link/email`).expect(403);
    expect(t.outbox).toHaveLength(0);
  });
});

describe('who can manage whom', () => {
  it('users cannot see the people list', async () => {
    const wed = await league('Wednesday League');
    const jerry = await signInWithLink(
      site,
      (await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id })).id,
    );
    await as(jerry).get('/users').expect(403);
  });

  it('a league admin sees only people in their leagues', async () => {
    const wed = await league('Wednesday League');
    const thu = await league('Thursday League');
    const paul = await addPerson(site, {
      email: 'paul@example.com',
      leagueId: wed.id,
      role: 'admin',
    });
    await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id });
    await addPerson(site, { email: 'keith@example.com', leagueId: thu.id });
    const paulSession = await signInWithLink(site, paul.id);

    const { body } = await as(paulSession).get('/users').expect(200);
    expect(body.map((u: { email: string }) => u.email)).toEqual([
      'jerry@example.com',
      'paul@example.com',
    ]);
    const all = (await as(site).get('/users').expect(200)).body as { email: string }[];
    expect(all).toHaveLength(4);
  });

  it('a league admin can manage users but not admins or site admins', async () => {
    const wed = await league('Wednesday League');
    const paul = await signInWithLink(
      site,
      (await addPerson(site, { email: 'paul@example.com', leagueId: wed.id, role: 'admin' })).id,
    );
    // A site admin creates the account; then the league admin manages them.
    const jerry = await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id });
    const otherAdmin = await addPerson(site, {
      email: 'rich@example.com',
      leagueId: wed.id,
      role: 'admin',
    });
    const [siteUser] = await t.db.select().from(users).where(eq(users.email, 'site@example.com'));
    await as(site).post('/users', { email: 'site@example.com', leagueId: wed.id }).expect(201);

    await as(paul).post(`/users/${jerry.id}/password-link`).expect(201);
    await as(paul).patch(`/users/${jerry.id}`, { name: 'Jerry G' }).expect(200);
    await as(paul).post(`/users/${otherAdmin.id}/password-link`).expect(403);
    await as(paul).post(`/users/${siteUser!.id}/password-link`).expect(403);
    await as(paul).patch(`/users/${jerry.id}`, { disabled: true }).expect(403);
    await as(paul).patch(`/users/${jerry.id}`, { isSiteAdmin: true }).expect(403);
  });

  it('a league admin cannot touch people outside their leagues (404)', async () => {
    const wed = await league('Wednesday League');
    const thu = await league('Thursday League');
    const paul = await signInWithLink(
      site,
      (await addPerson(site, { email: 'paul@example.com', leagueId: wed.id, role: 'admin' })).id,
    );
    const keith = await addPerson(site, { email: 'keith@example.com', leagueId: thu.id });
    await as(paul).post(`/users/${keith.id}/password-link`).expect(404);
    await as(paul).post('/users', { email: 'x@example.com', leagueId: thu.id }).expect(403);
  });

  it("adding someone to your league doesn't hand you their account elsewhere", async () => {
    const wed = await league('Wednesday League');
    const thu = await league('Thursday League');
    const paul = await signInWithLink(
      site,
      (await addPerson(site, { email: 'paul@example.com', leagueId: wed.id, role: 'admin' })).id,
    );
    const keith = await addPerson(site, { email: 'keith@example.com', leagueId: thu.id });
    // Paul can add Keith to his league and manage him there...
    await as(paul).post('/users', { email: 'keith@example.com', leagueId: wed.id }).expect(201);
    await as(paul).put(`/leagues/${wed.id}/members/${keith.id}`, { role: 'user' }).expect(204);
    // ...but not his account, which is also in a league Paul doesn't run.
    await as(paul).post(`/users/${keith.id}/password-link`).expect(403);
    await as(paul).patch(`/users/${keith.id}`, { name: 'Keith K' }).expect(403);
    await as(paul).post(`/users/${keith.id}/unlock`).expect(403);
    await as(paul).post(`/users/${keith.id}/sign-out-everywhere`).expect(403);
    // Removing him from Paul's own league is still Paul's call.
    await as(paul).del(`/leagues/${wed.id}/members/${keith.id}`).expect(204);
    // A site admin can still do everything.
    await as(site).post(`/users/${keith.id}/password-link`).expect(201);
  });
});

describe('account controls', () => {
  it('disabling someone signs them out everywhere and blocks new links', async () => {
    const wed = await league('Wednesday League');
    const jerryId = (await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id })).id;
    const jerry = await signInWithLink(site, jerryId);
    await as(jerry).get('/auth/me').expect(200);
    await as(site).patch(`/users/${jerryId}`, { disabled: true }).expect(200);
    await as(jerry).get('/auth/me').expect(401);
    await as(site).post(`/users/${jerryId}/password-link`).expect(400);
    await as(site).patch(`/users/${jerryId}`, { disabled: false }).expect(200);
    await as(site).post(`/users/${jerryId}/password-link`).expect(201);
  });

  it("site admins can't disable themselves or drop their own site admin access", async () => {
    const [me] = await t.db.select().from(users).where(eq(users.email, 'site@example.com'));
    await as(site).patch(`/users/${me!.id}`, { disabled: true }).expect(400);
    await as(site).patch(`/users/${me!.id}`, { isSiteAdmin: false }).expect(400);
  });

  it('sign out everywhere revokes all sessions', async () => {
    const wed = await league('Wednesday League');
    const jerryId = (await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id })).id;
    const phone = await signInWithLink(site, jerryId);
    const laptop = await signInWithLink(site, jerryId);
    await as(site).post(`/users/${jerryId}/sign-out-everywhere`).expect(204);
    await as(phone).get('/auth/me').expect(401);
    await as(laptop).get('/auth/me').expect(401);
  });

  it('admins change roles and remove people; removal frees the roster spot', async () => {
    const wed = await league('Wednesday League');
    const { body: spot } = await as(site)
      .post(`/leagues/${wed.id}/players`, { nickname: 'Jerry' })
      .expect(201);
    const jerryId = (
      await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id, playerId: spot.id })
    ).id;
    await as(site).put(`/leagues/${wed.id}/members/${jerryId}`, { role: 'admin' }).expect(204);
    let list = (await as(site).get('/users').expect(200)).body as {
      email: string;
      leagues: { role: string }[];
    }[];
    expect(list.find((u) => u.email === 'jerry@example.com')!.leagues[0]!.role).toBe('admin');

    await as(site).del(`/leagues/${wed.id}/members/${jerryId}`).expect(204);
    list = (await as(site).get('/users').expect(200)).body;
    expect(list.find((u) => u.email === 'jerry@example.com')!.leagues).toEqual([]);
    const [p] = await t.db.select().from(players).where(eq(players.id, spot.id));
    expect(p!.userId).toBeNull();
  });
});

describe('league settings', () => {
  it('returns default rules and lets an admin change them (audited); users can read but not change', async () => {
    const wed = await league('Wednesday League');
    const { body } = await as(site).get(`/leagues/${wed.id}`).expect(200);
    expect(body.settings.points).toEqual({ win: 3, tie: 1, loss: 0 });
    expect(body.settings.nines).toBe('alternate');

    const settings = {
      ...body.settings,
      points: { win: 2, tie: 1, loss: 0 },
      playoffs: { format: 'knockout', tiebreak: 'par5s_first' },
    };
    const updated = await as(site)
      .patch(`/leagues/${wed.id}`, { name: 'Wednesday Night League', settings })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: 'Wednesday Night League',
      settings: { points: { win: 2 } },
    });
    const entry = (await t.db.select().from(auditLog)).find((r) => r.action === 'league.update');
    expect(entry!.before).toMatchObject({ settings: { points: { win: 3 } } });

    const jerry = await signInWithLink(
      site,
      (await addPerson(site, { email: 'jerry@example.com', leagueId: wed.id })).id,
    );
    expect((await as(jerry).get(`/leagues/${wed.id}`).expect(200)).body.settings.points.win).toBe(
      2,
    );
    await as(jerry).patch(`/leagues/${wed.id}`, { name: 'Mine' }).expect(403);
  });

  it('rejects invalid rules', async () => {
    const wed = await league('Wednesday League');
    const { body } = await as(site).get(`/leagues/${wed.id}`).expect(200);
    await as(site)
      .patch(`/leagues/${wed.id}`, {
        settings: { ...body.settings, teeTimes: { firstTeeTime: '25:00', intervalMinutes: 9 } },
      })
      .expect(400);
    await as(site)
      .patch(`/leagues/${wed.id}`, { settings: { ...body.settings, nines: 'middle' } })
      .expect(400);
  });
});

describe('people and league members', () => {
  it('site admins add people with no league; league admins add existing people to their league', async () => {
    const wed = await league('Wednesday League');
    const { body: doc } = await as(site)
      .post(`/leagues/${wed.id}/players`, { nickname: 'Doc' })
      .expect(201);
    const paul = await signInWithLink(
      site,
      (await addPerson(site, { email: 'paul@example.com', leagueId: wed.id, role: 'admin' })).id,
    );

    // A person can exist without a league.
    const sam = await addPerson(site, { email: 'sam@example.com', name: 'Sam Example' });
    await as(site).post('/users', { email: 'sam@example.com' }).expect(409);
    const me = signInWithLink(site, sam.id);
    expect((await (await me).agent.get('/api/auth/me').expect(200)).body.leagues).toEqual([]);

    // League admins can't create accounts, or add anyone outside a league.
    const res = await as(paul)
      .post('/users', { email: 'new@example.com', leagueId: wed.id })
      .expect(403);
    expect(res.body.message).toMatch(/site admin adds new people/);
    await as(paul).post('/users', { email: 'sam@example.com' }).expect(403);

    // They pick existing people from the directory and add them, as a new player...
    const dir = (await as(paul).get('/users/directory').expect(200)).body;
    expect(dir.map((d: { email: string }) => d.email)).toContain('sam@example.com');
    await as(paul)
      .post('/users', { email: 'sam@example.com', leagueId: wed.id, newPlayer: {} })
      .expect(201);
    // ...or linked to an existing player, or as a member who doesn't play.
    const jerry = await addPerson(site, { email: 'jerry@example.com' });
    await as(paul)
      .post('/users', { email: 'jerry@example.com', leagueId: wed.id, playerId: doc.id })
      .expect(201);
    await addPerson(site, { email: 'helper@example.com' });
    await as(paul).post('/users', { email: 'helper@example.com', leagueId: wed.id }).expect(201);

    const roster = (await as(paul).get(`/leagues/${wed.id}/members`).expect(200)).body;
    const byNick = Object.fromEntries(
      roster.players.map((p: { nickname: string; userId: string | null }) => [
        p.nickname,
        p.userId,
      ]),
    );
    expect(byNick['Sam']).toBe(sam.id);
    expect(byNick['Doc']).toBe(jerry.id);
    expect(roster.members.map((m: { email: string }) => m.email)).toContain('helper@example.com');
    expect(roster.players).toHaveLength(2);

    // Plain users can't see the directory.
    const samSignedIn = await signInWithLink(site, sam.id);
    await as(samSignedIn).get('/users/directory').expect(403);
  });
});

describe('league visibility', () => {
  it('private leagues are members-only; public ones can be viewed (not changed) by anyone signed in', async () => {
    const wed = await league('Wednesday League');
    await addPerson(site, { email: 'member@example.com', leagueId: wed.id });
    await as(site).patch(
      '/users/' + (await addPerson(site, { email: 'outsider@example.com' })).id,
      {
        phone: '860-555-0100',
      },
    );
    const people = (await as(site).get('/users').expect(200)).body;
    const outsiderId = people.find((p: { email: string }) => p.email === 'outsider@example.com').id;
    const memberId = people.find((p: { email: string }) => p.email === 'member@example.com').id;
    await as(site).patch(`/users/${memberId}`, { phone: '860-555-0199' }).expect(200);
    const outsider = await signInWithLink(site, outsiderId);

    expect((await as(site).get(`/leagues/${wed.id}`).expect(200)).body.visibility).toBe('private');
    await as(outsider).get(`/leagues/${wed.id}`).expect(404);
    expect((await as(outsider).get('/leagues').expect(200)).body).toEqual([]);

    await as(site).patch(`/leagues/${wed.id}`, { visibility: 'public' }).expect(200);
    const view = (await as(outsider).get(`/leagues/${wed.id}`).expect(200)).body;
    expect(view.role).toBe('viewer');
    expect((await as(outsider).get('/leagues').expect(200)).body).toEqual([
      expect.objectContaining({ id: wed.id, role: 'viewer' }),
    ]);
    // Names, but no contact details.
    const members = (await as(outsider).get(`/leagues/${wed.id}/members`).expect(200)).body.members;
    expect(JSON.stringify(members)).not.toContain('860');
    expect(JSON.stringify(members)).not.toContain('member@example.com');
    // Read-only.
    await as(outsider).post(`/leagues/${wed.id}/announcements`, { title: 'Hi' }).expect(403);
    await as(outsider).patch(`/leagues/${wed.id}`, { visibility: 'private' }).expect(403);

    await as(site).patch(`/leagues/${wed.id}`, { visibility: 'private' }).expect(200);
    await as(outsider).get(`/leagues/${wed.id}`).expect(404);
  });
});
