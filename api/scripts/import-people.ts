/**
 * Builds people records from the league's roster sheet (tools/import/roster_people.py
 * output): each league player gets their full name, and an account with their email, phone
 * and address, linked to their roster spot and a member (User) of the league.
 *
 *   node dist/scripts/import-people.js people.json [--dry-run]
 *   docker exec -i <container> node dist/scripts/import-people.js - < people.json
 *
 * - Nothing is emailed. People sign in once an admin hands them a password link.
 * - It only fills in what's missing: a name, phone or address already in the app is kept,
 *   and a player already linked to an account keeps it (only its blanks are filled in).
 * - Rows it can't place (no such player, a bad email,
 *   the email already linked to another player) are reported and skipped.
 * - Every change is in the audit log.
 */
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { normalizeEmail } from '../src/auth/tokens.js';
import { normalizePhone } from '../src/common/phone.js';
import { loadConfig } from '../src/config.js';
import { createDb, createPool } from '../src/db/db.js';
import { auditLog, leagueMemberships, leagues, players, users } from '../src/db/schema.js';

const LIVE_SLUG = 'wednesday-league';
const Person = z.object({
  nickname: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
});

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('Usage: import-people <people.json | -> [--dry-run]');
  process.exit(1);
}
const dryRun = flags.includes('--dry-run');
const people = z.array(Person).parse(JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8')));

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
const DRY = new Error('dry run');

try {
  const [league] = await db.select().from(leagues).where(eq(leagues.slug, LIVE_SLUG)).limit(1);
  if (!league) throw new Error(`No league with slug "${LIVE_SLUG}".`);
  const report: string[] = [];
  await db
    .transaction(async (tx) => {
      const audit = (row: Omit<typeof auditLog.$inferInsert, 'leagueId'>) =>
        tx.insert(auditLog).values({ leagueId: league.id, ...row });
      for (const p of people) {
        const [player] = await tx
          .select()
          .from(players)
          .where(and(eq(players.leagueId, league.id), eq(players.nickname, p.nickname)))
          .limit(1);
        if (!player) {
          report.push(`skipped ${p.nickname}: no such player in ${league.name}`);
          continue;
        }
        const email = p.email ? normalizeEmail(p.email) : null;
        if (!email || !z.string().email().safeParse(email).success) {
          report.push(`skipped ${p.nickname}: "${p.email ?? ''}" isn't a valid email`);
          continue;
        }
        const phone = p.phone ? normalizePhone(p.phone) : null;
        if (p.phone && !phone)
          report.push(`${p.nickname}: phone "${p.phone}" not understood, left out`);
        const address = p.address?.trim() || null;

        const changes: string[] = [];
        let [user] = player.userId
          ? // Already linked: keep that account (its email may differ from the sheet's).
            await tx.select().from(users).where(eq(users.id, player.userId)).limit(1)
          : await tx.select().from(users).where(eq(users.email, email)).limit(1);
        if (player.userId && user && user.email !== email) changes.push('kept its own email');
        if (user && !player.userId) {
          const [linked] = await tx
            .select({ nickname: players.nickname })
            .from(players)
            .where(and(eq(players.leagueId, league.id), eq(players.userId, user.id)))
            .limit(1);
          if (linked && linked.nickname !== player.nickname) {
            report.push(`skipped ${p.nickname}: ${email} is already ${linked.nickname}'s account`);
            continue;
          }
        }
        if (!player.fullName) {
          await tx.update(players).set({ fullName: p.fullName }).where(eq(players.id, player.id));
          await audit({
            action: 'player.update',
            entityType: 'player',
            entityId: player.id,
            before: { fullName: null },
            after: { fullName: p.fullName, via: 'roster_sheet' },
          });
          changes.push('full name');
        }
        if (!user) {
          [user] = await tx
            .insert(users)
            .values({ email, name: p.fullName, phone, address })
            .returning();
          await audit({
            action: 'user.create',
            entityType: 'user',
            entityId: user!.id,
            after: { via: 'roster_sheet' },
          });
          changes.push('account');
        } else {
          const fill = {
            ...(user.name ? {} : { name: p.fullName }),
            ...(user.phone || !phone ? {} : { phone }),
            ...(user.address || !address ? {} : { address }),
          };
          if (Object.keys(fill).length) {
            await tx.update(users).set(fill).where(eq(users.id, user.id));
            await audit({
              action: 'user.update',
              entityType: 'user',
              entityId: user.id,
              after: { filled: Object.keys(fill), via: 'roster_sheet' },
            });
            changes.push(...Object.keys(fill));
          }
        }
        const [member] = await tx
          .select()
          .from(leagueMemberships)
          .where(
            and(eq(leagueMemberships.leagueId, league.id), eq(leagueMemberships.userId, user!.id)),
          )
          .limit(1);
        if (!member) {
          await tx
            .insert(leagueMemberships)
            .values({ leagueId: league.id, userId: user!.id, role: 'user' });
          await audit({
            action: 'member.add',
            entityType: 'user',
            entityId: user!.id,
            after: { role: 'user', via: 'roster_sheet' },
          });
          changes.push('league member');
        }
        if (!player.userId) {
          await tx.update(players).set({ userId: user!.id }).where(eq(players.id, player.id));
          await audit({
            action: 'player.update',
            entityType: 'player',
            entityId: player.id,
            after: { linkedAccount: true, via: 'roster_sheet' },
          });
          changes.push('linked');
        }
        report.push(`${p.nickname}: ${changes.length ? changes.join(', ') : 'already up to date'}`);
      }
      if (dryRun) throw DRY;
    })
    .catch((e: unknown) => {
      if (e !== DRY) throw e;
    });
  console.log(`${dryRun ? 'Dry run (nothing saved)' : 'Saved'} for ${league.name}:`);
  for (const line of report) console.log(`  ${line}`);
} finally {
  await pool.end();
}
