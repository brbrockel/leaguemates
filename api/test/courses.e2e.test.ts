import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
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

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'leaguemates-courses-'));
  t = await createTestApp({ PHOTOS_DIR: dir });
});
afterAll(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb(t.db);
  await createUser(t.db, 'site@example.com', true);
  site = await signIn(t, 'site@example.com');
});

const as = (who: SignedIn) => ({
  get: (path: string) => who.agent.get(`/api${path}`),
  post: (path: string, body: object = {}) =>
    who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  put: (path: string, body: object) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  delete: (path: string) => who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf),
});

const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4];
const SI = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const nine = (yards: number | null = null, pars = PARS) =>
  pars.map((par, i) => ({ number: i + 1, par, strokeIndex: SI[i]!, yards }));

interface LayoutView {
  id: string;
  name: string;
  par: number;
  yards: number | null;
  cards: number;
  retiredAt: string | null;
}

async function courseWithNine() {
  const { body: course } = await as(site)
    .post('/courses', { name: 'Test Links', city: 'Berlin', state: 'CT' })
    .expect(201);
  const { body } = await as(site)
    .post(`/courses/${course.id}/layouts`, { name: 'Front 9', tees: 'White', holes: nine() })
    .expect(201);
  return { courseId: course.id as string, layoutId: body.layoutId as string };
}

describe('courses', () => {
  it('anyone signed in can view; only site admins edit', async () => {
    await createUser(t.db, 'user@example.com');
    const user = await signIn(t, 'user@example.com');
    const { body } = await as(user).get('/courses').expect(200);
    expect(body.map((c: { name: string }) => c.name)).toEqual(['Timberlin Golf Club']);
    await as(user).post('/courses', { name: 'Nope' }).expect(403);
  });

  it('adds a course and a nine, and checks the holes', async () => {
    const { courseId } = await courseWithNine();
    const course = (await as(site).get(`/courses/${courseId}`).expect(200)).body;
    expect(course).toMatchObject({ name: 'Test Links', city: 'Berlin' });
    expect(course.layouts[0]).toMatchObject({
      name: 'Front 9',
      tees: 'White',
      par: 36,
      yards: null,
      cards: 0,
    });

    const dupSi = nine().map((h, i) => (i === 1 ? { ...h, strokeIndex: 1 } : h));
    await as(site)
      .post(`/courses/${courseId}/layouts`, { name: 'Bad', tees: 'White', holes: dupSi })
      .expect(400);
    await as(site)
      .post(`/courses/${courseId}/layouts`, {
        name: 'Short',
        tees: 'White',
        holes: nine().slice(0, 8),
      })
      .expect(400);
  });

  it('locks par and stroke index once a card uses a nine; a new version takes its place', async () => {
    const { courseId, layoutId } = await courseWithNine();
    // A 4-player league playing this course, with one card entered.
    const { body: league } = await as(site).post('/leagues', { name: 'Course Test' }).expect(201);
    const L = league.id as string;
    for (const nickname of ['A', 'B', 'C', 'D']) {
      const { body: p } = await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201);
      await as(site).patch(`/leagues/${L}/players/${p.id}`, { handicap: 5 }).expect(200);
    }
    const { body: season } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21', courseId })
      .expect(201);
    const S = season.id as string;
    const { body: sched } = await as(site)
      .post(`/leagues/${L}/seasons/${S}/generate`, { seed: 1 })
      .expect(201);
    await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
    const week = sched.weeks[0];
    const group = week.groups[0];
    const players = group.matches.flatMap((m: { playerA: string; playerB: string }) => [
      m.playerA,
      m.playerB,
    ]);
    await as(site)
      .put(`/leagues/${L}/seasons/${S}/weeks/${week.id}/groups/${group.id}/scorecard`, {
        layoutId,
        rounds: players.map((playerId: string) => ({
          playerId,
          attendance: 'played',
          holeScores: PARS,
        })),
      })
      .expect(200);

    // Yardages and names can still change.
    let course = (
      await as(site)
        .put(`/courses/${courseId}/layouts/${layoutId}`, {
          name: 'Front Nine',
          tees: 'White',
          holes: nine(300),
        })
        .expect(200)
    ).body;
    expect(course.layouts[0]).toMatchObject({ name: 'Front Nine', yards: 2700, cards: 1 });

    // Par can't.
    const changed = nine(300, [5, ...PARS.slice(1)]);
    const res = await as(site)
      .put(`/courses/${courseId}/layouts/${layoutId}`, {
        name: 'Front Nine',
        tees: 'White',
        holes: changed,
      })
      .expect(409);
    expect(res.body.message).toMatch(/new version/);
    await as(site).delete(`/courses/${courseId}/layouts/${layoutId}`).expect(409);

    // A new version replaces it on weeks not played yet; the card keeps the old one.
    const { body: v2 } = await as(site)
      .post(`/courses/${courseId}/layouts`, {
        name: 'Front Nine',
        tees: 'White',
        holes: changed,
        replaces: layoutId,
      })
      .expect(201);
    course = v2.course;
    const [old, next] = [layoutId, v2.layoutId].map((id) =>
      course.layouts.find((l: LayoutView) => l.id === id),
    );
    expect(old.retiredAt).not.toBeNull();
    expect(next).toMatchObject({ retiredAt: null, par: 37, cards: 0 });
    const after = (await as(site).get(`/leagues/${L}/seasons/${S}`).expect(200)).body;
    expect(after.weeks.every((w: { layoutId: string }) => w.layoutId === v2.layoutId)).toBe(true);
    const card = (
      await as(site)
        .get(`/leagues/${L}/seasons/${S}/weeks/${week.id}/groups/${group.id}/scorecard`)
        .expect(200)
    ).body;
    expect(card.card.layoutId).toBe(layoutId);

    // Replacing it twice is refused; a layout nothing uses can be deleted.
    await as(site)
      .post(`/courses/${courseId}/layouts`, {
        name: 'X',
        tees: 'White',
        holes: nine(),
        replaces: layoutId,
      })
      .expect(409);
    const { body: spare } = await as(site)
      .post(`/courses/${courseId}/layouts`, { name: 'Spare', tees: 'Red', holes: nine() })
      .expect(201);
    course = (await as(site).delete(`/courses/${courseId}/layouts/${spare.layoutId}`).expect(200))
      .body;
    expect(course.layouts.map((l: LayoutView) => l.name)).not.toContain('Spare');

    const log = (await as(site).get('/audit?action=layout.replace').expect(200)).body;
    expect(log.entries).toHaveLength(1);
  });
});

