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
  dir = await mkdtemp(join(tmpdir(), 'teemate-scan-'));
  // No ANTHROPIC_API_KEY: the local OCR fallback reads the card.
  t = await createTestApp({ PHOTOS_DIR: dir, ANTHROPIC_API_KEY: undefined });
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
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

/** A clear typed "card": each player's name and nine scores on a line. */
const cardImage = (rows: [string, number[]][]) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${80 + rows.length * 70}"><rect width="100%" height="100%" fill="white"/>` +
        rows
          .map(
            ([name, s], i) =>
              `<text x="20" y="${80 + i * 70}" font-size="40" font-family="Arial">${name}   ${s.join('   ')}</text>`,
          )
          .join('') +
        '</svg>',
    ),
  )
    .jpeg()
    .toBuffer();

describe('scanning a scorecard photo', () => {
  it('stores the photo with the season cards and suggests scores matched to the foursome', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Scan League' }).expect(201);
    const L = league.id as string;
    const names = ['Jerry', 'Keith', 'Paul', 'Doc'];
    const ids: Record<string, string> = {};
    for (const nickname of names) {
      ids[nickname] = (
        await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201)
      ).body.id;
      await as(site).patch(`/leagues/${L}/players/${ids[nickname]}`, { handicap: 8 }).expect(200);
    }
    const { body: season } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const S = season.id as string;
    const { body: sched } = await as(site)
      .post(`/leagues/${L}/seasons/${S}/generate`, { seed: 1 })
      .expect(201);
    await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
    const week = sched.weeks[0];
    const group = week.groups[0];
    const path = `/leagues/${L}/seasons/${S}/weeks/${week.id}/groups/${group.id}/scorecard`;

    const scores: Record<string, number[]> = {
      Jerry: [5, 4, 4, 3, 5, 6, 3, 4, 5],
      Keith: [6, 5, 5, 4, 4, 7, 4, 5, 6],
    };
    const image = await cardImage(Object.entries(scores));
    const res = await site.agent
      .post(`/api${path}/scan`)
      .set('X-CSRF-Token', site.csrf)
      .attach('file', image, 'card.jpg')
      .expect(201);
    const { reading, photo } = res.body;
    expect(reading.provider).toBe('ocr');
    expect(reading.notes[0]).toMatch(/basic text recognition/i);
    for (const [name, s] of Object.entries(scores)) {
      const row = reading.rows.find((r: { playerId: string }) => r.playerId === ids[name]);
      expect(row?.holeScores).toEqual(s);
    }
    // Nothing saved to the card yet.
    expect((await as(site).get(path).expect(200)).body.card).toBeNull();

    // The photo is in the season's card album, not the regular photos.
    expect(photo.kind).toBe('card');
    const cards = (await as(site).get(`/leagues/${L}/photos?kind=card&seasonId=${S}`).expect(200))
      .body;
    expect(cards.map((p: { id: string }) => p.id)).toEqual([photo.id]);
    expect((await as(site).get(`/leagues/${L}/photos`).expect(200)).body).toEqual([]);

    // Someone outside the foursome can't scan it.
    await createUser(t.db, 'other@example.com');
    await as(site).post('/users', { email: 'other@example.com', leagueId: L }).expect(201);
    const other = await signIn(t, 'other@example.com');
    await other.agent
      .post(`/api${path}/scan`)
      .set('X-CSRF-Token', other.csrf)
      .attach('file', image, 'card.jpg')
      .expect(403);
  });
});

