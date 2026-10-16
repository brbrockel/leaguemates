import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, createPool, type Database } from '../src/db/db.js';
import { users } from '../src/db/schema.js';
import { MAILER, type Mail, type Mailer } from '../src/mail/mailer.js';

export interface TestApp {
  app: INestApplication;
  db: Database;
  outbox: Mail[];
  close(): Promise<void>;
}

export async function createTestApp(
  overrides: Partial<Config> = {},
  customize: (m: TestingModuleBuilder) => TestingModuleBuilder = (m) => m,
): Promise<TestApp> {
  const config = { ...loadConfig(), ...overrides };
  const outbox: Mail[] = [];
  const mailer: Mailer = { send: async (m) => void outbox.push(m) };
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule.with(config)] })
      .overrideProvider(MAILER)
      .useValue(mailer),
  ).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();

  const pool = createPool(config.DATABASE_URL);
  return {
    app,
    db: createDb(pool),
    outbox,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export async function resetDb(db: Database): Promise<void> {
  await db.execute(sql`truncate table
    bug_reports, photos, scramble_team_members, scramble_teams, scrambles, announcements, card_rounds, scorecards, matches, groups, weeks, season_players, seasons, site_settings, audit_log, auth_attempts, invites, league_memberships, players, leagues,
    sessions, magic_link_tokens, users restart identity cascade`);
  // Timberlin is seeded by a migration; anything else is from a test.
  await db.execute(sql`delete from courses where name <> 'Timberlin Golf Club'`);
}

export async function createUser(db: Database, email: string, isSiteAdmin = false) {
  const [user] = await db.insert(users).values({ email, isSiteAdmin }).returning();
  return user!;
}

/** Pulls the token out of the newest sign-in email sent to `email`. */
export function tokenFromOutbox(outbox: Mail[], email: string): string {
  const mail = [...outbox].reverse().find((m) => m.to === email && m.subject.includes('sign-in'));
  const token = mail?.text.match(/#token=([\w-]+)/)?.[1];
  if (!token) throw new Error(`No sign-in email for ${email}`);
  return token;
}

export interface SignedIn {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

/** Signs in through the real magic-link flow; the agent keeps the session cookie. */
export async function signIn(t: TestApp, email: string): Promise<SignedIn> {
  const agent = request.agent(t.app.getHttpServer());
  await agent.post('/api/auth/magic-link').send({ email }).expect(202);
  const res = await agent
    .post('/api/auth/verify')
    .send({ token: tokenFromOutbox(t.outbox, email) });
  expect(res.status).toBe(200);
  return { agent, csrf: res.body.csrfToken as string };
}
