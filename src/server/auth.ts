/**
 * Control-panel authentication.
 *
 * Flow
 * ----
 * 1. `POST /api/admin/login` — username + password. On success a *half*
 *    session is created: enough to submit the second factor, nothing else.
 * 2. `POST /api/admin/login/totp` — TOTP code or a recovery code. The session
 *    is promoted to *full* and a CSRF token is issued.
 *
 * Sessions are random 32-byte identifiers stored hashed as the primary key of
 * the `sessions` table, delivered in an HttpOnly + Secure + SameSite=Strict
 * cookie. Every mutation requires the CSRF token that belongs to the session,
 * so a stolen cookie alone is not enough to act on a request. Failed attempts
 * are counted in D1; after five failures the account is locked for 15 minutes.
 */
import {
  generateRecoveryCodes,
  hashPassword,
  sha256Hex,
  openSealedJson,
  randomToken,
  sealJson,
  timingSafeEqual,
  verifyPassword,
  verifyTotp,
} from './crypto';
import { analyticsRetentionDays, type Env } from './env';
import { parseCookies, serializeCookie, type RequestMeta } from './http';

export const SESSION_COOKIE = '__Host-session';
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
export const HALF_SESSION_TTL_SECONDS = 60 * 5; // 5 minutes to finish 2FA
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 60 * 15;

export interface SessionRow {
  id: string;
  user_id: number | null;
  stage: string;
  csrf_token: string;
  ip_hash: string | null;
  user_agent: string | null;
  country: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface AdminUser {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  totp_secret: string | null;
  totp_enabled_at: number | null;
  totp_last_counter: number | null;
  recovery_codes: string[] | null;
  failed_attempts: number;
  locked_until: number | null;
  last_login_at: number | null;
  last_login_country: string | null;
  last_login_ip_hash: string | null;
  must_change_password: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function sessionSecret(env: Env): string {
  return env.SESSION_SECRET ?? 'insecure-development-secret';
}

export function pbkdf2Iterations(env: Env): number {
  const parsed = Number.parseInt(env.PBKDF2_ITERATIONS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : 150_000;
}

/* ----------------------------------------------------------------- sessions */

export interface SessionInfo {
  id: string;
  userId: number | null;
  stage: 'half' | 'full';
  csrfToken: string;
  expiresAt: number;
  country: string | null;
  userAgent: string | null;
}

export async function createSession(
  env: Env,
  options: {
    userId?: number | null;
    stage: 'half' | 'full';
    meta: RequestMeta;
    ipHash: string | null;
    ttlSeconds?: number;
  },
): Promise<{ cookie: string; session: SessionInfo }> {
  const id = randomToken(32);
  const csrfToken = randomToken(24);
  const ttl = options.ttlSeconds ?? (options.stage === 'full' ? SESSION_TTL_SECONDS : HALF_SESSION_TTL_SECONDS);
  const expiresAt = nowSeconds() + ttl;

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, stage, csrf_token, ip_hash, user_agent, country, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await storeKey(id),
      options.userId ?? null,
      options.stage,
      csrfToken,
      options.ipHash,
      options.meta.userAgent?.slice(0, 400) ?? null,
      options.meta.country,
      nowSeconds(),
      nowSeconds(),
      expiresAt,
    )
    .run();

  const cookie = serializeCookie(SESSION_COOKIE, id, {
    maxAge: ttl,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  });

  return {
    cookie,
    session: {
      id,
      userId: options.userId ?? null,
      stage: options.stage,
      csrfToken,
      expiresAt,
      country: options.meta.country,
      userAgent: options.meta.userAgent,
    },
  };
}

/**
 * Session identifiers are stored as a keyed digest: a leaked database dump does
 * not hand out usable cookies.
 */
async function storeKey(id: string): Promise<string> {
  return sha256Hex(`session:${id}`);
}

export async function readSession(env: Env, request: Request): Promise<SessionInfo | null> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const row = await env.DB.prepare(
    `SELECT id, user_id, stage, csrf_token, expires_at, revoked_at, country, user_agent
       FROM sessions WHERE id = ?`,
  )
    .bind(await storeKey(raw))
    .first<SessionRow>();
  if (!row || row.revoked_at) return null;
  if (row.expires_at < nowSeconds()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run();
    return null;
  }
  return {
    id: raw,
    userId: row.user_id,
    stage: row.stage === 'full' ? 'full' : 'half',
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
    country: row.country,
    userAgent: row.user_agent,
  };
}

export async function touchSession(env: Env, session: SessionInfo): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
    .bind(nowSeconds(), await storeKey(session.id))
    .run();
}

export async function promoteSession(
  env: Env,
  sessionId: string,
  userId: number,
  options: { ttlSeconds?: number } = {},
): Promise<string> {
  const csrfToken = randomToken(24);
  await env.DB.prepare(
    `UPDATE sessions SET stage = 'full', user_id = ?, csrf_token = ?, expires_at = ?, last_seen_at = ?
      WHERE id = ?`,
  )
    .bind(
      userId,
      csrfToken,
      nowSeconds() + (options.ttlSeconds ?? SESSION_TTL_SECONDS),
      nowSeconds(),
      await storeKey(sessionId),
    )
    .run();
  return csrfToken;
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ?, expires_at = ? WHERE id = ?')
    .bind(nowSeconds(), nowSeconds(), await storeKey(sessionId))
    .run();
}

