/**
 * Request/response plumbing shared by every API route: cookies, CSRF, rate
 * limiting, visitor identifiers and the security headers that wrap JSON and
 * document responses.
 */
import { clientFingerprint, randomToken, timingSafeEqual, visitorHash } from './crypto';
import { siteUrl, type Env } from './env';

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error, ...extra }, { status });
}

export function ok(data: Record<string, unknown> = {}, init: ResponseInit = {}): Response {
  return json({ ok: true, ...data }, init);
}

/* ------------------------------------------------------------------ cookies */

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: Date;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Strict'}`);
  return parts.join('; ');
}

/**
 * Builds a response that carries several `Set-Cookie` headers. They must stay
 * separate headers — joining them with a comma would break cookie parsing.
 */
export function responseWithCookies(body: BodyInit | null, cookies: string[], init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers ?? {});
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(body, { ...init, headers });
}

/* -------------------------------------------------------- security headers */

/**
 * Applied to every function response. The site ships its own scripts only, but
 * the policy still restricts sources explicitly.
 */
export function securityHeaders(env: Env, options: { sandbox?: boolean; frameable?: boolean } = {}) {
  const origin = siteUrl(env);
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': options.frameable ? 'SAMEORIGIN' : 'DENY',
    'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (options.frameable) {
    headers['content-security-policy'] = [
      `default-src 'none'`,
      `img-src ${origin} data:`,
      `style-src 'unsafe-inline'`,
      `font-src ${origin}`,
      `script-src 'unsafe-inline'`,
      `frame-ancestors 'self'`,
      `base-uri 'none'`,
      `form-action 'none'`,
    ].join('; ');
  }
  return headers;
}

export function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

/* --------------------------------------------------------------- ip + geo */

export interface RequestMeta {
  ip: string | null;
  country: string | null;
  countryName: string | null;
  city: string | null;
  region: string | null;
  continent: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  asn: number | null;
  asOrganization: string | null;
  userAgent: string | null;
  referer: string | null;
  botScore: number | null;
}

type CloudflareRequest = Request & {
  cf?: {
    country?: string;
    city?: string;
    region?: string;
    continent?: string;
    timezone?: string;
    latitude?: string | number;
    longitude?: string | number;
    asn?: number;
    asOrganization?: string;
    botManagement?: { score?: number; verifiedBot?: boolean };
  };
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function requestMeta(request: Request): RequestMeta {
  const cf = (request as CloudflareRequest).cf ?? {};
  return {
    ip: request.headers.get('cf-connecting-ip'),
    country: cf.country ?? request.headers.get('cf-ipcountry') ?? null,
    countryName: countryName(cf.country ?? request.headers.get('cf-ipcountry') ?? null),
    city: cf.city ?? null,
    region: cf.region ?? null,
    continent: cf.continent ?? null,
    timezone: cf.timezone ?? null,
    latitude: toNumber(cf.latitude),
    longitude: toNumber(cf.longitude),
    asn: typeof cf.asn === 'number' ? cf.asn : null,
    asOrganization: cf.asOrganization ?? null,
    userAgent: request.headers.get('user-agent'),
    referer: request.headers.get('referer'),
    botScore: cf.botManagement?.score ?? null,
  };
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return REGION_NAMES.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/* ------------------------------------------------------------ visitor ids */

 function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface VisitorIdentity {
  visitorId: string;
  ipHash: string;
}

/**
 * Builds the anonymous visitor identifier: HMAC of IP + user agent with a salt
 * that rotates every day. The raw IP is never written to the database.
 */
export async function visitorIdentity(
  env: Env,
  meta: RequestMeta,
  now = Date.now(),
  cookieVisitor?: string | null,
): Promise<VisitorIdentity> {
  const secret = env.SESSION_SECRET ?? 'insecure-development-secret';
  const day = utcDay(now);
  const derived = await visitorHash(secret, { ip: meta.ip, userAgent: meta.userAgent, day });
  return {
    visitorId: cookieVisitor && cookieVisitor.length >= 16 ? cookieVisitor : derived.slice(0, 32),
    ipHash: await clientFingerprint(secret, { ip: meta.ip, day }),
  };
}

/* ------------------------------------------------------------- rate limits */

export interface RateLimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * D1-backed fixed window counter. Durable across isolates (unlike a Map) and
 * cheap enough for the few sensitive endpoints that need it.
 */
export async function enforceRateLimit(db: D1Database, rule: RateLimitRule): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = `${rule.key}:${Math.floor(now / rule.windowSeconds)}`;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, hits, window_start, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(key) DO UPDATE SET hits = hits + 1, updated_at = excluded.updated_at
       RETURNING hits, window_start`,
    )
    .bind(bucket, now, now)
    .first<{ hits: number; window_start: number }>();

  const hits = row?.hits ?? 1;
  const windowEnd = (Math.floor(now / rule.windowSeconds) + 1) * rule.windowSeconds;
  return {
    allowed: hits <= rule.limit,
    remaining: Math.max(0, rule.limit - hits),
    retryAfterSeconds: Math.max(1, windowEnd - now),
  };
}

/** Housekeeping so the counters table never grows without bound. */
export async function pruneRateLimits(db: D1Database, olderThanSeconds = 86_400): Promise<void> {
  await db
    .prepare('DELETE FROM rate_limits WHERE updated_at < ?')
    .bind(Math.floor(Date.now() / 1000) - olderThanSeconds)
    .run();
}

/* -------------------------------------------------------------------- CSRF */

export function newCsrfToken(): string {
  return randomToken(24);
}

export function csrfMatches(expected: string | null | undefined, provided: string | null): boolean {
  if (!expected || !provided) return false;
  return timingSafeEqual(expected, provided);
}

/** Reads the CSRF token from the `x-csrf-token` header or `csrf` form field. */
export async function readCsrfToken(request: Request, body?: Record<string, unknown>): Promise<string | null> {
  const header = request.headers.get('x-csrf-token');
  if (header) return header;
  if (body && typeof body.csrf === 'string') return body.csrf;
  return null;
}

/* ------------------------------------------------------------------ bodies */

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text) return null;
    if (text.length > 2_000_000) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function clientIpKey(meta: RequestMeta): string {
  return meta.ip ?? 'unknown';
}

export function htmlResponse(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}
