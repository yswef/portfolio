/**
 * Public API: everything the site itself calls.
 *
 * - `POST /api/track`          anonymous analytics beacon
 * - `POST /api/contact`        work request form (Turnstile + rate limit)
 * - `GET  /dl/:slug/:assetId`  records the download, then redirects to GitHub
 * - `GET  /api/docs/*`         files of a mirrored repository documentation
 * - `GET  /p/*`, `GET /d/*`    uploaded pages (public / session-guarded)
 * - `POST /api/star`           optional one-click GitHub star (explicit consent)
 * - `POST /api/webhook/github` signed webhook → targeted sync
 * - `POST /api/sync`           secret-protected sync (scheduled workflow)
 */
import { Hono } from 'hono';
import { readSession } from '../server/auth';
import { signPayload, verifyPayload } from '../server/crypto';
import { siteUrl, type Env } from '../server/env';
import { enforceRateLimit, fail, json, ok, readJson, requestMeta } from '../server/http';
import { ipDigest, track, type TrackPayload } from '../server/analytics';
import { recordDownload, resolveDownload, downloadHeaders } from '../server/downloads';
import { contentTypeFor } from '../server/docs';
import { getPage, servePageFile } from '../server/pages';
import { verifyTurnstile } from '../server/turnstile';
import { runSync } from '../server/sync';
import { verifyWebhookSignature } from '../server/github';

const COOKIE_VISITOR = '__Host-visitor';

