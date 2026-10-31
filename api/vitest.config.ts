import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://leaguemates:leaguemates@localhost:15432/leaguemates_test',
  APP_URL: 'http://localhost:4101',
  MAIL_FROM: 'LeagueMates <leaguemates@test>',
};
// Global setup runs in this process, before `test.env` reaches the workers.
Object.assign(process.env, env);

export default defineConfig({
  // SWC keeps the decorator metadata that NestJS dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    // These tests use a real database and generate full schedules; CI runners are slower than dev machines.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env,
  },
});