export async function revokeAllSessions(env: Env, userId: number): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(nowSeconds(), userId)
    .run();
}

export function clearedSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' });
}

/* -------------------------------------------------------------------- users */

export async function findUser(env: Env, username: string): Promise<AdminUser | null> {
  return env.DB.prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .bind(username.trim())
    .first<AdminUser>();
}

export async function createUser(
  env: Env,
  options: { username: string; password: string; displayName?: string; iterations?: number },
): Promise<number> {
  const passwordHash = await hashPassword(options.password, {
    iterations: options.iterations ?? pbkdf2Iterations(env),
  });
  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
  )
    .bind(options.username.trim(), passwordHash, options.displayName ?? null)
    .run();
  return Number(result.meta.last_row_id ?? 0);
}

export async function setPassword(env: Env, userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password, { iterations: pbkdf2Iterations(env) });
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
  )
    .bind(passwordHash, nowSeconds(), nowSeconds(), userId)
    .run();
}

export async function setUsername(env: Env, userId: number, username: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?')
    .bind(username.trim(), nowSeconds(), userId)
    .run();
}

/** Letters, digits, dot, dash and underscore; 3 to 40 characters. */
export function usernameProblem(username: string): string | null {
  return /^[A-Za-z0-9._-]{3,40}$/.test(username.trim()) ? null : 'invalid_username';
}

export const BUILTIN_DEFAULT_USERNAME = 'admin';
export const BUILTIN_DEFAULT_PASSWORD = 'Change@Me#2026';

/**
 * First run without a command line: while the `users` table is empty, the first
 * login attempt creates a default administrator flagged `must_change_password`.
 * That account has no second factor and can do nothing except change its
 * credentials (see `requireUser` in the admin routes). Disabled with
 * DISABLE_DEFAULT_ADMIN=1.
 */
export async function ensureDefaultAdmin(env: Env): Promise<void> {
  if (env.DISABLE_DEFAULT_ADMIN === '1') return;
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  if ((count?.count ?? 0) > 0) return;
  const username = (env.DEFAULT_ADMIN_USERNAME ?? '').trim() || BUILTIN_DEFAULT_USERNAME;
  const password = env.DEFAULT_ADMIN_PASSWORD || BUILTIN_DEFAULT_PASSWORD;
  try {
    const id = await createUser(env, { username, password });
    await env.DB.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').bind(id).run();
  } catch {
    // A concurrent request created it first (unique username index): nothing to do.
  }
}

export interface LoginResult {
  ok: boolean;
  reason?: 'unknown-user' | 'locked' | 'bad-password';
  lockedUntil?: number;
  user?: AdminUser;
}

export async function attemptPasswordLogin(
  env: Env,
  options: { username: string; password: string; meta: RequestMeta; ipHash: string | null },
): Promise<LoginResult> {
  const user = await findUser(env, options.username);
  const now = nowSeconds();

  if (!user) {
    await logAttempt(env, {
      username: options.username,
      ipHash: options.ipHash,
      stage: 'password',
      success: false,
      reason: 'unknown-user',
      country: options.meta.country,
    });
    // Spend comparable time so the response does not reveal whether the user exists.
    await verifyPassword(options.password, await hashPassword('decoy-password', { iterations: 12_000 }));
    return { ok: false, reason: 'unknown-user' };
  }

  if (user.locked_until && user.locked_until > now) {
    await logAttempt(env, {
      username: user.username,
      ipHash: options.ipHash,
      stage: 'password',
      success: false,
      reason: 'locked',
      country: options.meta.country,
    });
    return { ok: false, reason: 'locked', lockedUntil: user.locked_until };
  }

  const valid = await verifyPassword(options.password, user.password_hash);
  if (!valid) {
    const failed = (user.failed_attempts ?? 0) + 1;
    const lockedUntil = failed >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_SECONDS : null;
    await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(lockedUntil ? 0 : failed, lockedUntil, now, user.id)
      .run();
    await logAttempt(env, {
      username: user.username,
      ipHash: options.ipHash,
      stage: 'password',
      success: false,
      reason: 'bad-password',
      country: options.meta.country,
    });
    return { ok: false, reason: 'bad-password', lockedUntil: lockedUntil ?? undefined };
  }

  await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
  await logAttempt(env, {
    username: user.username,
    ipHash: options.ipHash,
    stage: 'password',
    success: true,
    country: options.meta.country,
  });
  return { ok: true, user };
}

export interface SecondFactorResult {
  ok: boolean;
  reason?: 'bad-code' | 'not-enrolled' | 'reused';
  recoveryCodeUsed?: boolean;
  counter?: number;
}

