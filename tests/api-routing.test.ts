/**
 * Routing regression: the browser calls /api/track, /api/contact and /api/star,
 * the cron calls /api/sync, and the download and page routes stay at the root.
 * A mismatch here silently breaks analytics, the contact form and sync.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestD1, applyMigrations, type D1Shim } from './helpers/d1';
import { handleRequest } from '../src/api/app';

describe('public routes', () => {
  let shim: D1Shim;
  let env: Record<string, unknown>;

  const call = (path: string, init: RequestInit = {}) =>
    handleRequest({ request: new Request(`https://portfolio.test${path}`, init), env: env as never });

  beforeAll(() => {
    shim = createTestD1();
    applyMigrations(shim.db);
    env = {
      DB: shim.db,
      DOCS: { get: async () => null, put: async () => undefined, delete: async () => undefined },
      SITE_URL: 'https://portfolio.test',
      GITHUB_USERNAME: 'yswef',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      SYNC_SECRET: 'sync-test-secret-value',
    };
  });

  afterAll(() => shim.close());

  it('answers the health check under /api', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
  });

  it('accepts analytics beacons under /api/track', async () => {
    const response = await call('/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' },
      body: JSON.stringify({ type: 'pageview', path: '/', visitorId: 'a'.repeat(32), sessionId: 'b'.repeat(32), locale: 'ar' }),
    });
    expect(response.status).not.toBe(404);
  });

  it('runs sync only with the secret, and only under /api/sync', async () => {
    expect((await call('/api/sync', { method: 'POST' })).status).toBe(401);
    expect((await call('/api/sync?secret=sync-test-secret-value', { method: 'POST' })).status).toBe(401);
    expect((await call('/sync', { method: 'POST', headers: { 'x-sync-secret': 'sync-test-secret-value' } })).status).toBe(404);
  });

  it('keeps the download route at the root and refuses unknown apps', async () => {
    const response = await call('/dl/does-not-exist/1', { redirect: 'manual' });
    expect(response.status).toBe(404);
  });
});
