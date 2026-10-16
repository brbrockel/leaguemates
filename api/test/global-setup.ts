import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

/** Creates the test database if needed and brings it up to date. */
export default async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
      dbName,
    ]);
    if (!rowCount) await client.query(`create database "${dbName}"`);
  } finally {
    await client.end();
  }
  await runMigrations(url.toString());
}