export async function verifySecondFactor(
  env: Env,
  user: AdminUser,
  code: string,
  now = Date.now(),
): Promise<SecondFactorResult> {
  if (!user.totp_secret || !user.totp_enabled_at) return { ok: false, reason: 'not-enrolled' };

  const secret = await openSealedJson<{ secret: string }>(sessionSecret(env), user.totp_secret, 'totp');
  if (!secret?.secret) return { ok: false, reason: 'not-enrolled' };

  const trimmed = code.trim().toUpperCase();
  if (/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(trimmed)) {
    const codes = [...(user.recovery_codes ?? [])];
    for (let i = 0; i < codes.length; i += 1) {
      const stored = codes[i];
      if (!stored) continue;
      if (await verifyPassword(trimmed, stored)) {
        // Single use only: the matching entry is removed straight away.
        codes[i] = '';
        await env.DB.prepare('UPDATE users SET recovery_codes = ?, last_login_at = ?, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(codes.filter(Boolean)), nowSeconds(), nowSeconds(), user.id)
          .run();
        return { ok: true, recoveryCodeUsed: true };
      }
    }
    return { ok: false, reason: 'bad-code' };
  }

  const result = await verifyTotp(secret.secret, trimmed, {
    now,
    minCounter: user.totp_last_counter ?? undefined,
  });
  if (!result.valid) return { ok: false, reason: result.counter && user.totp_last_counter && result.counter <= user.totp_last_counter ? 'reused' : 'bad-code' };

  await env.DB.prepare('UPDATE users SET totp_last_counter = ?, last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(result.counter ?? null, nowSeconds(), nowSeconds(), user.id)
    .run();
  return { ok: true, counter: result.counter };
}

export async function enrollTotp(env: Env, userId: number, secret: string): Promise<string[]> {
  const sealed = await sealJson(sessionSecret(env), { secret }, 'totp');
  const codes = generateRecoveryCodes(8);
  const hashed: string[] = [];
  for (const code of codes) hashed.push(await hashPassword(code, { iterations: 20_000 }));
  await env.DB.prepare(
    'UPDATE users SET totp_secret = ?, totp_enabled_at = ?, recovery_codes = ?, updated_at = ? WHERE id = ?',
  )
    .bind(sealed, nowSeconds(), JSON.stringify(hashed), nowSeconds(), userId)
    .run();
  return codes;
}

export async function storePendingTotpSecret(env: Env, userId: number, secret: string): Promise<void> {
  const sealed = await sealJson(sessionSecret(env), { secret }, 'totp');
  await env.DB.prepare('UPDATE users SET totp_secret = ?, totp_enabled_at = NULL, updated_at = ? WHERE id = ?')
    .bind(sealed, nowSeconds(), userId)
    .run();
}

async function logAttempt(
  env: Env,
  entry: {
    username: string | null;
    ipHash: string | null;
    stage: string;
    success: boolean;
    reason?: string;
    country: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO login_attempts (username, ip_hash, stage, success, reason, country) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(entry.username, entry.ipHash, entry.stage, entry.success ? 1 : 0, entry.reason ?? null, entry.country)
    .run();
}

export function isAdminPath(env: Env, pathname: string): boolean {
  const admin = (env.ADMIN_PATH ?? 'control-panel').replace(/^\/+|\/+$/g, '');
  return pathname === `/${admin}` || pathname.startsWith(`/${admin}/`);
}

/* ---------------------------------------------------------------- audit log */

export async function audit(
  env: Env,
  entry: {
    userId?: number | null;
    action: string;
    entity?: string;
    entityId?: string | number;
    meta?: Record<string, unknown>;
    ipHash?: string | null;
    country?: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, meta, ip_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      entry.userId ?? null,
      entry.action,
      entry.entity ?? null,
      entry.entityId !== undefined ? String(entry.entityId) : null,
      entry.meta ? JSON.stringify(entry.meta) : null,
      entry.ipHash ?? null,
      entry.country ?? null,
    )
    .run();
}

/** Removes expired sessions, stale oauth states and old telemetry. */
export async function cleanupAuth(env: Env): Promise<void> {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM rate_limits WHERE updated_at < ?').bind(now - 86_400),
    env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(now - 60 * 60 * 24 * 90),
    env.DB.prepare('DELETE FROM visits WHERE last_seen_at < ?').bind(
      now - analyticsRetentionDays(env) * 86_400,
    ),
    env.DB.prepare('DELETE FROM pageviews WHERE created_at < ?').bind(
      now - analyticsRetentionDays(env) * 86_400,
    ),
    env.DB.prepare('DELETE FROM downloads WHERE created_at < ?').bind(
      now - analyticsRetentionDays(env) * 86_400,
    ),
    env.DB.prepare('DELETE FROM oauth_states WHERE consumed_at IS NOT NULL AND created_at < ?').bind(now - 3600),
  ]);
}

export function csrfValid(session: SessionInfo, provided: string | null): boolean {
  return Boolean(provided && timingSafeEqual(session.csrfToken, provided));
}