describe('scanning from the round', () => {
  it('works out which foursome a card belongs to from the names', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Round Scan' }).expect(201);
    const L = league.id as string;
    const names = ['Jerry', 'Keith', 'Paul', 'Doc', 'Brian', 'Tony', 'Rich', 'Dickie'];
    const ids: Record<string, string> = {};
    for (const nickname of names) {
      ids[nickname] = (
        await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201)
      ).body.id;
      await as(site).patch(`/leagues/${L}/players/${ids[nickname]}`, { handicap: 8 }).expect(200);
    }
    const { body: season } = await as(site)
      .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
      .expect(201);
    const S = season.id as string;
    const { body: sched } = await as(site)
      .post(`/leagues/${L}/seasons/${S}/generate`, { seed: 1 })
      .expect(201);
    await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
    const week = sched.weeks[0];
    const second = week.groups[1];
    const nameOf = (id: string) => Object.keys(ids).find((k) => ids[k] === id)!;
    const theirNames = second.matches
      .flatMap((m: { playerA: string; playerB: string }) => [m.playerA, m.playerB])
      .map(nameOf);

    const image = await cardImage(
      theirNames.map((n: string, i: number) => [n, Array(9).fill(4 + (i % 3))]),
    );
    const res = await site.agent
      .post(`/api/leagues/${L}/seasons/${S}/weeks/${week.id}/scan`)
      .set('X-CSRF-Token', site.csrf)
      .attach('file', image, 'card.jpg')
      .expect(201);
    expect(res.body.groupId).toBe(second.id);
    expect(res.body.matchedPlayers).toBeGreaterThanOrEqual(3);
    const cards = (
      await as(site).get(`/leagues/${L}/photos?kind=card&groupId=${second.id}`).expect(200)
    ).body;
    expect(cards.map((p: { id: string }) => p.id)).toEqual([res.body.photo.id]);

    // A card with nobody from this round: no foursome is guessed.
    const stranger = await cardImage([['Zebulon', Array(9).fill(5)]]);
    const none = await site.agent
      .post(`/api/leagues/${L}/seasons/${S}/weeks/${week.id}/scan`)
      .set('X-CSRF-Token', site.csrf)
      .attach('file', stranger, 'card.jpg')
      .expect(201);
    expect(none.body.groupId).toBeNull();
  });
});

describe('practice scans (Account)', () => {
  it('reads a card against your league without saving anything', async () => {
    const { body: league } = await as(site).post('/leagues', { name: 'Practice' }).expect(201);
    for (const nickname of ['Jerry', 'Keith'])
      await as(site).post(`/leagues/${league.id}/players`, { nickname }).expect(201);
    await createUser(t.db, 'jerry@example.com');
    await as(site).post('/users', { email: 'jerry@example.com', leagueId: league.id }).expect(201);
    const jerry = await signIn(t, 'jerry@example.com');

    const image = await cardImage([
      ['Jerry', [5, 4, 3, 5, 4, 4, 5, 3, 4]],
      ['Keith', [6, 5, 4, 5, 5, 4, 6, 4, 5]],
    ]);
    const { body } = await jerry.agent
      .post('/api/me/card-scan/practice')
      .set('X-CSRF-Token', jerry.csrf)
      .attach('file', image, 'card.jpg')
      .expect(200);
    expect(body.provider).toBe('ocr');
    expect(body.layout.holes).toHaveLength(9);
    const jerryRow = body.rows.find((r: { player: string | null }) => r.player === 'Jerry');
    expect(jerryRow.holeScores).toEqual([5, 4, 3, 5, 4, 4, 5, 3, 4]);
    expect(body.left).toBe(9);

    // Nothing kept: no photos.
    const photos = await t.db.execute('select count(*)::int as n from photos');
    expect(photos.rows[0]).toEqual({ n: 0 });
  });

  it("refuses files that aren't photos", async () => {
    await jerryWithNoLeague();
    const jerry = await signIn(t, 'jerry@example.com');
    await jerry.agent
      .post('/api/me/card-scan/practice')
      .set('X-CSRF-Token', jerry.csrf)
      .attach('file', Buffer.from('not an image'), 'card.jpg')
      .expect(400);
  });
});

async function jerryWithNoLeague() {
  await createUser(t.db, 'jerry@example.com');
}
