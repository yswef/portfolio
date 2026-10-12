/**
 * Builds the tracked download address. The redirect itself lives on the server
 * (`/dl/<app>/<asset>`), which records the event and forwards to GitHub.
 *
 * `v` carries the anonymous visitor id so a click can be attached to a session
 * without cookies; `utm_*` values are forwarded for campaign attribution.
 */
export function buildDownloadLink(slug: string, assetId: number | null, options: { visitorId?: string | null; utm?: Record<string, string> } = {}) {
  const params = new URLSearchParams();
  if (options.visitorId) params.set('v', options.visitorId);
  for (const [key, value] of Object.entries(options.utm ?? {})) params.set(`utm_${key}`, value);
  const query = params.toString();
  return `/dl/${encodeURIComponent(slug)}${assetId ? `/${assetId}` : ''}${query ? `?${query}` : ''}`;
}

/** Human readable file size for download tables. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}
