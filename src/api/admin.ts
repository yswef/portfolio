/**
 * Control-panel API.
 *
 * Access rules
 * ------------
 * - `POST /api/admin/login` is the only route reachable without a session, and
 *   it is rate limited per address and per account, with a temporary lockout.
 * - Everything else needs a *full* session (password + second factor).
 * - Every mutating request must carry the session's CSRF token in the
 *   `x-csrf-token` header — a leaked cookie on its own is not enough.
 */
import { Hono } from 'hono';
import {
  audit,
  attemptPasswordLogin,
  createSession,
  csrfValid,
  clearedSessionCookie,
  enrollTotp,
  ensureDefaultAdmin,
  findUser,
  isAdminPath,
  pbkdf2Iterations,
  promoteSession,
  readSession,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
  sessionSecret,
  setPassword,
  setUsername,
  storePendingTotpSecret,
  usernameProblem,
  verifySecondFactor,
  type AdminUser,
  type SessionInfo,
} from '../server/auth';
import {
  generateTotpSecret,
  openSealedJson,
  otpauthUrl,
  passwordProblems,
  randomBase64Url,
  verifyTotp,
} from '../server/crypto';
import { adminPath, analyticsRetentionDays, siteUrl, type Env } from '../server/env';
import {
  fail,
  enforceRateLimit,
  json,
  ok,
  readJson,
  requestMeta,
  responseWithCookies,
  securityHeaders,
  withHeaders,
} from '../server/http';
import { analyticsSummary, visitorList, visitTimeline } from '../server/analytics';
import { COLLECTIONS, MESSAGE_FIELDS, PAGE_FIELDS, PROJECT_FIELDS, SETTINGS_KEYS, ASSET_FIELDS } from '../server/collections';
import { renderMarkdown } from '../server/markdown';
import { buildSnapshot } from '../server/snapshot';
import { publishSnapshot, recentSyncRuns, runSync } from '../server/sync';
import { apiToRow, rowToApi, rowsToApi, toColumn } from '../server/rows';
import { extractArchive } from '../server/zip';
import { validateRow, type Row } from '../server/validate';
import { deletePage, getPage, pageFileList, replacePageFiles, createPage, type UploadFile } from '../server/pages';
import { GitHubClient } from '../server/github';
import { appDownloadStats } from '../server/downloads';
import { pruneAnalytics } from '../server/analytics';
import type { SettingsKey } from '../server/collections';

type Vars = { session: SessionInfo; user: AdminUser | null; env: Env };