describe('scorecard images', () => {
  it('site admins add pictures of the card; anyone signed in can view them', async () => {
    const { courseId } = await courseWithNine();
    await createUser(t.db, 'user@example.com');
    const user = await signIn(t, 'user@example.com');
    const card = await sharp({
      create: { width: 1000, height: 370, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const upload = (who: SignedIn) =>
      who.agent
        .post(`/api/courses/${courseId}/images`)
        .set('X-CSRF-Token', who.csrf)
        .field('caption', 'Front nine')
        .attach('file', card, 'scorecard.jpg');

    await upload(user).expect(403);
    const course = (await upload(site).expect(201)).body;
    expect(course.images).toEqual([
      expect.objectContaining({ caption: 'Front nine', width: 1000, height: 370 }),
    ]);
    const img = course.images[0].id as string;
    const res = await as(user).get(`/courses/${courseId}/images/${img}`).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    await as(user).delete(`/courses/${courseId}/images/${img}`).expect(403);
    const after = (await as(site).delete(`/courses/${courseId}/images/${img}`).expect(200)).body;
    expect(after.images).toEqual([]);
    await as(user).get(`/courses/${courseId}/images/${img}`).expect(404);
  });
});

describe('course card templates', () => {
  const grid = {
    rows: [
      [0.2, 0.4],
      [0.2, 0.45],
      [0.2, 0.6],
      [0.2, 0.65],
    ],
    last: [0.6, 0.4],
    total: [0.65, 0.4],
    name: null,
  };

  it('site admins mark where scores go on a card picture; new versions keep it', async () => {
    const { courseId, layoutId } = await courseWithNine();
    await createUser(t.db, 'user@example.com');
    const user = await signIn(t, 'user@example.com');
    const card = await sharp({
      create: { width: 900, height: 340, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const imageId = (
      await site.agent
        .post(`/api/courses/${courseId}/images`)
        .set('X-CSRF-Token', site.csrf)
        .attach('file', card, 'card.jpg')
        .expect(201)
    ).body.images[0].id as string;
    const path = `/courses/${courseId}/layouts/${layoutId}/card-grid`;

    await as(user).put(path, { imageId, grid }).expect(403);
    await as(site)
      .put(path, { imageId, grid: { ...grid, last: [1.2, 0.4] } })
      .expect(400);
    const { courseId: otherCourse } = await courseWithNine();
    const otherImage = (
      await site.agent
        .post(`/api/courses/${otherCourse}/images`)
        .set('X-CSRF-Token', site.csrf)
        .attach('file', card, 'card.jpg')
        .expect(201)
    ).body.images[0].id as string;
    await as(site).put(path, { imageId: otherImage, grid }).expect(400);

    const course = (await as(site).put(path, { imageId, grid }).expect(200)).body;
    expect(course.layouts[0].cardGrid).toEqual({ imageId, grid });

    // A new version of the nine is on the same printed card.
    const { body: replaced } = await as(site)
      .post(`/courses/${courseId}/layouts`, {
        name: 'Front 9',
        tees: 'White',
        holes: nine(),
        replaces: layoutId,
      })
      .expect(201);
    const v2 = replaced.course.layouts.find((l: { id: string }) => l.id === replaced.layoutId);
    expect(v2.cardGrid).toEqual({ imageId, grid });

    await as(site)
      .delete(`/courses/${courseId}/layouts/${replaced.layoutId}/card-grid`)
      .expect(200);
    // Removing the picture removes what was marked on it.
    await as(site).delete(`/courses/${courseId}/images/${imageId}`).expect(200);
    const after = (await as(site).get(`/courses/${courseId}`).expect(200)).body;
    expect(after.layouts.map((l: { cardGrid: unknown }) => l.cardGrid)).toEqual([null, null]);
  });

  it('a fold-over panel takes its names from another nine with a name column', async () => {
    const { courseId, layoutId: front } = await courseWithNine();
    const back = (
      await as(site)
        .post(`/courses/${courseId}/layouts`, {
          name: 'Back 9',
          tees: 'White',
          holes: nine().map((h) => ({ ...h, number: h.number + 9 })),
        })
        .expect(201)
    ).body.layoutId as string;
    const card = await sharp({
      create: { width: 900, height: 340, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const imageId = (
      await site.agent
        .post(`/api/courses/${courseId}/images`)
        .set('X-CSRF-Token', site.csrf)
        .attach('file', card, 'card.jpg')
        .expect(201)
    ).body.images[0].id as string;
    const put = (layout: string, g: object) =>
      as(site).put(`/courses/${courseId}/layouts/${layout}/card-grid`, {
        imageId,
        grid: { ...grid, ...g },
      });

    // The front has no marks yet, so it can't lend its names.
    await put(back, { nameFrom: front }).expect(400);
    await put(front, { name: null }).expect(200);
    await put(back, { nameFrom: front }).expect(400); // no name column marked
    await put(front, { name: [0.05, 0.4] }).expect(200);
    await put(back, { nameFrom: back }).expect(400);
    await put(back, { nameFrom: front }).expect(200);
    // A panel that folds over another can't lend names itself.
    await put(front, { name: [0.05, 0.4], nameFrom: back }).expect(400);

    // A new version of the front nine keeps lending its names.
    const { body: v2 } = await as(site)
      .post(`/courses/${courseId}/layouts`, {
        name: 'Front 9',
        tees: 'White',
        holes: nine(),
        replaces: front,
      })
      .expect(201);
    const backView = v2.course.layouts.find((l: { id: string }) => l.id === back);
    expect(backView.cardGrid.grid.nameFrom).toBe(v2.layoutId);
  });
});

describe('default course', () => {
  it('is listed first, and pinning another course moves the default', async () => {
    const pinned = async () =>
      ((await as(site).get('/courses').expect(200)).body as { name: string; pinned: boolean }[])
        .filter((c) => c.pinned)
        .map((c) => c.name);
    const list = (await as(site).get('/courses').expect(200)).body;
    const timberlin = list[0];
    await as(site)
      .patch(`/courses/${timberlin.id}`, { name: timberlin.name, pinned: true })
      .expect(200);
    const { body: other } = await as(site)
      .post('/courses', { name: 'Another Course', pinned: true })
      .expect(201);
    expect(await pinned()).toEqual(['Another Course']);
    expect((await as(site).get('/courses').expect(200)).body[0].id).toBe(other.id);
    // Put Timberlin back as the default for the other tests.
    await as(site)
      .patch(`/courses/${timberlin.id}`, {
        name: timberlin.name,
        city: 'Berlin',
        state: 'CT',
        pinned: true,
      })
      .expect(200);
    expect(await pinned()).toEqual(['Timberlin Golf Club']);
  });
});
