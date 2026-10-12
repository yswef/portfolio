/**
 * Authentication: password hashing, one-time codes and the admin HTTP guards.
 * The HTTP tests run the real Hono application against an in-memory D1.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestD1, applyMigrations, type D1Shim } from './helpers/d1';
import { hashPassword, verifyPassword, passwordProblems, generateTotpSecret, generateTotpCode, verifyTotp } from '../src/server/crypto';
import { createSession, createUser, SESSION_COOKIE } from '../src/server/auth';
import { handleRequest } from '../src/api/app';

const SECRET = 'test-session-secret-0123456789abcdef';
const ITERATIONS = 1000;

describe('password hashing', () => {
  it('accepts the right password and rejects any other', async () => {
    const stored = await hashPassword('Correct-Horse-Battery-9', { iterations: ITERATIONS });
    expect(stored.startsWith('pbkdf2$sha256$')).toBe(true);
    expect(await verifyPassword('Correct-Horse-Battery-9', stored)).toBe(true);
    expect(await verifyPassword('correct-horse-battery-9', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('never salts two hashes the same way', async () => {
    const a = await hashPassword('Same-Password-Twice-1', { iterations: ITERATIONS });
    const b = await hashPassword('Same-Password-Twice-1', { iterations: ITERATIONS });
    expect(a).not.toBe(b);
  });

  it('refuses malformed or downgraded stored hashes', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$sha256$10$AAAA$AAAA')).toBe(false);
  });

  it('reports weak passwords', () => {
    expect(passwordProblems('short').length).toBeGreaterThan(0);
    expect(passwordProblems('Quiet-Harbor-Lantern-9').length).toBe(0);
    expect(passwordProblems('Long-enough-Password-1')).toContain('common');
  });
});

describe('one-time codes', () => {
  it('accepts the current code and refuses a replay of the same counter', async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const counter = Math.floor(now / 1000 / 30);
    const code = await generateTotpCode(secret, counter);

    const first = await verifyTotp(secret, code, { now });
    expect(first.valid).toBe(true);

    const replay = await verifyTotp(secret, code, { now, minCounter: first.counter });
    expect(replay.valid).toBe(false);
  });

  it('refuses a wrong code', async () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const real = await generateTotpCode(secret, Math.floor(now / 1000 / 30));
    const wrong = real === '000000' ? '111111' : '000000';
    expect((await verifyTotp(secret, wrong, { now })).valid).toBe(false);
    expect((await verifyTotp(secret, real, { now })).valid).toBe(true);
  });
});

describe('admin HTTP guards', () => {
  let shim: D1Shim;
  let env: Record<string, unknown>;

  const call = (path: string, init: RequestInit = {}, cookie?: string) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    return handleRequest({
      request: new Request(`https://portfolio.test${path}`, { ...init, headers }),
      env: env as never,
    });
  };

  beforeAll(async () => {
    shim = createTestD1();
    applyMigrations(shim.db);
    env = {
      DB: shim.db,
      DOCS: { get: async () => null, put: async () => undefined, delete: async () => undefined },
      SITE_URL: 'https://portfolio.test',
      GITHUB_USERNAME: 'yswef',
      SESSION_SECRET: SECRET,
      PBKDF2_ITERATIONS: String(ITERATIONS),
      BOOTSTRAP_TOKEN: 'bootstrap-test-token-value',
    };
  });

  afterAll(() => shim.close());

  it('refuses every admin read without a session, with no data in the body', async () => {
    for (const path of ['/api/admin/projects', '/api/admin/messages', '/api/admin/messages.csv', '/api/admin/analytics/summary', '/api/admin/pages', '/api/admin/settings', '/api/admin/apps', '/api/admin/audit']) {
      const response = await call(path);
      expect(response.status, path).toBe(401);
      expect(response.headers.get('cache-control'), path).toContain('no-store');
      const text = await response.text();
      expect(text, path).not.toMatch(/"(items|messages|projects|pages|settings|apps|rows)"/);
    }
  });

  it('tells a visitor without a session that nobody is signed in', async () => {
    const response = await call('/api/admin/me');
    expect(response.status).toBe(401);
  });

  it('refuses writes without a session, including sync and publish', async () => {
    for (const path of ['/api/admin/sync', '/api/admin/publish', '/api/admin/pages']) {
      const response = await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
    }
  });

  it('refuses first-run setup with a wrong bootstrap token', async () => {
    const response = await call('/api/admin/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'Long-enough-Password-1', bootstrapSecret: 'guess' }),
    });
    expect(response.status).toBe(403);
  });

  it('requires a CSRF token on writes from a fully signed-in session', async () => {
    const userId = await createUser(env as never, { username: 'owner', password: 'Long-enough-Password-1', iterations: ITERATIONS });
    const { cookie } = await createSession(env as never, {
      userId,
      stage: 'full',
      meta: { ip: '203.0.113.7', country: 'YE', countryName: 'Yemen', city: 'Sanaa', region: null, userAgent: 'test', device: 'desktop', browser: 'x' } as never,
      ipHash: null,
    });
    const sessionCookie = cookie.split(';')[0]!;
    expect(sessionCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    const me = await call('/api/admin/me', {}, sessionCookie);
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { csrfToken: string | null };
    expect(typeof meBody.csrfToken).toBe('string');

    const withoutToken = await call('/api/admin/projects/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [1], action: 'hide' }) }, sessionCookie);
    expect(withoutToken.status).toBe(403);

    const wrongToken = await call(
      '/api/admin/projects/bulk',
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': 'not-the-token' }, body: JSON.stringify({ ids: [1], action: 'hide' }) },
      sessionCookie,
    );
    expect(wrongToken.status).toBe(403);
  });
});
