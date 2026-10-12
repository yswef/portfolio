/**
 * Cloudflare bindings and environment variables.
 *
 * Everything secret is supplied through the Pages dashboard (Settings →
 * Variables and Secrets) and never committed to the repository.
 */
export interface Env {
  /* Bindings */
  DB: D1Database;
  DOCS: KVNamespace;

  /* Public variables (safe to expose) */
  SITE_URL: string;
  GITHUB_USERNAME: string;
  SYNC_INTERVAL_MINUTES?: string;
  PUBLIC_TURNSTILE_SITE_KEY?: string;
  /** Where the control panel lives. Must match the build-time value. */
  ADMIN_PATH?: string;
  /** Repository that receives the content snapshot commit. */
  SNAPSHOT_REPO?: string;
  /** Comma separated list of GitHub accounts allowed to use the star button. */
  PBKDF2_ITERATIONS?: string;

  /* Secrets */
  /** GitHub fine-grained token: Contents (read/write), Webhooks (read/write), Metadata. */
  GITHUB_TOKEN?: string;
  /** Shared secret for `/api/sync` (also used by the scheduled workflow). */
  SYNC_SECRET?: string;
  /** 32+ random bytes, base64. Signs session cookies and derives storage keys. */
  SESSION_SECRET?: string;
  /** One-time token that allows creating the first administrator account. */
  BOOTSTRAP_TOKEN?: string;
  /** Secret used to verify GitHub webhook deliveries. */
  GITHUB_WEBHOOK_SECRET?: string;
  /** Cloudflare Turnstile secret key for the contact form. */
  TURNSTILE_SECRET?: string;
  /** Optional: enables the "star with one click" GitHub OAuth flow. */
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  /** Set to "0" to keep the sync from committing the content snapshot. */
  PUBLISH_SNAPSHOT?: string;
  /** Analytics retention in days (default 180). */
  ANALYTICS_RETENTION_DAYS?: string;
}

export interface SyncContext {
  trigger: 'cron' | 'webhook' | 'manual' | 'cli';
  repo?: string;
  dryRun?: boolean;
}

export function isProduction(env: Env): boolean {
  return (env.SITE_URL ?? '').startsWith('https://');
}

export function siteUrl(env: Env): string {
  return (env.SITE_URL ?? 'https://portfolio.pages.dev').replace(/\/+$/, '');
}

export function adminPath(env: Env): string {
  const raw = (env.ADMIN_PATH ?? 'control-panel').trim();
  return raw.replace(/^\/+|\/+$/g, '') || 'control-panel';
}

export function githubUsername(env: Env): string {
  return (env.GITHUB_USERNAME ?? 'yswef').trim();
}

export function syncIntervalMinutes(env: Env): number {
  const value = Number.parseInt(env.SYNC_INTERVAL_MINUTES ?? '15', 10);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

export function analyticsRetentionDays(env: Env): number {
  const value = Number.parseInt(env.ANALYTICS_RETENTION_DAYS ?? '180', 10);
  return Number.isFinite(value) && value >= 7 ? value : 180;
}