export function createPublicRoutes() {
  const api = new Hono<{ Bindings: Env }>();

  api.get('/api/health', async (c) => {
    const env = c.env as Env;
    let db = false;
    try {
      db = Boolean(await env.DB.prepare('SELECT 1 AS ok').first());
    } catch {
      db = false;
    }
    return ok({
      status: db ? 'ok' : 'degraded',
      database: db,
      time: new Date().toISOString(),
      site: siteUrl(env),
    });
  });

  /* ------------------------------------------------------------------ track */

  api.post('/api/track', async (c) => {
    const env = c.env as Env;
    const meta = requestMeta(c.req.raw);
    const limit = await enforceRateLimit(env.DB, {
      key: `track:${meta.ip ?? 'unknown'}`,
      limit: 120,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return fail(429, 'rate_limited', { retryAfter: limit.retryAfterSeconds });

    const body = (await readJson<TrackPayload>(c.req.raw)) ?? {};
    const result = await track(env, c.req.raw, {
      ...body,
      path: body.path?.slice(0, 300),
      title: body.title?.slice(0, 200),
      locale: body.locale === 'en' ? 'en' : 'ar',
      utm: body.utm
        ? Object.fromEntries(
            Object.entries(body.utm)
              .slice(0, 8)
              .map(([key, value]) => [key.slice(0, 24), String(value).slice(0, 150)]),
          )
        : undefined,
    });

    const response = json({ visitorId: result.visitorId, ignored: result.ignored ?? null });
    response.headers.append(
      'set-cookie',
      `${COOKIE_VISITOR}=${result.visitorId}; Path=/; Max-Age=${60 * 60 * 24 * 180}; HttpOnly; Secure; SameSite=Lax`,
    );
    return response;
  });

  /* ---------------------------------------------------------------- contact */

  api.post('/api/contact', async (c) => {
    const env = c.env as Env;
    const meta = requestMeta(c.req.raw);
    const limit = await enforceRateLimit(env.DB, {
      key: `contact:${meta.ip ?? 'unknown'}`,
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limit.allowed) {
      await env.DB.prepare('INSERT INTO abuse_log (kind, ip_hash, detail, country) VALUES (?, ?, ?, ?)')
        .bind('contact-rate-limit', await ipDigest(env, meta), 'hourly limit reached', meta.country)
        .run()
        .catch(() => undefined);
      return fail(429, 'rate_limited', { retryAfter: limit.retryAfterSeconds });
    }

    const body = (await readJson<Record<string, string>>(c.req.raw)) ?? {};
    const clean = (value: unknown, max: number) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
    const name = clean(body.name, 120);
    const email = clean(body.email, 200);
    const message = clean(body.body ?? body.message, 6000);
    const honeypot = clean(body.website, 100);

    if (honeypot) {
      // Silently accept: bots should not learn that they were spotted.
      return ok({ received: true });
    }
    if (!name || !email || message.length < 10) return fail(400, 'missing_fields');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'invalid_email');

    const turnstile = await verifyTurnstile(env.TURNSTILE_SECRET, clean(body.turnstileToken ?? body['cf-turnstile-response'], 4000), meta.ip);
    if (turnstile.configured && !turnstile.success) {
      await env.DB.prepare('INSERT INTO abuse_log (kind, ip_hash, detail, country) VALUES (?, ?, ?, ?)')
        .bind('contact-turnstile', await ipDigest(env, meta), turnstile.errors.join(',').slice(0, 200), meta.country)
        .run()
        .catch(() => undefined);
      return fail(400, 'turnstile_failed');
    }

    const result = await env.DB.prepare(
      `INSERT INTO messages (name, email, phone, company, project_type, budget, subject, body, locale, country, city, ip_hash, user_agent, visitor_id, turnstile_ok)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        name,
        email,
        clean(body.phone, 40) || null,
        clean(body.company, 160) || null,
        clean(body.projectType ?? body.project_type, 80) || null,
        clean(body.budget, 80) || null,
        clean(body.subject, 200) || null,
        message,
        clean(body.locale, 2) === 'en' ? 'en' : 'ar',
        meta.country,
        meta.city,
        await ipDigest(env, meta),
        meta.userAgent?.slice(0, 300) ?? null,
        clean(body.visitorId, 64) || null,
        turnstile.success ? 1 : 0,
      )
      .run();

    return ok({ received: true, id: Number(result.meta.last_row_id ?? 0) });
  });

  /* --------------------------------------------------------------- downloads */

  api.get('/dl/:slug/:assetId?', async (c) => {
    const env = c.env as Env;
    const slug = c.req.param('slug')!;
    const assetParam = c.req.param('assetId');
    const assetId = assetParam && /^\d+$/.test(assetParam) ? Number(assetParam) : null;

    const target = await resolveDownload(env, slug, assetId);
    if (!target) return fail(404, 'not_found');

    // The record is best-effort: a failure must never block the download.
    c.executionCtx?.waitUntil?.(recordDownload(env, c.req.raw, target).catch(() => undefined));

    return new Response(null, {
      status: 302,
      headers: { location: target.url, ...downloadHeaders() },
    });
  });

  /* ------------------------------------------------------- repository docs */

  api.get('/api/docs/:owner/:repo/*', async (c) => {
    const env = c.env as Env;
    const owner = c.req.param('owner')!;
    const repo = c.req.param('repo')!;
    const fullName = `${owner}/${repo}`.toLowerCase();
    const path = decodeURIComponent(new URL(c.req.url).pathname.split(`/api/docs/${owner}/${repo}/`)[1] ?? '');

    const project = await env.DB.prepare(
      'SELECT id, visible, doc_mode, docs_path, docs_entry, sync_state FROM projects WHERE lower(full_name) = ?',
    )
      .bind(fullName)
      .first<{ id: number; visible: number; doc_mode: string; docs_path: string | null; docs_entry: string | null; sync_state: string }>();
    if (!project || !project.visible || project.sync_state !== 'active') return fail(404, 'not_found');

    const clean = path.replace(/^\/+/, '') || project.docs_entry || 'index.html';
    const record = await env.DB.prepare(
      "SELECT kv_key, content_type FROM files WHERE scope = 'project-docs' AND owner_key = ? AND path = ?",
    )
      .bind(fullName, clean)
      .first<{ kv_key: string; content_type: string }>();
    if (!record) return fail(404, 'not_found');

    const object = await env.DOCS.get(record.kv_key, 'arrayBuffer');
    if (!object) return fail(404, 'not_found');

    const isHtml = /\.html?$/i.test(clean);
    const headers: Record<string, string> = {
      'content-type': record.content_type || contentTypeFor(clean),
      'cache-control': 'public, max-age=600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': isHtml
        ? [
            "default-src 'none'",
            "img-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "media-src 'self'",
            "form-action 'none'",
            "base-uri 'self'",
            "frame-ancestors 'self'",
          ].join('; ')
        : "default-src 'none'; frame-ancestors 'self'",
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
    };
    return new Response(object, { status: 200, headers });
  });

  /* ------------------------------------------------------------ public pages */

  async function handleUploadedPage(c: any, visibility: 'public' | 'private') {
    const env = c.env as Env;
    const slug = c.req.param('slug')!;
    const rest = new URL(c.req.url).pathname.split(`/${visibility === 'public' ? 'p' : 'd'}/${slug}`)[1] ?? '';
    const page = await getPage(env, slug);
    if (!page || !page.visible) return fail(404, 'not_found');
    if (visibility === 'public' && page.visibility !== 'public') return fail(404, 'not_found');

    const session = await readSession(env, c.req.raw);
    const authenticated = Boolean(session && session.stage === 'full');
    if (visibility === 'private' && !authenticated) {
      return new Response('<!doctype html><meta charset="utf-8"><title>403</title><p>هذه الصفحة خاصة.', {
        status: 403,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    const response = await servePageFile(env, page, rest.replace(/^\/+/, ''), {
      authenticated,
      origin: siteUrl(env),
    });
    if (!response) return fail(404, 'not_found');
    return response;
  }

  api.get('/p/:slug/*', (c) => handleUploadedPage(c, 'public'));
  api.get('/p/:slug', (c) => handleUploadedPage(c, 'public'));
  api.get('/d/:slug/*', (c) => handleUploadedPage(c, 'private'));
  api.get('/d/:slug', (c) => handleUploadedPage(c, 'private'));

  /* ------------------------------------------------------------- star button */

  /**
   * Stars a repository on behalf of the visitor — only after they click the
   * button and agree, and only with their own GitHub token obtained through the
   * OAuth flow. Without OAuth configured the endpoint reports that the feature
   * is off and the site falls back to opening the repository page.
   */
  api.get('/api/star/oauth/start', async (c) => {
    const env = c.env as Env;
    if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) return fail(501, 'not_configured');
    const repoFullName = c.req.query('repo') ?? '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repoFullName)) return fail(400, 'invalid_repo');

    const state = await signPayload(env.SESSION_SECRET ?? '', {
      repo: repoFullName,
      iat: Math.floor(Date.now() / 1000),
    });
    const redirect = new URL('https://github.com/login/oauth/authorize');
    redirect.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
    redirect.searchParams.set('redirect_uri', `${siteUrl(env)}/api/star/oauth/callback`);
    redirect.searchParams.set('scope', 'public_repo');
    redirect.searchParams.set('state', state);
    return Response.redirect(redirect.toString(), 302);
  });

  api.get('/api/star/oauth/callback', async (c) => {
    const env = c.env as Env;
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return fail(400, 'missing_code');
    const payload = await verifyPayload<{ repo: string; iat: number }>(env.SESSION_SECRET ?? '', state, {
      maxAgeSeconds: 900,
    });
    if (!payload) return fail(400, 'invalid_state');

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) return fail(400, 'oauth_failed');

    // The token never leaves the response: the browser stores it for this tab
    // and uses it for the single starred repository.
    return json({ ok: true, repo: payload.repo, token: tokenData.access_token });
  });

  api.post('/api/star', async (c) => {
    const env = c.env as Env;
    const meta = requestMeta(c.req.raw);
    const limit = await enforceRateLimit(env.DB, { key: `star:${meta.ip ?? 'unknown'}`, limit: 20, windowSeconds: 3600 });
    if (!limit.allowed) return fail(429, 'rate_limited');

    const body = (await readJson<{ repo?: string; token?: string; consent?: boolean }>(c.req.raw)) ?? {};
    if (!body.consent) return fail(400, 'consent_required');
    if (!body.token) return fail(401, 'no_token');
    if (!body.repo || !/^[\w.-]+\/[\w.-]+$/.test(body.repo)) return fail(400, 'invalid_repo');
    if (!body.repo.toLowerCase().startsWith(`${(env.GITHUB_USERNAME ?? '').toLowerCase()}/`)) {
      return fail(403, 'not_owner');
    }

    const response = await fetch(`https://api.github.com/user/starred/${body.repo}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${body.token}`,
        accept: 'application/vnd.github+json',
        'content-length': '0',
        'user-agent': 'portfolio-star',
      },
    });
    if (response.status === 204 || response.status === 304) return ok({ starred: true });
    if (response.status === 401) return fail(401, 'token_expired');
    return fail(502, 'github_error', { status: response.status });
  });

  api.get('/api/star/count/:owner/:repo', async (c) => {
    const env = c.env as Env;
    const fullName = `${c.req.param('owner')}/${c.req.param('repo')}`;
    const row = await env.DB.prepare('SELECT stars FROM projects WHERE lower(full_name) = ?')
      .bind(fullName.toLowerCase())
      .first<{ stars: number }>();
    return ok({ repo: fullName, stars: row?.stars ?? null });
  });

  /* -------------------------------------------------------------- webhooks */

  api.post('/api/webhook/github', async (c) => {
    const env = c.env as Env;
    if (!env.GITHUB_WEBHOOK_SECRET) return fail(501, 'webhook_secret_missing');
    const body = await c.req.text();
    const signature = c.req.header('x-hub-signature-256') ?? null;
    if (!(await verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, body, signature))) {
      return fail(401, 'invalid_signature');
    }

    const event = c.req.header('x-github-event') ?? 'unknown';
    const payload = safeJson(body) as { repository?: { full_name?: string }; ref?: string; hook?: { id?: number } } | null;
    const repo = payload?.repository?.full_name;

    if (event === 'ping' || !repo) return ok({ event, handled: false });

    // A push to a branch and a new release both refresh that repository only:
    // the full pass stays on the 15-minute schedule.
    if (event === 'push' || event === 'release') {
      await env.DB.prepare('UPDATE webhooks SET last_delivery_at = unixepoch() WHERE repo_full_name = ?')
        .bind(repo)
        .run()
        .catch(() => undefined);
      c.executionCtx?.waitUntil?.(runSync(env, { trigger: 'webhook', repo, dryRun: false }).catch(() => undefined));
      return ok({ event, repo, queued: true });
    }

    return ok({ event, handled: false });
  });

  /* ------------------------------------------------------------------- sync */

  api.post('/api/sync', async (c) => {
    const env = c.env as Env;
    if (!env.SYNC_SECRET) return fail(501, 'sync_secret_missing');

    const provided =
      c.req.header('x-sync-secret') ??
      (c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? null) ??
      null;
    if (!provided || provided !== env.SYNC_SECRET) {
      const meta = requestMeta(c.req.raw);
      await env.DB.prepare('INSERT INTO abuse_log (kind, ip_hash, detail, country) VALUES (?, ?, ?, ?)')
        .bind('sync-unauthorised', await ipDigest(env, meta), 'bad sync secret', meta.country)
        .run()
        .catch(() => undefined);
      return fail(401, 'unauthorized');
    }

    const body = (await readJson<{ trigger?: string; repo?: string; dryRun?: boolean }>(c.req.raw)) ?? {};
    const summary = await runSync(env, {
      trigger: (body.trigger as 'cron') ?? 'cron',
      repo: body.repo,
      dryRun: Boolean(body.dryRun),
    });
    return json({ ok: summary.ok, summary }, { status: summary.ok ? 200 : 500 });
  });

  /* -------------------------------------------------------- utility helpers */

  api.get('/api/csp-report', async () => ok({ received: false }));

  api.post('/api/csp-report', async (c) => {
    const env = c.env as Env;
    const meta = requestMeta(c.req.raw);
    const report = (await readJson<Record<string, unknown>>(c.req.raw)) ?? {};
    await env.DB.prepare('INSERT INTO abuse_log (kind, ip_hash, detail, country) VALUES (?, ?, ?, ?)')
      .bind('csp-report', await ipDigest(env, meta), JSON.stringify(report).slice(0, 900), meta.country)
      .run()
      .catch(() => undefined);
    return new Response(null, { status: 204 });
  });

  return api;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
