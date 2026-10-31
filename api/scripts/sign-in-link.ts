/**
 * Prints a single-use link to set (or reset) a user's password, without sending email.
 * For the first sign-in on a server, or if every admin is locked out:
 *
 *   pnpm --filter @leaguemates/api sign-in-link you@example.com
 *   docker exec <container> node api/dist/scripts/sign-in-link.js you@example.com
 */
import { eq } from 'drizzle-orm';
import { issuePasswordLink } from '../src/auth/sign-in-link.js';
import { normalizeEmail } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config.js';
import { createDb, createPool } from '../src/db/db.js';
import { users } from '../src/db/schema.js';

const [rawEmail] = process.argv.slice(2);
if (!rawEmail?.includes('@')) {
  console.error('Usage: sign-in-link <email>');
  process.exit(1);
}
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
try {
  const email = normalizeEmail(rawEmail);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.disabledAt) {
    console.error(`No active user ${email}. Create one with admin:create first.`);
    process.exitCode = 1;
  } else {
    const { link, expiresAt } = await issuePasswordLink(
      db,
      config.APP_URL,
      email,
      config.ADMIN_LINK_TTL_HOURS * 3600 * 1000,
    );
    console.log(
      `Password link for ${email} (single use, expires ${expiresAt.toISOString()}):\n${link}`,
    );
  }
} finally {
  await pool.end();
}
