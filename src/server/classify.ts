/**
 * Small classification helpers used by the sync: which shelf a repository
 * belongs on, and what kind of file a release asset is.
 *
 * They only look at signals GitHub already provides (topics, name, language,
 * description, file extension) and every result can be overridden from the
 * control panel or from `.portfolio.json`.
 */
export interface ClassifyInput {
  topics?: string[];
  name: string;
  language?: string | null;
  description?: string | null;
}

export const PROJECT_CATEGORIES = [
  'web',
  'automation',
  'desktop',
  'wordpress',
  'erpnext',
  'mobile',
  'security',
  'backend',
  'library',
  'other',
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export function detectCategory(repo: ClassifyInput): ProjectCategory {
  const haystack = [repo.name, repo.language ?? '', repo.description ?? '', (repo.topics ?? []).join(' ')]
    .join(' ')
    .toLowerCase();

  if (/\b(erpnext|frappe)\b/.test(haystack)) return 'erpnext';
  if (/\b(wordpress|elementor|woocommerce|acf|advanced-custom-fields|plugin|theme)\b/.test(haystack)) return 'wordpress';
  if (/\b(pyqt|pyside|tkinter|wxpython|kivy|desktop|windows|winforms|wpf|qt)\b/.test(haystack)) return 'desktop';
  if (/\b(automation|automate|scraper|scraping|scheduler|selenium|playwright|excel|report|bot|cron)\b/.test(haystack)) {
    return 'automation';
  }
  if (/\b(flutter|dart|android|ios|mobile|react-native|kivy-app)\b/.test(haystack)) return 'mobile';
  if (/\b(security|pentest|vulnerability|scanner|encryption|crypto|cyber)\b/.test(haystack)) return 'security';
  if (/\b(api|fastapi|flask|django|backend|server|microservice)\b/.test(haystack)) return 'backend';
  if (/\b(website|web|frontend|astro|nextjs|next\.js|landing|portfolio|html|css|javascript|typescript)\b/.test(haystack)) {
    return 'web';
  }
  if (/\b(library|package|sdk|module|toolkit|utils?)\b/.test(haystack)) return 'library';
  return 'other';
}

/** Which of the release files is the installer, a portable build, or checksum. */
export function classifyAsset(fileName: string, index = 0): 'installer' | 'portable' | 'checksum' | 'source' | 'other' {
  const name = fileName.toLowerCase();
  if (/\.(sha256|sha256sum|sha512|md5|sig|asc)$/.test(name) || /(sha256|sha512|md5)sums?|checksums?/.test(name)) return 'checksum';
  if (name.includes('portable') || name.includes('no-install') || name.includes('standalone')) return 'portable';
  if (/\.(exe|msi|dmg|pkg|deb|rpm|appimage|apk)$/.test(name)) return 'installer';
  if (/\.(zip|7z|rar|tar|gz|tgz|xz)$/.test(name)) return index === 0 ? 'installer' : 'portable';
  if (/\.(py|whl|tar\.gz|zipball|tarball)$/.test(name)) return 'source';
  return 'other';
}

export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unit]}`;
}
