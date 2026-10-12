/**
 * Content access for the pre-rendered site.
 *
 * `content/snapshot.json` is committed by the sync (or by `npm run publish`) and
 * read here at build time. When the file is missing or incomplete the defaults
 * from `content-types.ts` are used, so a fresh clone always builds.
 */
import snapshotFile from '../../content/snapshot.json';
import {
  DEFAULT_CONTACT,
  DEFAULT_HOME,
  DEFAULT_PROFILE,
  DEFAULT_PUBLISHING,
  DEFAULT_SEO,
  defaultSnapshot,
  mergeSettings,
  pickBilingual,
  SNAPSHOT_VERSION,
  type ContentSnapshot,
  type Locale,
} from './content-types';

export type { ContentSnapshot, Locale } from './content-types';
export { pickBilingual } from './content-types';

let cached: ContentSnapshot | null = null;

/** Normalises whatever is on disk into a complete snapshot object. */
export function loadContent(): ContentSnapshot {
  if (cached) return cached;
  const raw = (snapshotFile ?? {}) as Partial<ContentSnapshot>;
  const base = defaultSnapshot(raw.site?.url ?? 'https://portfolio.pages.dev');

  const content: ContentSnapshot = {
    ...base,
    version: raw.version ?? SNAPSHOT_VERSION,
    generatedAt: raw.generatedAt ?? base.generatedAt,
    site: { ...base.site, ...(raw.site ?? {}) },
    profile: mergeSettings(DEFAULT_PROFILE as unknown as Record<string, unknown>, raw.profile) as unknown as ContentSnapshot['profile'],
    seo: mergeSettings(DEFAULT_SEO as unknown as Record<string, unknown>, raw.seo) as unknown as ContentSnapshot['seo'],
    home: mergeSettings(DEFAULT_HOME as unknown as Record<string, unknown>, raw.home) as unknown as ContentSnapshot['home'],
    contact: mergeSettings(DEFAULT_CONTACT as unknown as Record<string, unknown>, raw.contact) as unknown as ContentSnapshot['contact'],
    publishing: mergeSettings(DEFAULT_PUBLISHING as unknown as Record<string, unknown>, raw.publishing) as unknown as ContentSnapshot['publishing'],
    services: raw.services ?? [],
    projects: raw.projects ?? [],
    apps: raw.apps ?? [],
    posts: raw.posts ?? [],
    skills: raw.skills ?? [],
    learning: raw.learning ?? [],
    experience: raw.experience ?? [],
    credentials: raw.credentials ?? [],
    socials: raw.socials ?? [],
    pages: raw.pages ?? [],
    languages: raw.languages ?? [],
  };

  cached = content;
  return content;
}

/* --------------------------------------------------------------- selection */

export const CATEGORY_LABELS: Record<string, { ar: string; en: string }> = {
  web: { ar: 'تطوير ويب', en: 'Web development' },
  automation: { ar: 'أتمتة', en: 'Automation' },
  desktop: { ar: 'تطبيقات سطح مكتب', en: 'Desktop apps' },
  wordpress: { ar: 'WordPress', en: 'WordPress' },
  erpnext: { ar: 'ERPNext', en: 'ERPNext' },
  mobile: { ar: 'تطبيقات موبايل', en: 'Mobile apps' },
  security: { ar: 'أمن سيبراني', en: 'Cybersecurity' },
  backend: { ar: 'خدمات خلفية', en: 'Backend services' },
  library: { ar: 'مكتبات أدوات', en: 'Libraries and tooling' },
  other: { ar: 'متنوع', en: 'Other' },
};

export function categoryLabel(category: string, locale: Locale): string {
  const entry = CATEGORY_LABELS[category];
  if (!entry) return category;
  return entry[locale] ?? entry.en;
}

export function visibleProjects(content: ContentSnapshot): ContentSnapshot['projects'] {
  return content.projects
    .filter((project) => project.visible && project.syncState === 'active' && !project.isFork)
    .sort((a, b) => b.stars - a.stars || a.sortOrder - b.sortOrder);
}

export function featuredProjects(content: ContentSnapshot): ContentSnapshot['projects'] {
  const visible = visibleProjects(content);
  const featured = visible.filter((project) => project.featured);
  return (featured.length ? featured : visible).slice(0, 6);
}

export function projectBySlug(content: ContentSnapshot, slug: string) {
  return content.projects.find((project) => project.slug === slug && project.visible && project.syncState === 'active');
}

export function visibleApps(content: ContentSnapshot): ContentSnapshot['apps'] {
  return content.apps.filter((app) => app.visible).sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
}

export function appBySlug(content: ContentSnapshot, slug: string) {
  return content.apps.find((app) => app.slug === slug && app.visible);
}

export function publishedPosts(content: ContentSnapshot): ContentSnapshot['posts'] {
  return [...content.posts].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

export function postBySlug(content: ContentSnapshot, slug: string) {
  return content.posts.find((post) => post.slug === slug);
}

export function visibleServices(content: ContentSnapshot): ContentSnapshot['services'] {
  return content.services.filter(() => true);
}

export function publicPages(content: ContentSnapshot): ContentSnapshot['pages'] {
  return content.pages;
}

export function visibleSocials(content: ContentSnapshot): ContentSnapshot['socials'] {
  return content.socials;
}

export function skillsByCategory(content: ContentSnapshot) {
  const grouped = new Map<string, ContentSnapshot['skills']>();
  for (const skill of content.skills) {
    const list = grouped.get(skill.category) ?? [];
    list.push(skill);
    grouped.set(skill.category, list);
  }
  return grouped;
}

/** Projects that ship a downloadable build, used by the apps index. */
export function downloadableProjects(content: ContentSnapshot) {
  return visibleProjects(content).filter((project) => project.release && project.release.assets.length > 0);
}

/* ------------------------------------------------------------------ format */

export function formatDate(value: string | number | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatRelative(value: string | number | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffDays = Math.round((Date.now() - date.getTime()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  if (Math.abs(diffDays) < 30) return formatter.format(-diffDays, 'day');
  const months = Math.round(diffDays / 30);
  if (Math.abs(months) < 18) return formatter.format(-months, 'month');
  return formatter.format(-Math.round(diffDays / 365), 'year');
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB').format(value);
}

/**
 * The public address of a page in one language. Arabic lives at the root and
 * English under `/en/`, which is also what the hreflang alternates point at.
 */
export function localizedPath(locale: Locale, path: string): string {
  const clean = `/${path.replace(/^\/+|\/+$/g, '')}`;
  if (locale === 'ar') return clean === '/' ? '/' : `${clean}/`;
  return clean === '/' ? '/en/' : `/en${clean}/`;
}

export function absoluteUrl(content: ContentSnapshot, path: string): string {
  const base = (content.seo.canonicalBase || content.site.url).replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function pick(value: { ar: string; en: string } | undefined | null, locale: Locale): string {
  return pickBilingual(value, locale);
}

/** Section anchors used by the home page and the navigation. */
export const HOME_SECTIONS = ['projects', 'apps', 'services', 'skills', 'languages'] as const;
