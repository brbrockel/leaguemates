import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { resolveFileVars } from '../config.js';
import { createDb, createPool } from './db.js';

/** api/drizzle, from either src/db (tests) or dist/src/db (built). */
export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  import.meta.url.includes('/dist/') ? '../../../drizzle' : '../../drizzle',
);

/** Postgres errors that mean "not ready yet", worth retrying: starting up, shutting down, too many connections. */
const TRANSIENT_PG_CODES = new Set(['57P03', '57P01', '53300']);
/** Network errors while the database container or its DNS name is still coming up. */
const TRANSIENT_NET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
]);

export function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (TRANSIENT_PG_CODES.has(code) || TRANSIENT_NET_CODES.has(code)))
    return true;
  return /timeout|terminated unexpectedly/i.test(String((err as Error | null)?.message ?? ''));
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Retry `probe` until it succeeds, while it fails with a transient error and time remains.
 * After a host restart Postgres can take a while to accept connections; without this the
 * container exits and Swarm restarts it over and over (2026-11-04).
 */
export async function waitFor(
  probe: () => Promise<unknown>,
  opts: WaitOptions = {},
): Promise<void> {
  const {
    timeoutMs = 120_000,
    intervalMs = 2_000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    log = console.log,
  } = opts;
  const deadline = now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    try {
      await probe();
      return;
    } catch (err) {
      if (!isTransientDbError(err) || now() + intervalMs > deadline) throw err;
      log(`Database not ready (attempt ${attempt}): ${(err as Error).message}; retrying`);
      await sleep(intervalMs);
    }
  }
}

export async function waitForDatabase(databaseUrl: string, opts?: WaitOptions): Promise<void> {
  await waitFor(async () => {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      await client.query('select 1');
    } finally {
      await client.end().catch(() => {});
    }
  }, opts);
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = resolveFileVars(process.env).DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await waitForDatabase(url);
  await runMigrations(url);
  console.log('Migrations applied');
}
