/**
 * The list of public pages, in one place.
 *
 * The sitemap, the Open Graph image generator and the search-engine ping step
 * all read this table, so adding a section means touching one file instead of
 * three.
 */
import {
  absoluteUrl,
  categoryLabel,
  formatDate,
  localizedPath,
  pick,
  publishedPosts,
  publicPages,
  visibleApps,
  visibleProjects,
  type ContentSnapshot,
  type Locale,
} from './content';

export type RouteKind =
  | 'home'
  | 'projects'
  | 'project'
  | 'apps'
  | 'app'
  | 'pages'
  | 'page'
  | 'services'
  | 'resume'
  | 'learning'
  | 'blog'
  | 'post'
  | 'contact'
  | 'social'
  | 'privacy';

export interface RouteEntry {
  kind: RouteKind;
  /** Path without the language prefix, e.g. `projects/my-tool`. */
  path: string;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  /** Extra data the Open Graph generator needs. */
  meta?: {
    eyebrow?: string;
    facts?: string[];
    accent?: 'amber' | 'mint' | 'oxide';
  };
  lastmod?: string;
  priority: number;
}

const STATIC_ROUTES: { path: string; kind: RouteKind; key: string; priority: number }[] = [
  { path: '', kind: 'home', key: 'home', priority: 1 },
  { path: 'projects', kind: 'projects', key: 'projects', priority: 0.9 },
  { path: 'apps', kind: 'apps', key: 'apps', priority: 0.9 },
  { path: 'services', kind: 'services', key: 'services', priority: 0.8 },
  { path: 'resume', kind: 'resume', key: 'resume', priority: 0.7 },
  { path: 'learning', kind: 'learning', key: 'learning', priority: 0.6 },
  { path: 'blog', kind: 'blog', key: 'blog', priority: 0.8 },
  { path: 'contact', kind: 'contact', key: 'contact', priority: 0.7 },
  { path: 'social', kind: 'social', key: 'social', priority: 0.5 },
  { path: 'pages', kind: 'pages', key: 'pages', priority: 0.4 },
  { path: 'privacy', kind: 'privacy', key: 'privacy', priority: 0.2 },
];

const SECTION_TITLES: Record<string, { ar: string; en: string }> = {
  home: { ar: 'الرئيسية', en: 'Home' },
  projects: { ar: 'المشاريع', en: 'Projects' },
  apps: { ar: 'التطبيقات', en: 'Apps' },
  services: { ar: 'الخدمات', en: 'Services' },
  resume: { ar: 'السيرة والشهادات', en: 'Résumé and certificates' },
  learning: { ar: 'ما أتعلمه حالياً', en: 'Currently learning' },
  blog: { ar: 'المدونة', en: 'Blog' },
  contact: { ar: 'التواصل', en: 'Contact' },
  social: { ar: 'مواقع التواصل', en: 'Elsewhere' },
  pages: { ar: 'الصفحات التعليمية', en: 'Study pages' },
  privacy: { ar: 'الخصوصية', en: 'Privacy' },
};

