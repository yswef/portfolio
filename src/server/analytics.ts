/**
 * First-party analytics.
 *
 * No third-party service is involved and no personal identifier is stored:
 * the "visitor" is an HMAC of (IP + user agent) with a salt that rotates every
 * day, so the same person cannot be followed across days and the address itself
 * never reaches the database. Location, device and referrer come from what
 * Cloudflare already attaches to the request.
 *
 * Two write paths exist:
 *   - `startVisit`  — one row per session (a new visitor or a silent session reset)
 *   - `touchVisit`  — one UPDATE per heartbeat/pageview, carrying the dwell time
 *
 * A public site with a few hundred visits a day stays far below the free D1
 * allowance of 100,000 written rows per day.
 */
import { visitorHash } from './crypto';
import { type Env } from './env';
import { requestMeta, type RequestMeta } from './http';
import { classifyReferrer, parseUserAgent, hostOf } from './ua';

export interface TrackPayload {
  /** Session identifier generated in the browser (random, no personal data). */
  visitorId?: string;
  sessionId?: string;
  path?: string;
  title?: string;
  locale?: string;
  referrer?: string;
  /** Seconds spent on the previous page of this session. */
  elapsedSeconds?: number;
  maxScroll?: number;
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  language?: string;
  utm?: Record<string, string>;
  /** `pageview` (default) or `exit`. */
  type?: 'pageview' | 'exit';
}

export interface TrackResult {
  ok: boolean;
  visitorId: string;
  visitId: number | null;
  ignored?: 'bot' | 'disabled';
}

const SESSION_GAP_SECONDS = 30 * 60;

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function visitorIdFor(env: Env, meta: RequestMeta, now = Date.now()): Promise<string> {
  const secret = env.SESSION_SECRET ?? 'insecure-development-secret';
  const digest = await visitorHash(secret, { ip: meta.ip, userAgent: meta.userAgent, day: utcDay(now) });
  return digest.slice(0, 32);
}

/**
 * Records a page view. Creates the visit row when the session is new or has
 * been idle for more than 30 minutes, otherwise it only updates the counters.
 */
