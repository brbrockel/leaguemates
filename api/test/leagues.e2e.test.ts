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
let admin: SignedIn;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.outbox.length = 0;
  await createUser(t.db, 'admin@example.com', true);
  admin = await signIn(t, 'admin@example.com');
});

async function createLeague(name: string) {
  const res = await admin.agent
    .post('/api/leagues')
    .set('X-CSRF-Token', admin.csrf)
    .send({ name })
    .expect(201);
  return res.body as { id: string; slug: string };
}

async function inviteAndJoin(leagueId: string, email: string, role: 'user' | 'admin' = 'user') {
  await admin.agent
    .post(`/api/leagues/${leagueId}/invites`)
    .set('X-CSRF-Token', admin.csrf)
    .send({ email, role })
    .expect(201);
  return signIn(t, email);
}

describe('leagues', () => {
  it('only site admins can create leagues', async () => {
    const league = await createLeague('Wednesday League');
    expect(league.slug).toBe('wednesday-league');
    const player = await inviteAndJoin(league.id, 'jerry@example.com');
    await player.agent
      .post('/api/leagues')
      .set('X-CSRF-Token', player.csrf)
      .send({ name: 'Mine' })
      .expect(403);
  });

  it('rejects a duplicate slug', async () => {
    await createLeague('Wednesday League');
    await admin.agent
      .post('/api/leagues')
      .set('X-CSRF-Token', admin.csrf)
      .send({ name: 'Wednesday League' })
      .expect(409);
  });
});

