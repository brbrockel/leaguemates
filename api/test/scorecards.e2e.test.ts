import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, scorecards } from '../src/db/schema.js';
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
  put: (path: string, body: object) =>
    who.agent.put(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
  patch: (path: string, body: object) =>
    who.agent.patch(`/api${path}`).set('X-CSRF-Token', who.csrf).send(body),
});

const HCP: Record<string, number> = {
  Brian: 14,
  Doc: 7,
  Jerry: 7,
  Paul: 6,
  Rich: 4,
  Keith: 13,
  Todd: 14,
  Tony: 5,
};

interface Group {
  id: string;
  matches: { playerA: string; playerB: string }[];
}
interface Week {
  id: string;
  groups: Group[];
}

/** 8-player league with handicaps, Jerry and Keith signed up, a locked season. */
async function setup({
  lock = true,
  skipHandicapFor,
}: { lock?: boolean; skipHandicapFor?: string } = {}) {
  const { body: league } = await as(site)
    .post('/leagues', { name: 'Wednesday League' })
    .expect(201);
  const L = league.id as string;
  const ids: Record<string, string> = {};
  for (const nickname of Object.keys(HCP)) {
    const { body } = await as(site).post(`/leagues/${L}/players`, { nickname }).expect(201);
    ids[nickname] = body.id;
    if (nickname !== skipHandicapFor)
      await as(site)
        .patch(`/leagues/${L}/players/${body.id}`, { handicap: HCP[nickname] })
        .expect(200);
  }
  await as(site)
    .post('/users', { email: 'jerry@example.com', leagueId: L, playerId: ids['Jerry'] })
    .expect(201);
  await as(site)
    .post('/users', { email: 'keith@example.com', leagueId: L, playerId: ids['Keith'] })
    .expect(201);
  const { body: season } = await as(site)
    .post(`/leagues/${L}/seasons`, { name: '2027', startDate: '2027-04-21' })
    .expect(201);
  const S = season.id as string;
  // Spots in this order, so seed 3 gives the same foursomes every run.
  await as(site)
    .put(`/leagues/${L}/seasons/${S}/roster`, { playerIds: Object.keys(HCP).map((n) => ids[n]) })
    .expect(200);
  const sched = (
    await as(site).post(`/leagues/${L}/seasons/${S}/generate`, { seed: 3 }).expect(201)
  ).body as { weeks: Week[] };
  if (lock) await as(site).post(`/leagues/${L}/seasons/${S}/lock`).expect(201);
  const name = (id: string) => Object.keys(ids).find((k) => ids[k] === id)!;
  const week = sched.weeks[0]!;
  const jerryGroup = week.groups.find((g) =>
    g.matches.some((m) => [m.playerA, m.playerB].includes(ids['Jerry']!)),
  )!;
  const otherGroup = week.groups.find(
    (g) =>
      g !== jerryGroup && !g.matches.some((m) => [m.playerA, m.playerB].includes(ids['Keith']!)),
  );
  return { L, S, ids, name, week, jerryGroup, otherGroup, sched };
}

const cardPath = (L: string, S: string, W: string, G: string) =>
  `/leagues/${L}/seasons/${S}/weeks/${W}/groups/${G}/scorecard`;
const nines = (n: number) => Array.from({ length: 9 }, () => n);

/** Every player shoots `perHole` on every hole unless overridden. */
function roundsFor(group: Group, perHole: (playerId: string) => number | 'absent') {
  return group.matches
    .flatMap((m) => [m.playerA, m.playerB])
    .map((playerId) => {
      const v = perHole(playerId);
      return v === 'absent'
        ? { playerId, attendance: 'absent', subName: 'A sub', holeScores: nines(0).map(() => null) }
        : { playerId, attendance: 'played', holeScores: nines(v) };
    });
}