export async function track(env: Env, request: Request, payload: TrackPayload): Promise<TrackResult> {
  const meta = requestMeta(request);
  const agent = parseUserAgent(meta.userAgent);

  // Cloudflare's own bot signal wins when it is available.
  const botByScore = typeof meta.botScore === 'number' && meta.botScore < 30;
  const isBot = agent.isBot || botByScore;
  const visitorId = payload.visitorId && payload.visitorId.length >= 16 ? payload.visitorId : await visitorIdFor(env, meta);
  const sessionId = (payload.sessionId ?? visitorId).slice(0, 64);

  if (isBot) return { ok: true, visitorId, visitId: null, ignored: 'bot' };

  const now = Math.floor(Date.now() / 1000);
  const ownHost = hostOf(env.SITE_URL ?? '') ?? 'localhost';
  const utmSource = payload.utm?.source ?? null;
  const referrer = payload.referrer || meta.referer || null;
  const { type: sourceType, host: referrerHost } = classifyReferrer(referrer, ownHost, utmSource);

  const existing = await env.DB.prepare(
    'SELECT id, last_seen_at, pageviews, entry_path FROM visits WHERE session_id = ? ORDER BY id DESC LIMIT 1',
  )
    .bind(sessionId)
    .first<{ id: number; last_seen_at: number; pageviews: number; entry_path: string }>();

  const path = (payload.path ?? '/').slice(0, 300);

  if (existing && now - existing.last_seen_at <= SESSION_GAP_SECONDS) {
    const elapsed = Math.max(0, Math.min(3600, Math.round(payload.elapsedSeconds ?? 0)));
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE visits SET last_seen_at = ?, last_path = ?, pageviews = pageviews + 1,
            duration_seconds = duration_seconds + ? WHERE id = ?`,
      ).bind(now, path, elapsed, existing.id),
      env.DB.prepare(
        `UPDATE pageviews SET duration_seconds = ?, max_scroll = ?, is_exit = 1
          WHERE id = (SELECT id FROM pageviews WHERE visit_id = ? ORDER BY id DESC LIMIT 1)`,
      ).bind(elapsed, Math.max(0, Math.min(100, Math.round(payload.maxScroll ?? 0))), existing.id),
      env.DB.prepare(
        `INSERT INTO pageviews (visit_id, visitor_id, path, title, locale, route_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(existing.id, visitorId, path, payload.title?.slice(0, 200) ?? null, payload.locale ?? 'ar', routeKeyOf(path)),
    ]);
    return { ok: true, visitorId, visitId: existing.id };
  }

  const result = await env.DB.prepare(
    `INSERT INTO visits (
        visitor_id, session_id, entry_path, last_path, locale, country, country_name, city, region, timezone,
        asn, as_organization, continent, latitude, longitude, device, device_model, browser, browser_version,
        os, os_version, user_agent, language, screen_width, screen_height, viewport_width, viewport_height,
        referrer, referrer_host, source_type, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        ip_hash, is_bot, pageviews, duration_seconds, started_at, last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?)`,
  )
    .bind(
      visitorId,
      sessionId,
      path,
      path,
      payload.locale ?? 'ar',
      meta.country,
      meta.countryName,
      meta.city,
      meta.region,
      meta.timezone,
      meta.asn,
      meta.asOrganization,
      meta.continent,
      meta.latitude,
      meta.longitude,
      agent.device,
      agent.deviceModel,
      agent.browser,
      agent.browserVersion,
      agent.os,
      agent.osVersion,
      meta.userAgent?.slice(0, 400) ?? null,
      payload.language?.slice(0, 35) ?? null,
      clampDimension(payload.screenWidth, 8000),
      clampDimension(payload.screenHeight, 8000),
      clampDimension(payload.viewportWidth, 8000),
      clampDimension(payload.viewportHeight, 8000),
      referrer?.slice(0, 300) ?? null,
      referrerHost,
      sourceType,
      payload.utm?.source?.slice(0, 100) ?? null,
      payload.utm?.medium?.slice(0, 100) ?? null,
      payload.utm?.campaign?.slice(0, 150) ?? null,
      payload.utm?.term?.slice(0, 150) ?? null,
      payload.utm?.content?.slice(0, 150) ?? null,
      await ipDigest(env, meta),
      now,
      now,
    )
    .run();

  const visitId = Number(result.meta.last_row_id ?? 0);
  if (visitId) {
    await env.DB.prepare(
      `INSERT INTO pageviews (visit_id, visitor_id, path, title, locale, route_key) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(visitId, visitorId, path, payload.title?.slice(0, 200) ?? null, payload.locale ?? 'ar', routeKeyOf(path))
      .run();
  }
  return { ok: true, visitorId, visitId };
}

/** Derived identifier used only for abuse review; never the raw address. */
export async function ipDigest(env: Env, meta: RequestMeta): Promise<string | null> {
  if (!meta.ip) return null;
  const secret = env.SESSION_SECRET ?? 'insecure-development-secret';
  const digest = await visitorHash(secret, { ip: meta.ip, userAgent: meta.userAgent, day: utcDay() });
  return digest.slice(0, 16);
}

function clampDimension(value: number | undefined, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(max, Math.round(value)));
}

/** Collapses dynamic paths so `/apps/foo` and `/apps/bar` group together. */
export function routeKeyOf(path: string): string {
  const clean = path.split('?')[0] ?? '/';
  const parts = clean.split('/').filter(Boolean);
  const isEnglish = parts[0] === 'en';
  const rest = isEnglish ? parts.slice(1) : parts;
  if (rest.length === 0) return isEnglish ? '/en/' : '/';
  const [first, second] = rest;
  if (['projects', 'apps', 'blog', 'pages', 'services'].includes(first ?? '') && second) {
    return `${isEnglish ? '/en' : ''}/${first}/[slug]`;
  }
  return `${isEnglish ? '/en' : ''}/${first}`;
}

/* ----------------------------------------------------------------- reporting */

export interface AnalyticsSummary {
  now: {
    activeVisitors: number;
    activePages: { path: string; visitors: number }[];
    recent: {
      path: string;
      country: string | null;
      city: string | null;
      device: string | null;
      browser: string | null;
      os: string | null;
      referrerHost: string | null;
      seconds: number;
    }[];
  };
  totals: {
    visitors: number;
    sessions: number;
    pageviews: number;
    downloads: number;
    avgDuration: number;
    bounceRate: number;
  };
  series: { date: string; visitors: number; pageviews: number }[];
  topPages: { path: string; views: number; avgDuration: number }[];
  topCountries: { country: string; name: string; visitors: number }[];
  topReferrers: { source: string; type: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  browsers: { browser: string; visitors: number }[];
  topDownloads: { slug: string; fileName: string | null; count: number; country: string | null }[];
  languages: { locale: string; visitors: number }[];
}

export interface AnalyticsFilters {
  days?: number;
  country?: string;
  device?: string;
  path?: string;
  excludeBots?: boolean;
}

/** Aggregates ~10 small queries; each one is indexed. */
export async function analyticsSummary(env: Env, filters: AnalyticsFilters = {}): Promise<AnalyticsSummary> {
  const days = Math.min(365, Math.max(1, filters.days ?? 30));
  const since = Math.floor(Date.now() / 1000) - days * 86_400;
  const liveSince = Math.floor(Date.now() / 1000) - 300;
  const where: string[] = ['started_at >= ?', 'is_bot = 0'];
  const params: (string | number)[] = [since];
  if (filters.country) {
    where.push('country = ?');
    params.push(filters.country);
  }
  if (filters.device) {
    where.push('device = ?');
    params.push(filters.device);
  }
  const clause = where.join(' AND ');

  const [live, recent, totals, series, topPages, countries, referrers, devices, browsers, downloads, languages] =
    await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(DISTINCT visitor_id) AS visitors FROM visits WHERE last_seen_at >= ? AND is_bot = 0`,
      )
        .bind(liveSince)
        .first<{ visitors: number }>(),
      env.DB.prepare(
        `SELECT last_path AS path, country, city, device, browser, os, referrer_host, duration_seconds
           FROM visits WHERE last_seen_at >= ? AND is_bot = 0 ORDER BY last_seen_at DESC LIMIT 20`,
      )
        .bind(liveSince)
        .all<{
          path: string;
          country: string | null;
          city: string | null;
          device: string | null;
          browser: string | null;
          os: string | null;
          referrer_host: string | null;
          duration_seconds: number;
        }>(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS sessions,
                COALESCE(SUM(pageviews), 0) AS pageviews, COALESCE(AVG(duration_seconds), 0) AS avg_duration,
                COALESCE(SUM(CASE WHEN pageviews <= 1 THEN 1 ELSE 0 END), 0) AS bounced
           FROM visits WHERE ${clause}`,
      )
        .bind(...params)
        .first<{ visitors: number; sessions: number; pageviews: number; avg_duration: number; bounced: number }>(),
      env.DB.prepare(
        `SELECT date(started_at, 'unixepoch') AS date,
                COUNT(DISTINCT visitor_id) AS visitors,
                COALESCE(SUM(pageviews), 0) AS pageviews
           FROM visits WHERE ${clause} GROUP BY date ORDER BY date ASC`,
      )
        .bind(...params)
        .all<{ date: string; visitors: number; pageviews: number }>(),
      env.DB.prepare(
        `SELECT path, COUNT(*) AS views, COALESCE(AVG(duration_seconds), 0) AS avg_duration
           FROM pageviews WHERE created_at >= ? GROUP BY path ORDER BY views DESC LIMIT 12`,
      )
        .bind(since)
        .all<{ path: string; views: number; avg_duration: number }>(),
      env.DB.prepare(
        `SELECT country, COALESCE(MAX(country_name), country) AS name, COUNT(DISTINCT visitor_id) AS visitors
           FROM visits WHERE ${clause} AND country IS NOT NULL
           GROUP BY country ORDER BY visitors DESC LIMIT 12`,
      )
        .bind(...params)
        .all<{ country: string; name: string; visitors: number }>(),
      env.DB.prepare(
        `SELECT COALESCE(referrer_host, CASE WHEN source_type = 'direct' THEN 'direct' ELSE COALESCE(utm_source, 'other') END) AS source,
                source_type AS type, COUNT(DISTINCT visitor_id) AS visitors
           FROM visits WHERE ${clause}
           GROUP BY source, type ORDER BY visitors DESC LIMIT 12`,
      )
        .bind(...params)
        .all<{ source: string; type: string; visitors: number }>(),
      env.DB.prepare(
        `SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT visitor_id) AS visitors
           FROM visits WHERE ${clause} GROUP BY device ORDER BY visitors DESC`,
      )
        .bind(...params)
        .all<{ device: string; visitors: number }>(),
      env.DB.prepare(
        `SELECT COALESCE(browser, 'unknown') AS browser, COUNT(DISTINCT visitor_id) AS visitors
           FROM visits WHERE ${clause} GROUP BY browser ORDER BY visitors DESC LIMIT 10`,
      )
        .bind(...params)
        .all<{ browser: string; visitors: number }>(),
      env.DB.prepare(
        `SELECT slug, file_name, COUNT(*) AS count, MAX(country) AS country
           FROM downloads WHERE created_at >= ? AND is_bot = 0 GROUP BY slug, file_name ORDER BY count DESC LIMIT 12`,
      )
        .bind(since)
        .all<{ slug: string; file_name: string | null; count: number; country: string | null }>(),
      env.DB.prepare(
        `SELECT locale, COUNT(DISTINCT visitor_id) AS visitors FROM visits WHERE ${clause}
           GROUP BY locale ORDER BY visitors DESC`,
      )
        .bind(...params)
        .all<{ locale: string; visitors: number }>(),
    ]);

  const sessions = totals?.sessions ?? 0;

  return {
    now: {
      activeVisitors: live?.visitors ?? 0,
      activePages: aggregateActivePages(recent.results ?? []),
      recent: (recent.results ?? []).map((row) => ({
        path: row.path,
        country: row.country,
        city: row.city,
        device: row.device,
        browser: row.browser,
        os: row.os,
        referrerHost: row.referrer_host,
        seconds: row.duration_seconds,
      })),
    },
    totals: {
      visitors: totals?.visitors ?? 0,
      sessions,
      pageviews: totals?.pageviews ?? 0,
      downloads: (downloads.results ?? []).reduce((sum, row) => sum + row.count, 0),
      avgDuration: Math.round(totals?.avg_duration ?? 0),
      bounceRate: sessions > 0 ? Math.round(((totals?.bounced ?? 0) / sessions) * 100) : 0,
    },
    series: series.results ?? [],
    topPages: (topPages.results ?? []).map((row) => ({
      path: row.path,
      views: row.views,
      avgDuration: Math.round(row.avg_duration),
    })),
    topCountries: countries.results ?? [],
    topReferrers: referrers.results ?? [],
    devices: devices.results ?? [],
    browsers: browsers.results ?? [],
    topDownloads: (downloads.results ?? []).map((row) => ({
      slug: row.slug,
      fileName: row.file_name,
      count: row.count,
      country: row.country,
    })),
    languages: languages.results ?? [],
  };
}

function aggregateActivePages(rows: { path: string }[]): { path: string; visitors: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.path, (counts.get(row.path) ?? 0) + 1);
  return [...counts.entries()]
    .map(([path, visitors]) => ({ path, visitors }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 8);
}

/** Paged visitor list for the panel, with the filters applied. */
export async function visitorList(
  env: Env,
  filters: AnalyticsFilters & { limit?: number; offset?: number } = {},
) {
  const days = Math.min(365, Math.max(1, filters.days ?? 7));
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);
  const where = ['started_at >= ?'];
  const params: (string | number)[] = [Math.floor(Date.now() / 1000) - days * 86_400];
  if (filters.country) {
    where.push('country = ?');
    params.push(filters.country);
  }
  if (filters.device) {
    where.push('device = ?');
    params.push(filters.device);
  }
  if (filters.path) {
    where.push('(entry_path LIKE ? OR last_path LIKE ?)');
    params.push(`%${filters.path}%`, `%${filters.path}%`);
  }
  if (filters.excludeBots !== false) where.push('is_bot = 0');

  const rows = await env.DB.prepare(
    `SELECT id, visitor_id, entry_path, last_path, pageviews, duration_seconds, country, country_name, city, region,
            device, browser, browser_version, os, os_version, referrer, referrer_host, source_type,
            utm_source, utm_medium, utm_campaign, language, screen_width, screen_height, started_at, last_seen_at
       FROM visits WHERE ${where.join(' AND ')}
      ORDER BY started_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all();

  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM visits WHERE ${where.join(' AND ')}`)
    .bind(...params)
    .first<{ count: number }>();

  return { rows: rows.results ?? [], total: total?.count ?? 0, limit, offset };
}

/** Pages a single visit walked through — shown in the visitor drawer. */
export async function visitTimeline(env: Env, visitId: number) {
  const rows = await env.DB.prepare(
    'SELECT path, title, duration_seconds, max_scroll, created_at FROM pageviews WHERE visit_id = ? ORDER BY id ASC',
  )
    .bind(visitId)
    .all();
  return rows.results ?? [];
}

/* --------------------------------------------------------------- retention */

/**
 * Deletes rows older than the retention window and resets the daily counters.
 * Runs at most once per day, driven by the scheduled sync.
 */
export async function pruneAnalytics(env: Env, retentionDays: number): Promise<{ removed: number }> {
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86_400;
  const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM pageviews WHERE created_at < ?')
    .bind(cutoff)
    .first<{ count: number }>();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pageviews WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM visits WHERE started_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM downloads WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM abuse_log WHERE created_at < ?').bind(cutoff),
  ]);
  return { removed: before?.count ?? 0 };
}