describe('invites', () => {
  it('an invite lets a new person sign in, join the league and claim their roster spot', async () => {
    const league = await createLeague('Wednesday League');
    const { body: player } = await admin.agent
      .post(`/api/leagues/${league.id}/players`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ nickname: 'Richie Jr' })
      .expect(201);
    await admin.agent
      .post(`/api/leagues/${league.id}/invites`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ email: 'Richie@Example.com', playerId: player.id })
      .expect(201);
    expect(t.outbox.at(-1)).toMatchObject({
      to: 'richie@example.com',
      subject: expect.stringContaining('Wednesday League'),
    });

    const richie = await signIn(t, 'richie@example.com');
    const me = await richie.agent.get('/api/auth/me').expect(200);
    expect(me.body.leagues).toEqual([
      { id: league.id, name: 'Wednesday League', slug: 'wednesday-league', role: 'user' },
    ]);

    const [user] = await t.db.select().from(users).where(eq(users.email, 'richie@example.com'));
    const [spot] = await t.db.select().from(players).where(eq(players.id, player.id));
    expect(spot!.userId).toBe(user!.id);

    const invites = await admin.agent.get(`/api/leagues/${league.id}/invites`).expect(200);
    expect(invites.body).toEqual([]);
  });

  it('a revoked invite no longer allows sign-in', async () => {
    const league = await createLeague('Wednesday League');
    const { body: invite } = await admin.agent
      .post(`/api/leagues/${league.id}/invites`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ email: 'todd@example.com' })
      .expect(201);
    await admin.agent
      .delete(`/api/leagues/${league.id}/invites/${invite.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    t.outbox.length = 0;
    await request(t.app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'todd@example.com' })
      .expect(202);
    expect(t.outbox).toHaveLength(0);
  });

  it('rejects inviting someone twice or inviting an existing member', async () => {
    const league = await createLeague('Wednesday League');
    const send = (email: string) =>
      admin.agent
        .post(`/api/leagues/${league.id}/invites`)
        .set('X-CSRF-Token', admin.csrf)
        .send({ email });
    await send('doc@example.com').expect(201);
    await send('doc@example.com').expect(409);
    await signIn(t, 'doc@example.com');
    await send('doc@example.com').expect(409);
  });

  it('only admins can invite', async () => {
    const league = await createLeague('Wednesday League');
    const player = await inviteAndJoin(league.id, 'jerry@example.com');
    await player.agent
      .post(`/api/leagues/${league.id}/invites`)
      .set('X-CSRF-Token', player.csrf)
      .send({ email: 'friend@example.com' })
      .expect(403);
    const commish = await inviteAndJoin(league.id, 'paul@example.com', 'admin');
    await commish.agent
      .post(`/api/leagues/${league.id}/invites`)
      .set('X-CSRF-Token', commish.csrf)
      .send({ email: 'friend@example.com' })
      .expect(201);
  });
});

describe('league isolation', () => {
  it('members of one league get 404 for another league', async () => {
    const a = await createLeague('Wednesday League');
    const b = await createLeague('Thursday League');
    const jerry = await inviteAndJoin(a.id, 'jerry@example.com');

    await jerry.agent.get(`/api/leagues/${a.id}`).expect(200);
    await jerry.agent.get(`/api/leagues/${b.id}`).expect(404);
    await jerry.agent.get(`/api/leagues/${b.id}/members`).expect(404);
    await jerry.agent
      .post(`/api/leagues/${b.id}/invites`)
      .set('X-CSRF-Token', jerry.csrf)
      .send({ email: 'x@example.com' })
      .expect(404);
    await jerry.agent.get('/api/leagues/not-a-uuid').expect(404);

    const mine = await jerry.agent.get('/api/leagues').expect(200);
    expect(mine.body.map((l: { id: string }) => l.id)).toEqual([a.id]);
  });

  it('a roster spot from another league cannot be attached to an invite', async () => {
    const a = await createLeague('Wednesday League');
    const b = await createLeague('Thursday League');
    const { body: spot } = await admin.agent
      .post(`/api/leagues/${b.id}/players`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ nickname: 'Keith' })
      .expect(201);
    await admin.agent
      .post(`/api/leagues/${a.id}/invites`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ email: 'keith@example.com', playerId: spot.id })
      .expect(404);
  });
});

describe('audit log', () => {
  it('records league creation, invites and acceptance', async () => {
    const league = await createLeague('Wednesday League');
    await inviteAndJoin(league.id, 'jerry@example.com');
    const actions = (await t.db.select().from(auditLog))
      .map((r) => r.action)
      .filter((a) => !a.startsWith('auth.')); // sign-ins are logged too
    expect(actions).toEqual(['league.create', 'invite.create', 'invite.accept']);
  });
});

describe('roster names', () => {
  const add = (leagueId: string, body: object) =>
    admin.agent.post(`/api/leagues/${leagueId}/players`).set('X-CSRF-Token', admin.csrf).send(body);
  const roster = async (leagueId: string) =>
    (await admin.agent.get(`/api/leagues/${leagueId}/members`).expect(200)).body.players as {
      id: string;
      nickname: string;
      fullName: string | null;
    }[];

  it('stores a nickname with an optional full name', async () => {
    const league = await createLeague('Wednesday League');
    await add(league.id, { nickname: 'Doc', fullName: 'Sam Example' }).expect(201);
    await add(league.id, { nickname: 'Mike B' }).expect(201);
    expect((await roster(league.id)).map((p) => [p.nickname, p.fullName])).toEqual([
      ['Doc', 'Sam Example'],
      ['Mike B', null],
    ]);
  });

  it('defaults the nickname to first name and last initial', async () => {
    const league = await createLeague('Wednesday League');
    const { body } = await add(league.id, { fullName: '  Pat   Sample ' }).expect(201);
    expect(body).toMatchObject({ nickname: 'Pat S', fullName: 'Pat   Sample' });
  });

  it('needs a nickname or a full name', async () => {
    const league = await createLeague('Wednesday League');
    await add(league.id, {}).expect(400);
    await add(league.id, { nickname: '   ' }).expect(400);
  });

  it('nicknames are unique per league, ignoring case, and the error suggests a fix', async () => {
    const league = await createLeague('Wednesday League');
    await add(league.id, { nickname: 'Mike' }).expect(201);
    const res = await add(league.id, { nickname: 'mike' }).expect(409);
    expect(res.body.message).toMatch(/last initial/);
    const other = await createLeague('Thursday League');
    await add(other.id, { nickname: 'Mike' }).expect(201);
  });

  it('admins can fix names; the change is audited', async () => {
    const league = await createLeague('Wednesday League');
    const { body: doc } = await add(league.id, { nickname: 'Doc', fullName: 'Sam Exampel' }).expect(
      201,
    );
    const edit = (body: object) =>
      admin.agent
        .patch(`/api/leagues/${league.id}/players/${doc.id}`)
        .set('X-CSRF-Token', admin.csrf)
        .send(body);
    await edit({ fullName: 'Sam Example' }).expect(200);
    await edit({ nickname: 'Doc R' }).expect(200);
    expect((await roster(league.id))[0]).toMatchObject({
      nickname: 'Doc R',
      fullName: 'Sam Example',
    });
    await edit({ fullName: '' }).expect(200);
    expect((await roster(league.id))[0]!.fullName).toBeNull();

    const updates = (await t.db.select().from(auditLog)).filter(
      (r) => r.action === 'player.update',
    );
    expect(updates).toHaveLength(3);
    expect(updates[0]!.before).toMatchObject({ fullName: 'Sam Exampel' });
  });

  it('players cannot edit names, and other leagues get 404', async () => {
    const league = await createLeague('Wednesday League');
    const other = await createLeague('Thursday League');
    const { body: doc } = await add(league.id, { nickname: 'Doc' }).expect(201);
    const jerry = await inviteAndJoin(league.id, 'jerry@example.com');
    await jerry.agent
      .patch(`/api/leagues/${league.id}/players/${doc.id}`)
      .set('X-CSRF-Token', jerry.csrf)
      .send({ nickname: 'Docky' })
      .expect(403);
    await admin.agent
      .patch(`/api/leagues/${other.id}/players/${doc.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ nickname: 'Docky' })
      .expect(404);
  });
});

describe('player directory', () => {
  const add = (leagueId: string, nickname: string) =>
    admin.agent
      .post(`/api/leagues/${leagueId}/players`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ nickname })
      .expect(201)
      .then((r) => r.body as { id: string });
  const list = async (leagueId: string) =>
    (
      (await admin.agent.get(`/api/leagues/${leagueId}/members`).expect(200)).body.players as {
        nickname: string;
        active: boolean;
      }[]
    ).map((p) => `${p.nickname}${p.active ? '' : ' (past)'}`);

  it('lists current players alphabetically, then past players', async () => {
    const league = await createLeague('Wednesday League');
    const joe = await add(league.id, 'Joe');
    for (const n of ['Richie Jr', 'Jerry', 'Paul']) await add(league.id, n);
    await admin.agent
      .patch(`/api/leagues/${league.id}/players/${joe.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ active: false })
      .expect(200);
    expect(await list(league.id)).toEqual(['Jerry', 'Paul', 'Richie Jr', 'Joe (past)']);
  });
});