describe('entering a card', () => {
  it('needs the schedule to be locked', async () => {
    const { L, S, week, jerryGroup } = await setup({ lock: false });
    const view = (
      await as(site)
        .get(cardPath(L, S, week.id, jerryGroup.id))
        .expect(200)
    ).body;
    await as(site)
      .put(cardPath(L, S, week.id, jerryGroup.id), {
        layoutId: view.plannedLayoutId,
        rounds: roundsFor(jerryGroup, () => 5),
      })
      .expect(400);
  });

  it('a skipped round takes no cards and stays skipped', async () => {
    const { L, S, sched } = await setup();
    const week = sched.weeks[1]!;
    const group = week.groups[0]!;
    await as(site).post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/skip`).expect(201);
    const path = cardPath(L, S, week.id, group.id);
    const view = (await as(site).get(path).expect(200)).body;
    expect(view.permissions).toMatchObject({ canEdit: false, canSubmit: false });
    await as(site)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(group, () => 5) })
      .expect(400);
    await as(site).post(`${path}/submit`).expect(403);
    const after = (await as(site).get(`/leagues/${L}/seasons/${S}`).expect(200)).body;
    expect(after.weeks[1].status).toBe('skipped');
  });

  it("a season can't be unlocked once any card has scores, so they can't be regenerated away", async () => {
    const { L, S, week, jerryGroup } = await setup();
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    await as(site)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
      .expect(200);
    await as(site).post(`/leagues/${L}/seasons/${S}/unlock`).expect(400);
    await as(site).post(`/leagues/${L}/seasons/${S}/generate`).expect(400);
    expect((await as(site).get(path).expect(200)).body.card).not.toBeNull();
  });

  it('a player in the group enters it; results follow the league rules', async () => {
    const { L, S, ids, name, week, jerryGroup } = await setup();
    const jerry = await signIn(t, 'jerry@example.com');
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const empty = (await as(jerry).get(path).expect(200)).body;
    expect(empty.card).toBeNull();
    expect(empty.permissions).toMatchObject({
      canEdit: true,
      canSubmit: true,
      canDispute: false,
      canApprove: false,
    });
    expect(
      empty.players.find((p: { playerId: string }) => p.playerId === ids['Jerry']).handicap,
    ).toBe(7);

    // Everyone shoots 5s (gross 45), so the lower handicap wins on net... unless strokes make it tie.
    const saved = (
      await as(jerry)
        .put(path, { layoutId: empty.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
        .expect(200)
    ).body;
    expect(saved.card.status).toBe('draft');
    for (const m of saved.matches) {
      const [ha, hb] = [HCP[name(m.playerA)]!, HCP[name(m.playerB)]!];
      const expected = ha === hb ? 'T' : ha > hb ? 'A' : 'B'; // higher handicap gets strokes, so wins at equal gross
      expect(m.result.outcome).toBe(expected);
      expect(m.result.decidedBy).toBe('net');
    }
  });

  it('applies the absence rule', async () => {
    const { L, S, ids, week, jerryGroup } = await setup();
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    const jerryMatch = jerryGroup.matches.find((m) =>
      [m.playerA, m.playerB].includes(ids['Jerry']!),
    )!;
    const opponent = jerryMatch.playerA === ids['Jerry'] ? jerryMatch.playerB : jerryMatch.playerA;
    // Opponent absent. Jerry (7) gross 4s = 36; baseline = par 36 + opponent hcp, so Jerry's net must be lower.
    const saved = (
      await as(site)
        .put(path, {
          layoutId: view.plannedLayoutId,
          rounds: roundsFor(jerryGroup, (id) => (id === opponent ? 'absent' : 4)),
        })
        .expect(200)
    ).body;
    const result = saved.matches.find((m: { id: string; playerA: string }) =>
      [jerryMatch.playerA].includes(m.playerA),
    ).result;
    expect(result.decidedBy).toBe('absence');
    expect(result.outcome).toBe(jerryMatch.playerA === ids['Jerry'] ? 'A' : 'B');
    expect(
      saved.card.rounds.find((r: { playerId: string }) => r.playerId === opponent),
    ).toMatchObject({ attendance: 'absent', subName: 'A sub' });
  });

  it('people outside the group can view but not enter it', async () => {
    const { L, S, week, otherGroup } = await setup();
    const keith = await signIn(t, 'keith@example.com');
    const path = cardPath(L, S, week.id, otherGroup!.id);
    const view = (await as(keith).get(path).expect(200)).body;
    expect(view.permissions.canEdit).toBe(false);
    await as(keith)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(otherGroup!, () => 5) })
      .expect(403);
  });

  it('refuses a stale save (someone else saved first)', async () => {
    const { L, S, week, jerryGroup } = await setup();
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    const first = (
      await as(site)
        .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
        .expect(200)
    ).body;
    await as(site)
      .put(path, {
        layoutId: view.plannedLayoutId,
        version: first.card.version,
        rounds: roundsFor(jerryGroup, () => 6),
      })
      .expect(200);
    await as(site)
      .put(path, {
        layoutId: view.plannedLayoutId,
        version: first.card.version,
        rounds: roundsFor(jerryGroup, () => 7),
      })
      .expect(409);
  });

  it('records the nine actually played', async () => {
    const { L, S, week, jerryGroup } = await setup();
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    const other = view.layouts.find((l: { id: string }) => l.id !== view.plannedLayoutId);
    const saved = (
      await as(site)
        .put(path, { layoutId: other.id, rounds: roundsFor(jerryGroup, () => 5) })
        .expect(200)
    ).body;
    expect(saved.card.layoutId).toBe(other.id);
  });

  it('asks for a handicap before a player can be scored', async () => {
    const { L, S, week, sched, ids } = await setup({ skipHandicapFor: 'Tony' });
    const g = sched.weeks[0]!.groups.find((x) =>
      x.matches.some((m) => [m.playerA, m.playerB].includes(ids['Tony']!)),
    )!;
    const path = cardPath(L, S, week.id, g.id);
    const view = (await as(site).get(path).expect(200)).body;
    const res = await as(site)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(g, () => 5) })
      .expect(400);
    expect(res.body.message).toMatch(/Tony has no handicap/);
  });
});

describe('submitting, disputes and approval', () => {
  it('runs the full card life cycle with an audited admin correction', async () => {
    const { L, S, week, jerryGroup } = await setup();
    const jerry = await signIn(t, 'jerry@example.com');
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(jerry).get(path).expect(200)).body;
    const partial = roundsFor(jerryGroup, () => 5).map((r, i) =>
      i === 0 ? { ...r, holeScores: [5, 5, null, 5, 5, 5, 5, 5, 5] } : r,
    );
    await as(jerry).put(path, { layoutId: view.plannedLayoutId, rounds: partial }).expect(200);
    expect((await as(jerry).post(`${path}/submit`).expect(400)).body.message).toMatch(
      /Missing hole scores/,
    );

    await as(jerry)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
      .expect(200);
    expect((await as(jerry).post(`${path}/submit`).expect(201)).body.card.status).toBe('submitted');
    await as(jerry)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 6) })
      .expect(403);

    const disputed = (
      await as(jerry)
        .post(`${path}/dispute`, { note: 'Doc had a 4 on the 6th, not a 5' })
        .expect(201)
    ).body;
    expect(disputed.card).toMatchObject({
      status: 'disputed',
      dispute: { note: 'Doc had a 4 on the 6th, not a 5' },
    });

    await as(site)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
      .expect(400); // reason needed
    await as(site)
      .put(path, {
        layoutId: view.plannedLayoutId,
        reason: 'Fixed per dispute',
        rounds: roundsFor(jerryGroup, () => 5),
      })
      .expect(200);
    expect((await as(site).post(`${path}/approve`).expect(201)).body.card.status).toBe('final');

    const actions = (await t.db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'scorecard.submit',
        'scorecard.dispute',
        'scorecard.override',
        'scorecard.approve',
      ]),
    );
    const override = (await t.db.select().from(auditLog)).find(
      (r) => r.action === 'scorecard.override',
    );
    expect(override!.reason).toBe('Fixed per dispute');
  });

  it('becomes final on its own after the dispute window', async () => {
    const { L, S, week, jerryGroup } = await setup();
    const jerry = await signIn(t, 'jerry@example.com');
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(jerry).get(path).expect(200)).body;
    await as(jerry)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
      .expect(200);
    await as(jerry).post(`${path}/submit`).expect(201);
    await t.db.update(scorecards).set({ submittedAt: new Date(Date.now() - 49 * 3600_000) });
    expect((await as(jerry).get(path).expect(200)).body.card.status).toBe('final');
    await as(jerry).post(`${path}/dispute`, { note: 'too late' }).expect(403);
  });
});

describe('standings', () => {
  it('count submitted cards (provisional) and ignore drafts; a fully submitted week is played', async () => {
    const { L, S, week, ids } = await setup();
    const [g1, g2] = week.groups;
    for (const g of [g1!, g2!]) {
      const path = cardPath(L, S, week.id, g.id);
      const view = (await as(site).get(path).expect(200)).body;
      await as(site)
        .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(g, () => 5) })
        .expect(200);
    }
    let st = (await as(site).get(`/leagues/${L}/seasons/${S}/standings`).expect(200)).body;
    expect(st.roundsCounted).toBe(0); // drafts don't count
    expect(st.rows.every((r: { played: number }) => r.played === 0)).toBe(true);

    await as(site)
      .post(`${cardPath(L, S, week.id, g1!.id)}/submit`)
      .expect(201);
    st = (await as(site).get(`/leagues/${L}/seasons/${S}/standings`).expect(200)).body;
    expect(st).toMatchObject({ provisional: true, roundsCounted: 1 });
    expect(st.rows.filter((r: { played: number }) => r.played === 1)).toHaveLength(4);

    for (const g of week.groups.slice(1)) {
      const path = cardPath(L, S, week.id, g.id);
      const view = (await as(site).get(path).expect(200)).body;
      if (!view.card)
        await as(site)
          .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(g, () => 5) })
          .expect(200);
      await as(site).post(`${path}/submit`).expect(201);
    }
    const sched = (await as(site).get(`/leagues/${L}/seasons/${S}`).expect(200)).body;
    expect(sched.weeks[0].status).toBe('played');
    st = (await as(site).get(`/leagues/${L}/seasons/${S}/standings`).expect(200)).body;
    type Row = { played: number; W: number; L: number; T: number; points: number };
    const rows = st.rows as Row[];
    expect(rows.every((r) => r.played === 1)).toBe(true);
    expect(rows.every((r) => r.points === 3 * r.W + r.T)).toBe(true);
    const sum = (k: 'W' | 'L' | 'T') => rows.reduce((n, r) => n + r[k], 0);
    expect(sum('W')).toBe(sum('L'));
    expect(sum('W') + sum('T') / 2).toBe(4); // 4 matches
    expect(ids).toBeDefined();
  });
});

describe('player history and season stats', () => {
  it('shows how each hole plays from submitted cards, and a player against the field', async () => {
    const { L, S, ids, week, jerryGroup } = await setup();
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    // Everyone shoots 5 on every hole except Jerry, who shoots 4s.
    await as(site)
      .put(path, {
        layoutId: view.plannedLayoutId,
        rounds: roundsFor(jerryGroup, (p) => (p === ids['Jerry'] ? 4 : 5)),
      })
      .expect(200);
    // Drafts don't count.
    expect((await as(site).get(`/leagues/${L}/stats/holes`).expect(200)).body.nines).toEqual([]);
    await as(site).post(`${path}/submit`).expect(201);
    const { body } = await as(site)
      .get(`/leagues/${L}/stats/holes?playerId=${ids['Jerry']}`)
      .expect(200);
    expect(body.seasons).toEqual([{ id: S, name: '2027' }]);
    const nine = body.nines[0];
    expect(nine.rounds).toBe(4);
    expect(nine.mine).toBe(1);
    expect(nine.holes).toHaveLength(9);
    // (4 + 5 + 5 + 5) / 4 = 4.75 on every hole.
    expect(nine.holes[0]).toMatchObject({ n: 4, avg: 4.75, mine: { n: 1, avg: 4 } });
  });

  it('builds a player record, head-to-head and the scoring table from submitted cards', async () => {
    const { L, S, ids, week, jerryGroup } = await setup();
    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    await as(site)
      .put(path, {
        layoutId: view.plannedLayoutId,
        rounds: roundsFor(jerryGroup, (p) => (p === ids['Jerry'] ? 4 : 5)),
      })
      .expect(200);

    // Drafts don't count.
    let h = (await as(site).get(`/leagues/${L}/players/${ids['Jerry']}/history`).expect(200)).body;
    expect(h.matches).toHaveLength(0);
    expect(h.stats).toMatchObject({ rounds: 0, scoringAverage: null, winPct: null });

    await as(site).post(`${path}/submit`).expect(201);
    h = (await as(site).get(`/leagues/${L}/players/${ids['Jerry']}/history`).expect(200)).body;
    expect(h.player.nickname).toBe('Jerry');
    expect(h.matches).toHaveLength(1);
    expect(h.matches[0]).toMatchObject({ gross: 36, result: 'W', points: 3, handicap: 7 });
    expect(h.stats).toMatchObject({
      rounds: 1,
      scoringAverage: 36,
      winPct: 100,
      record: { W: 1, L: 0, T: 0 },
    });
    expect(h.stats.best.gross).toBe(36);
    expect(h.seasons).toEqual([
      expect.objectContaining({ season: '2027', W: 1, points: 3, official: false }),
    ]);
    expect(h.headToHead).toEqual([
      expect.objectContaining({ opponentId: h.matches[0].opponentId, W: 1, L: 0, T: 0 }),
    ]);

    const stats = (await as(site).get(`/leagues/${L}/seasons/${S}/stats`).expect(200)).body;
    expect(stats).toHaveLength(4);
    expect(stats[0]).toMatchObject({ nickname: 'Jerry', rounds: 1, scoringAverage: 36, best: 36 });

    // A player from another league is not found here.
    const { body: other } = await as(site).post('/leagues', { name: 'Other' }).expect(201);
    const { body: stranger } = await as(site)
      .post(`/leagues/${other.id}/players`, { nickname: 'X' })
      .expect(201);
    await as(site).get(`/leagues/${L}/players/${stranger.id}/history`).expect(404);
  });
});

describe('game-day changes', () => {
  interface Sched {
    weeks: {
      id: string;
      groups: {
        id: string;
        slot: number;
        teeTime: string;
        matches: { id: string; playerA: string; playerB: string }[];
      }[];
    }[];
  }
  const schedule = async (L: string, S: string) =>
    (await as(site).get(`/leagues/${L}/seasons/${S}`).expect(200)).body as Sched;

  it('players in the round move a foursome up the tee order; tee times stay in place', async () => {
    const { L, S, week } = await setup();
    const jerry = await signIn(t, 'jerry@example.com');
    const before = (await schedule(L, S)).weeks[0]!.groups;
    const second = before[1]!;
    const { body } = await as(jerry)
      .post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/tee-order`, {
        groupId: second.id,
        direction: 'up',
      })
      .expect(201);
    const after = (body as Sched).weeks[0]!.groups;
    expect(after.map((g) => g.id)).toEqual([before[1]!.id, before[0]!.id]);
    expect(after.map((g) => g.teeTime)).toEqual(before.map((g) => g.teeTime));
    await as(jerry)
      .post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/tee-order`, {
        groupId: second.id,
        direction: 'up',
      })
      .expect(400); // already first off

    // A member who isn't playing that round can't.
    await as(site).post('/users', { email: 'fan@example.com', leagueId: L }).expect(201);
    const fan = await signIn(t, 'fan@example.com');
    await as(fan)
      .post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/tee-order`, {
        groupId: second.id,
        direction: 'down',
      })
      .expect(403);
  });

  it('regroups: two matches trade foursomes, but not once a card is started', async () => {
    const { L, S, week } = await setup();
    const [g1, g2] = (await schedule(L, S)).weeks[0]!.groups;
    const [m1] = g1!.matches;
    const [m2] = g2!.matches;
    const { body } = await as(site)
      .post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/regroup`, {
        matchA: m1!.id,
        matchB: m2!.id,
      })
      .expect(201);
    const after = (body as Sched).weeks[0]!.groups;
    expect(after[0]!.matches.map((m) => m.id)).toContain(m2!.id);
    expect(after[1]!.matches.map((m) => m.id)).toContain(m1!.id);
    await as(site)
      .post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/regroup`, {
        matchA: m1!.id,
        matchB: after[1]!.matches.find((m) => m.id !== m1!.id)!.id,
      })
      .expect(400); // same foursome

    // Start a card for the first foursome: no more regrouping it.
    const first = after[0]! as unknown as Group;
    const path = cardPath(L, S, week.id, first.id);
    const view = (await as(site).get(path).expect(200)).body;
    await as(site)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(first, () => 5) })
      .expect(200);
    const other = after[1]!.matches[0]!.id;
    await as(site)
      .post(`/leagues/${L}/seasons/${S}/weeks/${week.id}/regroup`, {
        matchA: after[0]!.matches[0]!.id,
        matchB: other,
      })
      .expect(400);
  });

  it("a player says they can't make it: the foursome is told and the card starts with them absent", async () => {
    const { L, S, ids, week, jerryGroup } = await setup();
    const jerry = await signIn(t, 'jerry@example.com');
    const keith = await signIn(t, 'keith@example.com');
    const absence = (who: string) =>
      `/leagues/${L}/seasons/${S}/weeks/${week.id}/absences/${ids[who]}`;

    // Keith can't mark Jerry out; Jerry can, with a sub.
    await keith.agent
      .put(`/api${absence('Jerry')}`)
      .set('X-CSRF-Token', keith.csrf)
      .send({})
      .expect(403);
    const { body } = await jerry.agent
      .put(`/api${absence('Jerry')}`)
      .set('X-CSRF-Token', jerry.csrf)
      .send({ subName: 'Uncle Bob' })
      .expect(200);
    expect(body.weeks[0].absences).toEqual([{ playerId: ids['Jerry'], subName: 'Uncle Bob' }]);

    const notices = (await as(jerry).get(`/leagues/${L}/announcements`).expect(200)).body;
    expect(notices[0]).toMatchObject({
      title: "Jerry can't make round 1",
      body: 'Uncle Bob is subbing.',
      to: 'Your foursome',
    });

    const path = cardPath(L, S, week.id, jerryGroup.id);
    const view = (await as(site).get(path).expect(200)).body;
    expect(view.players.find((p: { playerId: string }) => p.playerId === ids['Jerry']).out).toEqual(
      {
        subName: 'Uncle Bob',
      },
    );

    // Once the card is started it's marked there instead.
    await as(site)
      .put(path, { layoutId: view.plannedLayoutId, rounds: roundsFor(jerryGroup, () => 5) })
      .expect(200);
    await jerry.agent
      .delete(`/api${absence('Jerry')}`)
      .set('X-CSRF-Token', jerry.csrf)
      .expect(400);
  });

  it('admins mark anyone out, and back in', async () => {
    const { L, S, ids, week } = await setup();
    const absence = `/leagues/${L}/seasons/${S}/weeks/${week.id}/absences/${ids['Keith']}`;
    await site.agent.put(`/api${absence}`).set('X-CSRF-Token', site.csrf).send({}).expect(200);
    const { body } = await site.agent
      .delete(`/api${absence}`)
      .set('X-CSRF-Token', site.csrf)
      .expect(200);
    expect(body.weeks[0].absences).toEqual([]);
  });
});
