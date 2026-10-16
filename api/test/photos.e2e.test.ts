import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
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
  dir = await mkdtemp(join(tmpdir(), 'teemate-photos-'));
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
  delete: (path: string) => who.agent.delete(`/api${path}`).set('X-CSRF-Token', who.csrf),
  upload: (path: string, file: Buffer, fields: Record<string, string> = {}) => {
    let r = who.agent.post(`/api${path}`).set('X-CSRF-Token', who.csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', file, 'IMG_0001.jpg');
  },
});

/** A 3000×2000 JPEG carrying EXIF metadata, like a phone photo. */
const phonePhoto = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#2f7a4d' } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'Someone', ImageDescription: 'Timberlin 7th green' } })
    .toBuffer();

describe('match photos', () => {
  it('members upload; photos are resized, stripped of metadata and served only to members', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Photo League' }).expect(201);
    const L = league.id as string;
    for (const email of ['a@example.com', 'b@example.com'])
      await as(site).post('/users', { email, leagueId: L }).expect(201);
    await createUser(t.db, 'out@example.com');
    const a = await signIn(t, 'a@example.com');
    const b = await signIn(t, 'b@example.com');
    const outsider = await signIn(t, 'out@example.com');

    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const { body: photo } = await as(a)
      .upload(`/leagues/${L}/photos`, original, { caption: 'Birdie on 7' })
      .expect(201);
    expect(photo).toMatchObject({
      caption: 'Birdie on 7',
      width: 2048,
      height: 1365,
      canDelete: true,
    });

    const full = await as(b).get(`/leagues/${L}/photos/${photo.id}/full`).expect(200);
    expect(full.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(full.body as Buffer).metadata();
    expect(meta).toMatchObject({ width: 2048, height: 1365 });
    expect(meta.exif).toBeUndefined();
    const thumb = await as(b).get(`/leagues/${L}/photos/${photo.id}/thumb`).expect(200);
    expect(await sharp(thumb.body as Buffer).metadata()).toMatchObject({ width: 480, height: 480 });

    // Not for outsiders or anyone signed out.
    await as(outsider).get(`/leagues/${L}/photos`).expect(404);
    await as(outsider).get(`/leagues/${L}/photos/${photo.id}/full`).expect(404);
    await request(t.app.getHttpServer())
      .get(`/api/leagues/${L}/photos/${photo.id}/full`)
      .expect(401);

    // Anything that isn't an image is refused.
    await as(a)
      .upload(`/leagues/${L}/photos`, Buffer.from('<script>alert(1)</script>'))
      .expect(400);
    await as(a).post(`/leagues/${L}/photos`).expect(400);

    const list = (await as(b).get(`/leagues/${L}/photos`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: photo.id, canDelete: false });
    await as(b).delete(`/leagues/${L}/photos/${photo.id}`).expect(403);
    await as(a).delete(`/leagues/${L}/photos/${photo.id}`).expect(200);
    expect(await readdir(join(dir, L))).toEqual([]);
    await as(b).get(`/leagues/${L}/photos/${photo.id}/full`).expect(404);
  });

  it('links a photo to a foursome in the same league only', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Photo League' }).expect(201);
    const L = league.id as string;
    const missing = '00000000-0000-4000-8000-000000000000';
    await as(site)
      .upload(`/leagues/${L}/photos`, await phonePhoto(), { groupId: missing })
      .expect(404);
  });
});

describe('season photos', () => {
  it('a team photo belongs to a season and lists with that season', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Photo League' }).expect(201);
    const L = league.id as string;
    for (const nickname of ['A', 'B', 'C', 'D'])
      await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201);
    const { body: s24 } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2024', startDate: '2024-04-17' })
      .expect(201);
    const { body: s25 } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2025', startDate: '2025-04-16' })
      .expect(201);
    const pic = await phonePhoto();
    for (const s of [s24, s25])
      await as(site)
        .upload(`/leagues/${L}/photos`, pic, { seasonId: s.id, caption: 'The 2024 team' })
        .expect(201);

    const list = (await as(site).get(`/leagues/${L}/photos?seasonId=${s24.id}`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      teamPhoto: true,
      seasonId: s24.id,
      seasonName: '2024',
      caption: 'The 2024 team',
    });
    expect((await as(site).get(`/leagues/${L}/photos`).expect(200)).body).toHaveLength(2);

    // Choose the season's photo; a photo from another league can't be used.
    const put = (path: string, body: object) =>
      site.agent.put(`/api${path}`).set('X-CSRF-Token', site.csrf).send(body);
    await put(`/leagues/${L}/seasons/${s24.id}/cover`, { photoId: list[0].id }).expect(200);
    let season = (await as(site).get(`/leagues/${L}/seasons/${s24.id}`).expect(200)).body;
    expect(season.season.coverPhotoId).toBe(list[0].id);
    await put(`/leagues/${L}/seasons/${s24.id}/cover`, { photoId: null }).expect(200);
    season = (await as(site).get(`/leagues/${L}/seasons/${s24.id}`).expect(200)).body;
    expect(season.season.coverPhotoId).toBeNull();

    const { body: other } = await as(site).post('/leagues', { name: 'Other' }).expect(201);
    await as(site).post(`/leagues/${other.id}/players`, { nickname: 'X' }).expect(201);
    await as(site).upload(`/leagues/${other.id}/photos`, pic, { seasonId: s24.id }).expect(404);
  });
});
