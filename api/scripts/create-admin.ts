/**
 * Creates (or promotes) a site admin. Accounts are invite-only, so this is
 * how the first person gets in; they then sign in with a magic link.
 *
 *   pnpm --filter @leaguemates/api admin:create you@example.com ["Your Name"]
 */
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../src/auth/tokens.js';
import { resolveFileVars } from '../src/config.js';
import { createDb, createPool } from '../src/db/db.js';
import { users } from '../src/db/schema.js';

const [rawEmail, name] = process.argv.slice(2);
if (!rawEmail || !rawEmail.includes('@')) {
  console.error('Usage: admin:create <email> [name]');
  process.exit(1);
}
const url = resolveFileVars(process.env).DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = createPool(url);
const db = createDb(pool);
const email = normalizeEmail(rawEmail);
const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing) {
  await db.update(users).set({ isSiteAdmin: true }).where(eq(users.id, existing.id));
  console.log(`${email} is now a site admin`);
} else {
  await db.insert(users).values({ email, name: name ?? null, isSiteAdmin: true });
  console.log(`Created site admin ${email}`);
}
await pool.end();
