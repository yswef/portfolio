/**
 * Download routing.
 *
 * The site never proxies binaries: `/dl/<app>/<asset>` records the event (time,
 * country, device, referrer) and then answers with a redirect to the file on
 * GitHub Releases. That keeps the deployment inside the free plan — large files
 * never travel through the function — while still giving the owner real numbers.
 */
import { ipDigest } from './analytics';
import { type Env } from './env';
import { requestMeta } from './http';
import { parseUserAgent, hostOf } from './ua';

/** Only GitHub-hosted release downloads are ever used as a redirect target. */
const ALLOWED_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'raw.githubusercontent.com',
];

export interface DownloadTarget {
  appId: number;
  assetId: number;
  slug: string;
  fileName: string;
  releaseTag: string;
  url: string;
  projectId: number | null;
}

export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** Resolves an app + asset pair, falling back to the newest file of the app. */
export async function resolveDownload(
  env: Env,
  slug: string,
  assetId?: number | null,
): Promise<DownloadTarget | null> {
  const app = await env.DB.prepare('SELECT id, slug, visible FROM apps WHERE slug = ?')
    .bind(slug)
    .first<{ id: number; slug: string; visible: number }>();
  if (!app) return null;

  const asset = assetId
    ? await env.DB.prepare(
        `SELECT id, app_id, project_id, file_name, release_tag, download_url, kind, is_current
           FROM app_assets WHERE id = ? AND app_id = ? AND visible = 1`,
      )
        .bind(assetId, app.id)
        .first<{
          id: number;
          app_id: number;
          project_id: number | null;
          file_name: string;
          release_tag: string;
          download_url: string;
          kind: string;
          is_current: number;
        }>()
    : await env.DB.prepare(
        `SELECT id, app_id, project_id, file_name, release_tag, download_url, kind, is_current
           FROM app_assets WHERE app_id = ? AND visible = 1 AND kind IN ('installer', 'portable')
          ORDER BY is_current DESC, (kind = 'installer') DESC, release_published_at DESC LIMIT 1`,
      )
        .bind(app.id)
        .first<{
          id: number;
          app_id: number;
          project_id: number | null;
          file_name: string;
          release_tag: string;
          download_url: string;
          kind: string;
          is_current: number;
        }>();

  if (!asset) return null;
  if (!isAllowedDownloadUrl(asset.download_url)) return null;

  return {
    appId: asset.app_id,
    assetId: asset.id,
    slug: app.slug,
    fileName: asset.file_name,
    releaseTag: asset.release_tag,
    url: asset.download_url,
    projectId: asset.project_id,
  };
}

export interface DownloadEventInput {
  appId: number;
  assetId: number;
  projectId: number | null;
  slug: string;
  fileName: string;
  releaseTag: string;
}

/** Writes one row per download; bots are excluded from the counters. */
export async function recordDownload(env: Env, request: Request, target: DownloadEventInput): Promise<void> {
  const meta = requestMeta(request);
  const agent = parseUserAgent(meta.userAgent);
  const url = new URL(request.url);
  const referrer = request.headers.get('referer');
  const isBot = agent.isBot || (typeof meta.botScore === 'number' && meta.botScore < 30);

  await env.DB.prepare(
    `INSERT INTO downloads (app_id, asset_id, project_id, slug, file_name, release_tag, visitor_id,
        country, city, region, timezone, device, browser, os, referrer, referrer_host,
        utm_source, utm_medium, utm_campaign, ip_hash, is_bot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      target.appId,
      target.assetId,
      target.projectId,
      target.slug,
      target.fileName,
      target.releaseTag,
      url.searchParams.get('v')?.slice(0, 64) ?? null,
      meta.country,
      meta.city,
      meta.region,
      meta.timezone,
      agent.device,
      agent.browser,
      agent.os,
      referrer?.slice(0, 300) ?? null,
      hostOf(referrer),
      url.searchParams.get('utm_source')?.slice(0, 80) ?? null,
      url.searchParams.get('utm_medium')?.slice(0, 80) ?? null,
      url.searchParams.get('utm_campaign')?.slice(0, 120) ?? null,
      isBot ? null : await ipDigest(env, meta),
      isBot ? 1 : 0,
    )
    .run();
}

export function downloadHeaders(): Record<string, string> {
  return {
    // A redirect must never be cached: every click is a tracked event.
    'cache-control': 'no-store, max-age=0',
    'referrer-policy': 'no-referrer',
  };
}

/** Statistics for one app: our tracked clicks per file, plus the newest release. */
export async function appDownloadStats(env: Env, appId: number) {
  const rows = await env.DB.prepare(
    `SELECT asset_id, file_name, COUNT(*) AS count,
            SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bots
       FROM downloads WHERE app_id = ? GROUP BY asset_id, file_name ORDER BY count DESC LIMIT 20`,
  )
    .bind(appId)
    .all<{ asset_id: number | null; file_name: string | null; count: number; bots: number }>();

  const countries = await env.DB.prepare(
    `SELECT country, COUNT(*) AS count FROM downloads WHERE app_id = ? AND country IS NOT NULL
      GROUP BY country ORDER BY count DESC LIMIT 8`,
  )
    .bind(appId)
    .all<{ country: string; count: number }>();

  return { files: rows.results ?? [], countries: countries.results ?? [] };
}
