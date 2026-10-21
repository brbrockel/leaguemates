import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveFileVars } from '../src/config.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

const web = mkdtempSync(join(tmpdir(), 'teemate-web-'));
mkdirSync(join(web, 'assets'));
writeFileSync(join(web, 'index.html'), '<!doctype html><title>LeagueMates</title>');
writeFileSync(join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
writeFileSync(join(web, 'sw.js'), '// sw');

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    WEB_DIST: web,
    CLIENT_IP_HEADER: 'cf-connecting-ip',
    MAGIC_LINK_LIMIT_PER_IP: 2,
  });
});
afterAll(async () => t.close());
beforeEach(async () => resetDb(t.db));
const http = () => request(t.app.getHttpServer());

describe('serving the web app', () => {
  it('serves index.html for app routes, uncached, with a strict CSP', async () => {
    const res = await http().get('/leagues/123').expect(200);
    expect(res.text).toContain('<title>LeagueMates</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('caches hashed assets for a year, but not the service worker', async () => {
    const asset = await http().get('/assets/app-abc123.js').expect(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const sw = await http().get('/sw.js').expect(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
  });

  it('never answers API paths with the web app', async () => {
    await http().get('/api/does-not-exist').expect(404);
    await http().get('/api/auth/me').expect(401);
  });
});

describe('client IP from the edge header', () => {
  it('rate-limits per visitor, not per proxy', async () => {
    const from = (ip: string, n: number) =>
      http()
        .post('/api/auth/magic-link')
        .set('CF-Connecting-IP', ip)
        .send({ email: `x${n}@example.com` });
    await from('203.0.113.1', 1).expect(202);
    await from('203.0.113.1', 2).expect(202);
    await from('203.0.113.1', 3).expect(429);
    await from('203.0.113.2', 4).expect(202); // a different visitor is unaffected
  });
});

describe('secrets from files', () => {
  it('reads FOO from FOO_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teemate-secret-'));
    writeFileSync(join(dir, 'db'), 'postgres://u:p@db/teemate\n');
    const env = resolveFileVars({ DATABASE_URL_FILE: join(dir, 'db') });
    expect(env.DATABASE_URL).toBe('postgres://u:p@db/teemate');
    const c = loadConfig({ ...env, APP_URL: 'https://teemate.test', MAIL_FROM: 'x' });
    expect(c.DATABASE_URL).toBe('postgres://u:p@db/teemate');
  });
});