export function createAdminRoutes() {
  const admin = new Hono<{ Bindings: Env; Variables: Vars }>();

  /* -------------------------------------------------------------- session */

  /** Guard helper used by every protected route. */
  async function requireUser(
    c: any,
    options: { stage?: 'full' | 'half'; allowPendingPasswordChange?: boolean } = {},
  ) {
    const env = c.env as Env;
    const session = await readSession(env, c.req.raw);
    if (!session) return { error: fail(401, 'unauthenticated') as Response, session: null, user: null };
    if ((options.stage ?? 'full') === 'full' && session.stage !== 'full') {
      return { error: fail(401, 'second_factor_required') as Response, session, user: null };
    }
    let user: AdminUser | null = null;
    if (session.userId) user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.userId).first<AdminUser>();
    if (!user) return { error: fail(401, 'unauthenticated') as Response, session, user: null };
    // Default credentials: the account may only change its password and name.
    if (user.must_change_password && !options.allowPendingPasswordChange) {
      return { error: fail(403, 'password_change_required') as Response, session, user: null };
    }
    return { error: null, session, user };
  }

  async function requireCsrf(c: any, session: SessionInfo) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return null;
    const token = c.req.header('x-csrf-token') ?? null;
    if (!csrfValid(session, token)) return fail(403, 'csrf') as Response;
    return null;
  }

  /* ----------------------------------------------------------------- login */

  admin.post('/login', async (c) => {
    const env = c.env as Env;
    const body = (await readJson<{ username?: string; password?: string }>(c.req.raw)) ?? {};
    const meta = requestMeta(c.req.raw);
    const cell = meta.ip ?? 'unknown';

    const limit = await enforceRateLimit(env.DB, { key: `login:${cell}`, limit: 10, windowSeconds: 900 });
    if (!limit.allowed) {
      return fail(429, 'too_many_attempts', { retryAfter: limit.retryAfterSeconds });
    }
    if (!body.username || !body.password) return fail(400, 'missing_credentials');

    await ensureDefaultAdmin(env);
    const result = await attemptPasswordLogin(env, {
      username: String(body.username).slice(0, 120),
      password: String(body.password).slice(0, 400),
      meta,
      ipHash: null,
    });

    if (!result.ok) {
      const message =
        result.reason === 'locked'
          ? 'account_locked'
          : result.reason === 'unknown-user'
            ? 'invalid_credentials'
            : 'invalid_credentials';
      return fail(401, message, { lockedUntil: result.lockedUntil ?? null });
    }

    const user = result.user!;
    if (!user.totp_enabled_at || !user.totp_secret) {
      // No second factor enrolled (for example the default account): the password
      // alone opens a full session. Enable 2FA from the Security screen.
      const full = await createSession(env, { userId: user.id, stage: 'full', meta, ipHash: null });
      await env.DB.prepare(
        'UPDATE users SET last_login_at = unixepoch(), last_login_country = ?, updated_at = unixepoch() WHERE id = ?',
      )
        .bind(meta.country, user.id)
        .run();
      await audit(env, { userId: user.id, action: 'login.success_no2fa', entity: 'user', entityId: user.id, country: meta.country });
      return responseWithCookies(
        JSON.stringify({
          ok: true,
          stage: 'full',
          csrfToken: full.session.csrfToken,
          expiresAt: full.session.expiresAt,
          mustChangePassword: Boolean(user.must_change_password),
        }),
        [full.cookie],
        { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }

    const { cookie, session } = await createSession(env, {
      userId: user.id,
      stage: 'half',
      meta,
      ipHash: null,
    });

    return responseWithCookies(
      JSON.stringify({ ok: true, stage: 'half', expiresAt: session.expiresAt }),
      [cookie],
      { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    );
  });

  admin.post('/login/totp', async (c) => {
    const env = c.env as Env;
    const session = await readSession(env, c.req.raw);
    if (!session) return fail(401, 'unauthenticated');
    if (session.stage !== 'half') return fail(400, 'stage_mismatch');

    const body = (await readJson<{ code?: string }>(c.req.raw)) ?? {};
    const meta = requestMeta(c.req.raw);
    const limit = await enforceRateLimit(env.DB, {
      key: `totp:${meta.ip ?? 'unknown'}:${session.id.slice(0, 8)}`,
      limit: 8,
      windowSeconds: 600,
    });
    if (!limit.allowed) return fail(429, 'too_many_attempts', { retryAfter: limit.retryAfterSeconds });

    const user = session.userId
      ? await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.userId).first<AdminUser>()
      : null;
    if (!user) return fail(401, 'unauthenticated');

    const result = await verifySecondFactor(env, user, String(body.code ?? ''));
    if (!result.ok) {
      await audit(env, { userId: user.id, action: 'login.2fa_failed', entity: 'user', entityId: user.id, country: meta.country });
      return fail(401, result.reason === 'reused' ? 'code_reused' : 'invalid_code');
    }

    const csrf = await promoteSession(env, session.id, user.id);
    await env.DB.prepare(
      'UPDATE users SET last_login_at = unixepoch(), last_login_country = ?, updated_at = unixepoch() WHERE id = ?',
    )
      .bind(meta.country, user.id)
      .run();
    await audit(env, {
      userId: user.id,
      action: result.recoveryCodeUsed ? 'login.recovery_code' : 'login.success',
      entity: 'user',
      entityId: user.id,
      country: meta.country,
    });

    return ok({ stage: 'full', csrfToken: csrf, recoveryCodeUsed: Boolean(result.recoveryCodeUsed) });
  });

  admin.post('/logout', async (c) => {
    const env = c.env as Env;
    const session = await readSession(env, c.req.raw);
    if (session) await revokeSession(env, session.id);
    return responseWithCookies(JSON.stringify({ ok: true }), [clearedSessionCookie()], {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  });

  admin.get('/me', async (c) => {
    const { error, session, user } = await requireUser(c, { stage: 'half', allowPendingPasswordChange: true });
    if (error) return error;
    return ok({
      stage: session?.stage,
      csrfToken: session?.stage === 'full' ? session.csrfToken : null,
      user: user
        ? {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            totpEnabled: Boolean(user.totp_enabled_at),
            mustChangePassword: Boolean(user.must_change_password),
            lastLoginAt: user.last_login_at,
            lastLoginCountry: user.last_login_country,
          }
        : null,
      siteUrl: siteUrl(c.env as Env),
      adminPath: adminPath(c.env as Env),
      environment: {
        turnstile: Boolean((c.env as Env).TURNSTILE_SECRET),
        githubToken: Boolean((c.env as Env).GITHUB_TOKEN),
        webhookSecret: Boolean((c.env as Env).GITHUB_WEBHOOK_SECRET),
        snapshotPublishing: (c.env as Env).PUBLISH_SNAPSHOT !== '0',
        pbkdf2Iterations: pbkdf2Iterations(c.env as Env),
        analyticsRetentionDays: analyticsRetentionDays(c.env as Env),
      },
    });
  });

  /* ------------------------------------------------------------ first run */

  /**
   * Creates the very first administrator. Only works while the `users` table is
   * empty and requires the bootstrap secret printed by `npm run admin:create`,
   * so a stranger cannot claim a fresh deployment.
   */
  admin.post('/bootstrap', async (c) => {
    const env = c.env as Env;
    const body = (await readJson<{ username?: string; password?: string; bootstrapSecret?: string }>(c.req.raw)) ?? {};
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
    if ((count?.count ?? 0) > 0) return fail(403, 'already_initialised');

    // The first administrator can only be created while the table is empty and
    // with the one-time token that was set as BOOTSTRAP_TOKEN.
    const expected = env.BOOTSTRAP_TOKEN;
    if (!expected) return fail(403, 'bootstrap_disabled');
    if (!body.bootstrapSecret || body.bootstrapSecret !== expected) return fail(403, 'invalid_bootstrap_secret');
    if (!body.username || !body.password) return fail(400, 'missing_credentials');
    const problems = passwordProblems(String(body.password));
    if (problems.length) return fail(400, 'weak_password', { problems });

    const { createUser } = await import('../server/auth');
    const userId = await createUser(env, {
      username: String(body.username),
      password: String(body.password),
      iterations: pbkdf2Iterations(env),
    });
    const secret = generateTotpSecret();
    const codes = await enrollTotp(env, userId, secret);
    const issuer = 'Portfolio';
    return ok({
      userId,
      totpSecret: secret,
      otpauthUrl: otpauthUrl({ secret, account: String(body.username), issuer }),
      recoveryCodes: codes,
    });
  });

  /* --------------------------------------------------------- second factor */

  admin.post('/2fa/setup', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const secret = generateTotpSecret();
    await storePendingTotpSecret(c.env as Env, user.id, secret);
    return ok({
      totpSecret: secret,
      otpauthUrl: otpauthUrl({ secret, account: user.username, issuer: 'Portfolio' }),
    });
  });

  admin.post('/2fa/enable', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const body = (await readJson<{ code?: string }>(c.req.raw)) ?? {};
    const pending = user.totp_secret
      ? await openSealedJson<{ secret: string }>(sessionSecret(c.env as Env), user.totp_secret, 'totp')
      : null;
    if (!pending?.secret) return fail(400, 'start_setup_first');

    const check = await verifyTotp(pending.secret, String(body.code ?? ''), { window: 1 });
    if (!check.valid) return fail(400, 'invalid_code');

    const codes = await enrollTotp(c.env as Env, user.id, pending.secret);
    await audit(c.env as Env, { userId: user.id, action: '2fa.enabled', entity: 'user', entityId: user.id });
    return ok({ recoveryCodes: codes });
  });

  admin.post('/2fa/disable', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const body = (await readJson<{ code?: string; password?: string }>(c.req.raw)) ?? {};
    const { verifyPassword } = await import('../server/crypto');
    if (!body.password || !(await verifyPassword(String(body.password), user.password_hash))) {
      return fail(401, 'invalid_password');
    }
    const stored = user.totp_secret
      ? await openSealedJson<{ secret: string }>(sessionSecret(c.env as Env), user.totp_secret, 'totp')
      : null;
    if (stored?.secret) {
      const check = await verifyTotp(stored.secret, String(body.code ?? ''), { window: 1 });
      if (!check.valid) return fail(400, 'invalid_code');
    }
    await (c.env as Env).DB.prepare(
      'UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, recovery_codes = ?, updated_at = unixepoch() WHERE id = ?',
    )
      .bind(JSON.stringify([]), user.id)
      .run();
    await audit(c.env as Env, { userId: user.id, action: '2fa.disabled', entity: 'user', entityId: user.id });
    return ok({ disabled: true });
  });

  admin.post('/password', async (c) => {
    const { error, session, user } = await requireUser(c, { allowPendingPasswordChange: true });
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const body =
      (await readJson<{ currentPassword?: string; newPassword?: string; newUsername?: string }>(c.req.raw)) ?? {};
    const { verifyPassword } = await import('../server/crypto');
    if (!body.currentPassword || !(await verifyPassword(String(body.currentPassword), user.password_hash))) {
      return fail(401, 'invalid_password');
    }
    const newPassword = String(body.newPassword ?? '');
    const problems = passwordProblems(newPassword);
    if (problems.length) return fail(400, 'weak_password', { problems });
    if (newPassword === String(body.currentPassword)) return fail(400, 'same_password');

    // Optional rename (letters, digits, . _ -), checked before anything is written.
    const newUsername = String(body.newUsername ?? '').trim();
    const renaming = newUsername !== '' && newUsername.toLowerCase() !== user.username.toLowerCase();
    if (newUsername !== '' && usernameProblem(newUsername)) return fail(400, 'invalid_username');
    if (renaming && (await findUser(c.env as Env, newUsername))) return fail(409, 'username_taken');

    await setPassword(c.env as Env, user.id, newPassword);
    if (newUsername !== '' && newUsername !== user.username) await setUsername(c.env as Env, user.id, newUsername);
    await revokeAllSessions(c.env as Env, user.id);
    await audit(c.env as Env, {
      userId: user.id,
      action: 'password.changed',
      entity: 'user',
      entityId: user.id,
      meta: renaming ? { renamed: true } : undefined,
    });
    return responseWithCookies(JSON.stringify({ ok: true, reauthenticate: true }), [clearedSessionCookie()], {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  });

  /* --------------------------------------------------------------- project */

  admin.get('/projects', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const query = c.req.query();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.q) {
      where.push('(name LIKE ? OR full_name LIKE ? OR description LIKE ? OR topics LIKE ?)');
      const like = `%${query.q}%`;
      params.push(like, like, like, like);
    }
    if (query.visibility === 'visible') where.push('visible = 1');
    if (query.visibility === 'hidden') where.push('visible = 0');
    if (query.category) {
      where.push('category = ?');
      params.push(query.category);
    }
    if (query.docs) {
      where.push('doc_mode = ?');
      params.push(query.docs);
    }
    const rows = await env.DB.prepare(
      `SELECT * FROM projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY pinned DESC, featured DESC, sort_order ASC, COALESCE(repo_pushed_at, '') DESC
        LIMIT 300`,
    )
      .bind(...params)
      .all();
    return ok({ projects: (rows.results ?? []).map((row) => rowToApi(row as Row)) });
  });

  admin.patch('/projects/:id', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    const body = (await readJson(c.req.raw)) ?? {};
    const result = validateRow(body, PROJECT_FIELDS, { partial: true });
    if (!result.ok) return fail(400, 'validation_failed', { errors: result.errors });

    const columns: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(result.row)) {
      columns.push(`${toColumn(field)} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    // Manual decisions must survive the next sync.
    if ('docMode' in result.row) columns.push('doc_mode_overridden = 1');
    if ('category' in result.row) columns.push('category_overridden = 1');
    if (!columns.length) return ok({ updated: false });
    columns.push('updated_at = unixepoch()');

    await env.DB.prepare(`UPDATE projects SET ${columns.join(', ')} WHERE id = ?`)
      .bind(...values, id)
      .run();
    await audit(env, { userId: user.id, action: 'project.update', entity: 'project', entityId: id, meta: result.row });
    return ok({ updated: true });
  });

  admin.post('/projects/bulk', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const body = (await readJson<{ ids?: number[]; action?: string; value?: unknown }>(c.req.raw)) ?? {};
    const ids = (body.ids ?? []).map(Number).filter(Number.isFinite).slice(0, 200);
    if (!ids.length) return fail(400, 'no_ids');
    const placeholders = ids.map(() => '?').join(',');

    switch (body.action) {
      case 'show':
        await env.DB.prepare(`UPDATE projects SET visible = 1, updated_at = unixepoch() WHERE id IN (${placeholders})`)
          .bind(...ids)
          .run();
        break;
      case 'hide':
        await env.DB.prepare(`UPDATE projects SET visible = 0, updated_at = unixepoch() WHERE id IN (${placeholders})`)
          .bind(...ids)
          .run();
        break;
      case 'feature':
        await env.DB.prepare(`UPDATE projects SET featured = 1, updated_at = unixepoch() WHERE id IN (${placeholders})`)
          .bind(...ids)
          .run();
        break;
      case 'unfeature':
        await env.DB.prepare(`UPDATE projects SET featured = 0, updated_at = unixepoch() WHERE id IN (${placeholders})`)
          .bind(...ids)
          .run();
        break;
      case 'category': {
        const category = String(body.value ?? 'other').slice(0, 30);
        await env.DB.prepare(
          `UPDATE projects SET category = ?, category_overridden = 1, updated_at = unixepoch() WHERE id IN (${placeholders})`,
        )
          .bind(category, ...ids)
          .run();
        break;
      }
      case 'docMode': {
        const mode = String(body.value ?? 'readme');
        await env.DB.prepare(
          `UPDATE projects SET doc_mode = ?, doc_mode_overridden = 1, updated_at = unixepoch() WHERE id IN (${placeholders})`,
        )
          .bind(mode, ...ids)
          .run();
        break;
      }
      case 'order': {
        const order = Number(body.value ?? 0);
        await env.DB.prepare(`UPDATE projects SET sort_order = ?, updated_at = unixepoch() WHERE id IN (${placeholders})`)
          .bind(order, ...ids)
          .run();
        break;
      }
      default:
        return fail(400, 'unknown_action');
    }

    await audit(env, { userId: user.id, action: `project.bulk.${body.action}`, entity: 'project', meta: { ids } });
    return ok({ updated: ids.length });
  });

  /* --------------------------------------------------------- generic CRUD */

  admin.get('/collection/:name', async (c) => {
    const { error, user } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const name = c.req.param('name')!;
    if (name === 'messages') return messagesList(c as any, true);
    const spec = COLLECTIONS[name];
    if (!spec) return fail(404, 'unknown_collection');

    const query = c.req.query();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.q && spec.searchColumns.length) {
      where.push(`(${spec.searchColumns.map((column) => `${column} LIKE ?`).join(' OR ')})`);
      for (const _ of spec.searchColumns) params.push(`%${query.q}%`);
    }
    if (query.visibility === 'visible') where.push('visible = 1');
    if (query.visibility === 'hidden') where.push('visible = 0');

    const rows = await env.DB.prepare(
      `SELECT * FROM ${spec.table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${spec.orderBy} LIMIT 500`,
    )
      .bind(...params)
      .all();
    void user;
    return ok({ items: rowsToApi((rows.results ?? []) as Record<string, unknown>[], spec), collection: name, spec: publicSpec(spec) });
  });

  admin.post('/collection/:name', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const name = c.req.param('name')!;
    const spec = COLLECTIONS[name];
    if (!spec) return fail(404, 'unknown_collection');

    const body = (await readJson(c.req.raw)) ?? {};
    const result = validateRow(body, spec.fields);
    if (!result.ok) return fail(400, 'validation_failed', { errors: result.errors });

    if (name === 'posts' && typeof result.row.publishedAt === 'number' && result.row.publishedAt > 0) {
      result.row.status = result.row.status ?? 'published';
    }
    if (name === 'posts' && result.row.status === 'published' && !result.row.publishedAt) {
      result.row.publishedAt = Math.floor(Date.now() / 1000);
    }

    const { columns, values } = apiToRow(result.row, spec);
    columns.push('created_at', 'updated_at');
    const statement = env.DB.prepare(
      `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}, unixepoch(), unixepoch())`,
    ).bind(...values);
    const inserted = await statement.run();
    const id = Number(inserted.meta.last_row_id ?? 0);
    await audit(env, { userId: user.id, action: `${name}.create`, entity: name, entityId: id });
    return ok({ id });
  });

  admin.patch('/collection/:name/:id', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const name = c.req.param('name')!;
    const spec = COLLECTIONS[name];
    if (!spec) return fail(404, 'unknown_collection');
    const id = Number(c.req.param('id'));

    const body = (await readJson(c.req.raw)) ?? {};
    const result = validateRow(body, spec.fields, { partial: true });
    if (!result.ok) return fail(400, 'validation_failed', { errors: result.errors });
    if (spec.syncManaged) {
      for (const field of spec.syncManaged) delete result.row[field];
    }

    const { columns, values } = apiToRow(result.row, spec, { partial: true });
    const assignments = columns.map((column) => `${column} = ?`);
    if (!assignments.length) return ok({ updated: false });
    assignments.push('updated_at = unixepoch()');

    await env.DB.prepare(`UPDATE ${spec.table} SET ${assignments.join(', ')} WHERE ${spec.idColumn} = ?`)
      .bind(...values, id)
      .run();
    await audit(env, { userId: user.id, action: `${name}.update`, entity: name, entityId: id, meta: result.row });
    return ok({ updated: true });
  });

  admin.delete('/collection/:name/:id', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const name = c.req.param('name')!;
    const spec = COLLECTIONS[name];
    if (!spec) return fail(404, 'unknown_collection');
    const id = Number(c.req.param('id'));

    await env.DB.prepare(`DELETE FROM ${spec.table} WHERE ${spec.idColumn} = ?`).bind(id).run();
    await audit(env, { userId: user.id, action: `${name}.delete`, entity: name, entityId: id });
    return ok({ deleted: true });
  });

  /* ---------------------------------------------------------------- apps */

  admin.get('/apps', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const apps = await env.DB.prepare('SELECT * FROM apps ORDER BY featured DESC, sort_order ASC, name ASC').all();
    const assets = await env.DB.prepare(
      'SELECT * FROM app_assets ORDER BY is_current DESC, release_published_at DESC, id DESC LIMIT 500',
    ).all();
    const projects = await env.DB.prepare('SELECT id, slug, full_name, stars, html_url, doc_mode FROM projects').all();
    return ok({
      apps: (apps.results ?? []).map((row) => rowToApi(row as Row, COLLECTIONS.apps)),
      assets: assets.results ?? [],
      projects: projects.results ?? [],
    });
  });

  admin.patch('/assets/:id', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    const body = (await readJson(c.req.raw)) ?? {};
    const result = validateRow(body, ASSET_FIELDS, { partial: true });
    if (!result.ok) return fail(400, 'validation_failed', { errors: result.errors });

    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(result.row)) {
      assignments.push(`${toColumn(field)} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (!assignments.length) return ok({ updated: false });
    assignments.push('updated_at = unixepoch()');
    await env.DB.prepare(`UPDATE app_assets SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...values, id)
      .run();
    await audit(env, { userId: user.id, action: 'asset.update', entity: 'asset', entityId: id, meta: result.row });
    return ok({ updated: true });
  });

  admin.post('/apps/:id/dismiss', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;
    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    await env.DB.prepare('UPDATE apps SET dismissed = 1, visible = 0, updated_at = unixepoch() WHERE id = ?')
      .bind(id)
      .run();
    await audit(env, { userId: user.id, action: 'app.dismiss', entity: 'app', entityId: id });
    return ok({ dismissed: true });
  });

  admin.get('/apps/:id/stats', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    const stats = await appDownloadStats(env, id);
    const daily = await env.DB.prepare(
      `SELECT date(created_at, 'unixepoch') AS date, COUNT(*) AS count FROM downloads
        WHERE app_id = ? AND created_at >= ? GROUP BY date ORDER BY date ASC`,
    )
      .bind(id, Math.floor(Date.now() / 1000) - 90 * 86_400)
      .all();
    return ok({ ...stats, daily: daily.results ?? [] });
  });

  /* -------------------------------------------------------------- settings */

  admin.get('/settings', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const rows = await env.DB.prepare('SELECT key, value, updated_at FROM settings').all();
    return ok({ settings: rows.results ?? [] });
  });

  admin.put('/settings/:key', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const key = c.req.param('key') as SettingsKey;
    if (!SETTINGS_KEYS.includes(key)) return fail(400, 'unknown_settings_key');
    const body = (await readJson<Record<string, unknown>>(c.req.raw)) ?? {};
    const serialized = JSON.stringify(body);
    if (serialized.length > 60_000) return fail(413, 'too_large');

    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    )
      .bind(key, serialized)
      .run();
    await audit(env, { userId: user.id, action: 'settings.update', entity: 'settings', entityId: key });
    return ok({ saved: true });
  });

  /* --------------------------------------------------------------- content */

  admin.get('/pages', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const rows = await env.DB.prepare('SELECT * FROM pages ORDER BY sort_order ASC, id ASC').all();
    return ok({ pages: rows.results ?? [] });
  });

  admin.get('/pages/:slug/files', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const page = await getPage(env, c.req.param('slug')!);
    if (!page) return fail(404, 'not_found');
    return ok({ page, files: await pageFileList(env, page) });
  });

  admin.patch('/pages/:slug', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const page = await getPage(env, c.req.param('slug')!);
    if (!page) return fail(404, 'not_found');
    const body = (await readJson(c.req.raw)) ?? {};
    const result = validateRow(body, PAGE_FIELDS, { partial: true });
    if (!result.ok) return fail(400, 'validation_failed', { errors: result.errors });

    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(result.row)) {
      if (field === 'slug') continue;
      const column = toColumn(field);
      assignments.push(`${column} = ?`);
      values.push(Array.isArray(value) ? JSON.stringify(value) : value);
    }
    if (!assignments.length) return ok({ updated: false });
    assignments.push('updated_at = unixepoch()');
    await env.DB.prepare(`UPDATE pages SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...values, page.id)
      .run();
    await audit(env, { userId: user.id, action: 'page.update', entity: 'page', entityId: page.id, meta: result.row });
    return ok({ updated: true });
  });

  /**
   * Upload endpoint. The panel sends JSON: either plain text files (already
   * unpacked from a ZIP in the browser) or base64 for binary assets.
   */
  admin.post('/pages', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const body = (await readJson<{
      slug?: string;
      title?: string;
      titleAr?: string;
      summary?: string;
      summaryAr?: string;
      visibility?: 'private' | 'public';
      entry?: string;
      source?: 'upload' | 'zip' | 'manual';
      files?: { path: string; text?: string; base64?: string }[];
    }>(c.req.raw)) ?? {};

    if (!body.title) return fail(400, 'missing_title');
    let files = decodeUpload(body.files ?? []);
    if (body.source === 'zip') {
      // A zip is unpacked here so folder structure and binary assets survive.
      const archive = files.find((file) => file.path.toLowerCase().endsWith('.zip') && file.bytes);
      if (!archive?.bytes) return fail(400, 'no_zip');
      try {
        files = await extractArchive(archive.bytes.buffer as ArrayBuffer);
      } catch (zipError) {
        return fail(400, zipError instanceof Error && zipError.message.startsWith('zip_') ? zipError.message : 'bad_zip');
      }
    }
    if (!files.length) return fail(400, 'no_files');

    try {
      const created = await createPage(
        env,
        {
          slug: body.slug,
          title: body.title,
          titleAr: body.titleAr,
          summary: body.summary,
          summaryAr: body.summaryAr,
          visibility: body.visibility === 'public' ? 'public' : 'private',
          entry: body.entry,
          source: body.source ?? 'upload',
        },
        files,
      );
      await audit(env, {
        userId: user.id,
        action: 'page.create',
        entity: 'page',
        entityId: created.page.id,
        meta: { files: created.written },
      });
      return ok({ page: created.page, written: created.written });
    } catch (uploadError) {
      const code = uploadError instanceof Error ? uploadError.message : 'upload_failed';
      return fail(400, code);
    }
  });

  admin.post('/pages/:slug/files', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const page = await getPage(env, c.req.param('slug')!);
    if (!page) return fail(404, 'not_found');
    const body = (await readJson<{ files?: { path: string; text?: string; base64?: string }[] }>(c.req.raw)) ?? {};
    const files = decodeUpload(body.files ?? []);
    if (!files.length) return fail(400, 'no_files');
    try {
      const result = await replacePageFiles(env, page, files);
      await audit(env, { userId: user.id, action: 'page.files', entity: 'page', entityId: page.id, meta: result });
      return ok(result);
    } catch (uploadError) {
      return fail(400, uploadError instanceof Error ? uploadError.message : 'upload_failed');
    }
  });

  admin.delete('/pages/:slug', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const page = await getPage(env, c.req.param('slug')!);
    if (!page) return fail(404, 'not_found');
    await deletePage(env, page);
    await audit(env, { userId: user.id, action: 'page.delete', entity: 'page', entityId: page.id });
    return ok({ deleted: true });
  });

  /* -------------------------------------------------------------- messages */

  admin.get('/messages', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    return messagesList(c as any, false);
  });

  admin.patch('/messages/:id', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    const body = (await readJson(c.req.raw)) ?? {};
    const result = validateRow(body, MESSAGE_FIELDS, { partial: true });
    if (!result.ok) return fail(400, 'validation_failed', { errors: result.errors });
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(result.row)) {
      assignments.push(`${toColumn(field)} = ?`);
      values.push(value);
    }
    if (!assignments.length) return ok({ updated: false });
    await env.DB.prepare(`UPDATE messages SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...values, id)
      .run();
    await audit(env, { userId: user.id, action: 'message.update', entity: 'message', entityId: id });
    return ok({ updated: true });
  });

  admin.delete('/messages/:id', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;
    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
    await audit(env, { userId: user.id, action: 'message.delete', entity: 'message', entityId: id });
    return ok({ deleted: true });
  });

  /** CSV export of the inbox — handy from a phone. */
  admin.get('/messages.csv', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const rows = await env.DB.prepare(
      'SELECT created_at, name, email, phone, company, project_type, budget, subject, body, status, country FROM messages ORDER BY created_at DESC LIMIT 2000',
    ).all<Record<string, unknown>>();
    const columns = ['created_at', 'name', 'email', 'phone', 'company', 'project_type', 'budget', 'subject', 'body', 'status', 'country'];
    const csv = [
      columns.join(','),
      ...(rows.results ?? []).map((row) =>
        columns
          .map((column) => {
            const value = row[column];
            const text = typeof value === 'string' ? value : String(value ?? '');
            return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
          })
          .join(','),
      ),
    ].join('\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="messages-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });

  /* ------------------------------------------------------------- analytics */

  admin.get('/analytics/summary', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const query = c.req.query();
    const summary = await analyticsSummary(env, {
      days: query.days ? Number(query.days) : 30,
      country: query.country,
      device: query.device,
    });
    return ok({ summary });
  });

  admin.get('/analytics/visitors', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const query = c.req.query();
    const list = await visitorList(env, {
      days: query.days ? Number(query.days) : 7,
      country: query.country,
      device: query.device,
      path: query.path,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return ok({ ...list, visitors: list.rows.map((row) => rowToApi(row as Row)) });
  });

  admin.get('/analytics/visits/:id', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const id = Number(c.req.param('id'));
    const visit = await env.DB.prepare('SELECT * FROM visits WHERE id = ?').bind(id).first();
    if (!visit) return fail(404, 'not_found');
    return ok({ visit: rowToApi(visit as Row), timeline: await visitTimeline(env, id) });
  });

  admin.post('/analytics/prune', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;
    const env = c.env as Env;
    const result = await pruneAnalytics(env, analyticsRetentionDays(env));
    await audit(env, { userId: user.id, action: 'analytics.prune', entity: 'analytics', meta: result });
    return ok(result);
  });

  /* ------------------------------------------------------- sync + publishing */

  admin.post('/sync', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    const body = (await readJson<{ repo?: string; dryRun?: boolean }>(c.req.raw)) ?? {};
    const summary = await runSync(env, { trigger: 'manual', repo: body.repo, dryRun: body.dryRun });
    await audit(env, { userId: user.id, action: 'sync.manual', entity: 'sync', meta: { ok: summary.ok } });
    return ok({ summary });
  });

  admin.get('/sync/runs', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    return ok({ runs: await recentSyncRuns(env, 30) });
  });

  admin.post('/publish', async (c) => {
    const { error, session, user } = await requireUser(c);
    if (error || !session || !user) return error ?? fail(401, 'unauthenticated');
    const csrfError = await requireCsrf(c, session);
    if (csrfError) return csrfError;

    const env = c.env as Env;
    if (!env.GITHUB_TOKEN) return fail(400, 'missing_github_token');
    const client = new GitHubClient(env);
    const result = await publishSnapshot(env, client, env.GITHUB_USERNAME || 'yswef');
    await audit(env, { userId: user.id, action: 'snapshot.publish', entity: 'sync', meta: result });
    if (result.error) return fail(502, 'publish_failed', { detail: result.error });
    return ok({ ...result, message: result.changed ? 'committed' : 'unchanged' });
  });

  /** Preview of the snapshot that a publish would write. */
  admin.get('/snapshot/preview', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const snapshot = await buildSnapshot(env, { username: env.GITHUB_USERNAME });
    const size = JSON.stringify(snapshot).length;
    return ok({
      size,
      generatedAt: snapshot.generatedAt,
      counts: {
        projects: snapshot.projects.length,
        apps: snapshot.apps.length,
        posts: snapshot.posts.length,
        services: snapshot.services.length,
        skills: snapshot.skills.length,
        learning: snapshot.learning.length,
        pages: snapshot.pages.length,
        socials: snapshot.socials.length,
        languages: snapshot.languages.length,
      },
    });
  });

  /* ---------------------------------------------------------------- helpers */

  admin.post('/markdown', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const body = (await readJson<{ text?: string }>(c.req.raw)) ?? {};
    const text = String(body.text ?? '').slice(0, 200_000);
    return ok({ html: renderMarkdown(text) });
  });

  admin.get('/audit', async (c) => {
    const { error } = await requireUser(c);
    if (error) return error;
    const env = c.env as Env;
    const rows = await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').all();
    return ok({ entries: rows.results ?? [] });
  });

  async function messagesList(c: any, includeBody: boolean) {
    const env = c.env as Env;
    const query = c.req.query();
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.q) {
      where.push('(name LIKE ? OR email LIKE ? OR subject LIKE ? OR body LIKE ?)');
      const like = `%${query.q}%`;
      params.push(like, like, like, like);
    }
    const rows = await env.DB.prepare(
      `SELECT * FROM messages ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 300`,
    )
      .bind(...params)
      .all();
    const counts = await env.DB.prepare('SELECT status, COUNT(*) AS count FROM messages GROUP BY status').all<{
      status: string;
      count: number;
    }>();
    const messages = (rows.results ?? []).map((row) => {
      const item = rowToApi(row as Row);
      if (!includeBody) return item;
      return item;
    });
    return ok({ messages, counts: counts.results ?? [] });
  }

  return admin;
}

/** Decodes the upload payload: text files as-is, binary files from base64. */
function decodeUpload(files: { path: string; text?: string; base64?: string }[]): UploadFile[] {
  const out: UploadFile[] = [];
  for (const file of files.slice(0, 300)) {
    if (!file?.path) continue;
    if (typeof file.text === 'string') {
      out.push({ path: file.path, text: file.text });
      continue;
    }
    if (typeof file.base64 === 'string') {
      try {
        const binary = atob(file.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        out.push({ path: file.path, bytes });
      } catch {
        // Skip anything that is not valid base64.
      }
    }
  }
  return out;
}

function publicSpec(spec: { fields: Record<string, { type: string; values?: readonly string[] }>; labelColumn: string }) {
  return {
    labelColumn: spec.labelColumn,
    fields: Object.fromEntries(
      Object.entries(spec.fields).map(([name, field]) => [name, { type: field.type, values: field.values ?? null }]),
    ),
  };
}

/** Applies the standard response headers to every admin reply. */
export function finalizeAdminResponse(response: Response, env: Env): Response {
  return withHeaders(response, { ...securityHeaders(env), 'cache-control': 'no-store' });
}