export function listRoutes(content: ContentSnapshot): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const siteName = pick(content.profile.name, 'en');
  const generated = content.generatedAt || undefined;

  for (const route of STATIC_ROUTES) {
    const section = SECTION_TITLES[route.key]!;
    entries.push({
      kind: route.kind,
      path: route.path,
      title: {
        ar: route.kind === 'home' ? pick(content.profile.name, 'ar') : `${section.ar} — ${pick(content.profile.name, 'ar')}`,
        en: route.kind === 'home' ? siteName : `${section.en} — ${siteName}`,
      },
      description: {
        ar: route.kind === 'home' ? pick(content.seo.defaultDescription, 'ar') : `${section.ar}: ${pick(content.seo.defaultDescription, 'ar')}`,
        en: route.kind === 'home' ? pick(content.seo.defaultDescription, 'en') : `${section.en}: ${pick(content.seo.defaultDescription, 'en')}`,
      },
      priority: route.priority,
      lastmod: generated,
      meta: { eyebrow: `PRTFL // ${route.key.toUpperCase()}` },
    });
  }

  for (const project of visibleProjects(content)) {
    const nameAr = pick(project.name, 'ar');
    const nameEn = pick(project.name, 'en');
    entries.push({
      kind: 'project',
      path: `projects/${project.slug}`,
      title: { ar: `${nameAr} — مشروع`, en: `${nameEn} — project` },
      description: {
        ar: pick(project.description, 'ar').slice(0, 180),
        en: pick(project.description, 'en').slice(0, 180),
      },
      priority: project.featured ? 0.8 : 0.6,
      lastmod: project.pushedAt ?? generated,
      meta: {
        eyebrow: categoryLabel(project.category, 'en').toUpperCase(),
        facts: [
          project.language ? String(project.language) : null,
          `${project.stars} ★`,
          project.release?.tag ? `v${project.release.tag.replace(/^v/, '')}` : null,
        ].filter((value): value is string => Boolean(value)),
      },
    });
  }

  for (const app of visibleApps(content)) {
    entries.push({
      kind: 'app',
      path: `apps/${app.slug}`,
      title: { ar: `${pick(app.name, 'ar')} — تنزيل`, en: `${pick(app.name, 'en')} — download` },
      description: {
        ar: pick(app.tagline, 'ar').slice(0, 180),
        en: pick(app.tagline, 'en').slice(0, 180),
      },
      priority: app.featured ? 0.85 : 0.6,
      lastmod: app.updatedAt ?? generated,
      meta: {
        eyebrow: app.pricing.mode === 'free' ? 'FREE BUILD' : 'PAID BUILD',
        facts: [
          app.currentVersion ? `v${String(app.currentVersion).replace(/^v/, '')}` : null,
          app.platform.toUpperCase(),
          `${app.assets.length} files`,
        ].filter((value): value is string => Boolean(value)),
      },
    });
  }

  for (const post of publishedPosts(content)) {
    entries.push({
      kind: 'post',
      path: `blog/${post.slug}`,
      title: { ar: pick(post.title, 'ar'), en: pick(post.title, 'en') },
      description: {
        ar: pick(post.excerpt, 'ar').slice(0, 180),
        en: pick(post.excerpt, 'en').slice(0, 180),
      },
      priority: 0.7,
      lastmod: post.publishedAt ?? generated,
      meta: {
        eyebrow: 'ARTICLE',
        facts: [
          post.publishedAt ? formatDate(post.publishedAt, 'en') : null,
          `${post.readingMinutes} min`,
        ].filter((value): value is string => Boolean(value)),
      },
    });
  }

  for (const page of publicPages(content)) {
    entries.push({
      kind: 'page',
      path: `pages/${page.slug}`,
      title: { ar: pick(page.title, 'ar'), en: pick(page.title, 'en') },
      description: {
        ar: pick(page.summary, 'ar').slice(0, 180),
        en: pick(page.summary, 'en').slice(0, 180),
      },
      priority: 0.4,
      lastmod: page.updatedAt ?? generated,
      meta: { eyebrow: 'STUDY PAGE' },
    });
  }

  return entries;
}

export interface RouteUrlPair {
  ar: string;
  en: string;
  canonical: string;
  entry: RouteEntry;
}

/** Absolute URLs for both languages plus the canonical address. */
export function routeUrls(content: ContentSnapshot, entry: RouteEntry): RouteUrlPair {
  const ar = localizedPath('ar', entry.path);
  const en = localizedPath('en', entry.path);
  return { ar, en, canonical: absoluteUrl(content, ar), entry };
}

/**
 * Where the pre-generated social card for a route lives.
 *
 * One card per language, because the Arabic card is laid out right to left with
 * Arabic text: sharing the Arabic page must not produce a Latin preview.
 */
export function ogImagePath(locale: Locale, path: string): string {
  const slug = path ? path.replace(/\/$/, '') : 'home';
  return `/og/${locale}/${slug}.png`;
}

export const ROUTE_KIND_LABELS: Record<RouteKind, { ar: string; en: string }> = {
  home: { ar: 'الرئيسية', en: 'Home' },
  projects: { ar: 'المشاريع', en: 'Projects' },
  project: { ar: 'مشروع', en: 'Project' },
  apps: { ar: 'التطبيقات', en: 'Apps' },
  app: { ar: 'تطبيق', en: 'App' },
  pages: { ar: 'صفحات تعليمية', en: 'Study pages' },
  page: { ar: 'صفحة', en: 'Page' },
  services: { ar: 'الخدمات', en: 'Services' },
  resume: { ar: 'السيرة', en: 'Résumé' },
  learning: { ar: 'التعلّم', en: 'Learning' },
  blog: { ar: 'المدونة', en: 'Blog' },
  post: { ar: 'مقال', en: 'Article' },
  contact: { ar: 'التواصل', en: 'Contact' },
  social: { ar: 'التواصل الاجتماعي', en: 'Elsewhere' },
  privacy: { ar: 'الخصوصية', en: 'Privacy' },
};
