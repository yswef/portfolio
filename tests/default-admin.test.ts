/**
 * Default administrator: created on the first login attempt, restricted to a
 * password change until the credentials are replaced, and analytics inserts.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestD1, applyMigrations, type D1Shim } from './helpers/d1';
import { handleRequest } from '../src/api/app';
import { BUILTIN_DEFAULT_PASSWORD, BUILTIN_DEFAULT_USERNAME } from '../src/server/auth';

describe('default administrator', () => {
  let shim: D1Shim;
  let env: Record<string, unknown>;

  const call = (path: string, init: RequestInit = {}, cookie?: string, csrf?: string) => {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (cookie) headers.set('cookie', cookie);
    if (csrf) headers.set('x-csrf-token', csrf);
    return handleRequest({
      request: new Request(`https://portfolio.test${path}`, { ...init, headers }),
      env: env as never,
    });
  };
  const post = (path: string, body: unknown, cookie?: string, csrf?: string) =>
    call(path, { method: 'POST', body: JSON.stringify(body) }, cookie, csrf);
  const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

  beforeAll(() => {
    shim = createTestD1();
    applyMigrations(shim.db);
    env = {
      DB: shim.db,
      DOCS: { get: async () => null, put: async () => undefined, delete: async () => undefined },
      SITE_URL: 'https://portfolio.test',
      GITHUB_USERNAME: 'yswef',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
      PBKDF2_ITERATIONS: '12000',
    };
  });
  afterAll(() => shim.close());

  let cookie = '';
  let csrf = '';

  it('rejects a wrong password and creates the account on first attempt', async () => {
    const bad = await post('/api/admin/login', { username: BUILTIN_DEFAULT_USERNAME, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const count = await shim.db.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
    expect(count?.c).toBe(1);
  });

  it('opens a restricted full session with the default credentials', async () => {
    const res = await post('/api/admin/login', { username: BUILTIN_DEFAULT_USERNAME, password: BUILTIN_DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stage: string; csrfToken: string; mustChangePassword: boolean };
    expect(body.stage).toBe('full');
    expect(body.mustChangePassword).toBe(true);
    cookie = cookieOf(res);
    csrf = body.csrfToken;
  });

  it('blocks everything except /me and /password while the default password is in use', async () => {
    const me = await call('/api/admin/me', {}, cookie);
    expect(me.status).toBe(200);
    expect(((await me.json()) as any).user.mustChangePassword).toBe(true);
    expect((await call('/api/admin/projects', {}, cookie)).status).toBe(403);
    expect((await call('/api/admin/settings', {}, cookie)).status).toBe(403);
  });

  it('refuses weak, unchanged and malformed replacements', async () => {
    const weak = await post('/api/admin/password', { currentPassword: BUILTIN_DEFAULT_PASSWORD, newPassword: 'short' }, cookie, csrf);
    expect(weak.status).toBe(400);
    const same = await post('/api/admin/password', { currentPassword: BUILTIN_DEFAULT_PASSWORD, newPassword: BUILTIN_DEFAULT_PASSWORD }, cookie, csrf);
    expect(same.status).toBe(400);
    const badName = await post(
      '/api/admin/password',
      { currentPassword: BUILTIN_DEFAULT_PASSWORD, newPassword: 'Str0ng#Secret-Pass', newUsername: 'a b' },
      cookie,
      csrf,
    );
    expect(badName.status).toBe(400);
  });

  it('changes username and password, ends the session, and the new login works', async () => {
    const res = await post(
      '/api/admin/password',
      { currentPassword: BUILTIN_DEFAULT_PASSWORD, newPassword: 'Str0ng#Secret-Pass', newUsername: 'yousef' },
      cookie,
      csrf,
    );
    expect(res.status).toBe(200);
    expect((await call('/api/admin/me', {}, cookie)).status).toBe(401);

    const oldLogin = await post('/api/admin/login', { username: BUILTIN_DEFAULT_USERNAME, password: BUILTIN_DEFAULT_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const login = await post('/api/admin/login', { username: 'yousef', password: 'Str0ng#Secret-Pass' });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { mustChangePassword: boolean; csrfToken: string };
    expect(body.mustChangePassword).toBe(false);
    const full = cookieOf(login);
    expect((await call('/api/admin/settings', {}, full)).status).toBe(200);
  });

  it('records a first page view (analytics insert has matching parameters)', async () => {
    const res = await post('/api/track', { type: 'pageview', path: '/', visitorId: 'a'.repeat(32), sessionId: 'b'.repeat(32), locale: 'ar' });
    // handleRequest swallows errors into a 500, so a parameter mismatch fails here.
    expect(res.status).toBe(200);
    const visits = await shim.db.prepare('SELECT COUNT(*) AS c FROM visits').first<{ c: number }>();
    expect(visits?.c).toBe(1);
  });
});
